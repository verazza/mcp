import { CommitDetail } from '../type.js';
import { USER_AGENT, GITHUB_API_BASE } from '../define.js';

interface SearchedCommitItem {
  sha: string;
  html_url: string;
  commit: {
    author: { name?: string; email?: string; date?: string; };
    committer: { name?: string; email?: string; date?: string; };
    message: string;
  };
  author: { login: string; };
  committer: { login: string; };
  repository: {
    name: string;
    full_name: string;
    html_url: string;
  };
  url: string;
  // score?: number;
}

export async function searchUserCommits(
  username: string,
  token: string,
  startDateISO: string,
  endDateISO: string,
  maxCommitsToFetch: number = 1000
): Promise<SearchedCommitItem[]> {
  const allCommitItems: SearchedCommitItem[] = [];
  let page = 1;
  const perPage = Math.min(100, maxCommitsToFetch);

  const query = `author:${username} committer-date:${startDateISO}..${endDateISO}`;

  console.log(`[searchUserCommits] Searching commits for ${username}. Query: [${query}], Max pages based on ${maxCommitsToFetch} items: ${Math.ceil(maxCommitsToFetch / perPage)}`);

  do {
    const searchParams = new URLSearchParams({
      q: query,
      sort: 'committer-date',
      order: 'desc',
      per_page: perPage.toString(),
      page: page.toString(),
    });

    const url = `${GITHUB_API_BASE}/search/commits?${searchParams.toString()}`;
    console.log(`  Fetching page ${page} from ${url}`);

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `${USER_AGENT}-searchUserCommits`,
    };

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: res.statusText }));
      console.error(`  GitHub Search API error on page ${page} (${url}): ${res.status}`, errorData);
      throw new Error(`GitHub Search API error: ${res.status} || 'Unknown error'}`);
    }

    const searchResult = await res.json() as { total_count: number, incomplete_results: boolean, items: SearchedCommitItem[] };

    if (!searchResult.items) {
      console.warn(`  Page ${page}: No 'items' field in search result.`);
      break;
    }

    console.log(`  Page ${page}: Found ${searchResult.items.length} commit items on this page. Total available by API: ${searchResult.total_count}.`);

    if (searchResult.items.length === 0) {
      break;
    }

    allCommitItems.push(...searchResult.items);

    const linkHeader = res.headers.get('Link');
    let hasNextPage = false;
    if (linkHeader) {
      if (linkHeader.includes('rel="next"')) {
        hasNextPage = true;
      }
    }

    if (allCommitItems.length >= maxCommitsToFetch || allCommitItems.length >= searchResult.total_count || !hasNextPage) {
      break;
    }

    page++;
    if (page * perPage > 1000 && searchResult.total_count > 1000) {
      console.warn(`  Search results exceed 1000 items (total: ${searchResult.total_count}). Stopping at 1000 items due to API limitations.`);
      break;
    }

  } while (true);

  console.log(`  Finished searching. Total collected commit items: ${allCommitItems.length}`);
  return allCommitItems.slice(0, maxCommitsToFetch);
}

export async function analyzeSearchedCommits(
  commitItems: SearchedCommitItem[],
  token: string
): Promise<{
  totalAdditions: number;
  totalDeletions: number;
  repoStats: Record<string, { additions: number; deletions: number }>;
}> {
  let totalAdditions = 0;
  let totalDeletions = 0;
  const repoStats: Record<string, { additions: number; deletions: number }> = {};

  if (commitItems.length === 0) {
    return { totalAdditions, totalDeletions, repoStats };
  }

  console.log(`[analyzeSearchedCommits] Analyzing stats for ${commitItems.length} commits.`);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${USER_AGENT}-analyzeSearchedCommits`,
  };

  const commitDetailPromises = commitItems.map(async (item) => {
    const commitDetailUrl = item.url;

    return fetch(commitDetailUrl, { headers })
      .then(async res => {
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: res.statusText }));
          console.error(`  Error fetching commit detail for ${commitDetailUrl}: ${res.status}`, errorData);
          return null;
        }
        return res.json() as Promise<{ stats: CommitDetail['stats'] }>;
      })
      .then(commitDataWithStats => {
        if (commitDataWithStats && commitDataWithStats.stats) {
          return {
            stats: commitDataWithStats.stats,
            repoName: item.repository.name,
          };
        }
        return null;
      })
      .catch(error => {
        console.error(`  Fetch error for commit detail ${commitDetailUrl}: `, error);
        return null;
      });
  });

  const results = await Promise.allSettled(commitDetailPromises);

  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value && result.value.stats) {
      const { stats, repoName } = result.value;
      totalAdditions += stats.additions;
      totalDeletions += stats.deletions;

      if (!repoStats[repoName]) {
        repoStats[repoName] = { additions: 0, deletions: 0 };
      }
      repoStats[repoName].additions += stats.additions;
      repoStats[repoName].deletions += stats.deletions;
    } else if (result.status === 'rejected') {
      console.error('  Failed to process commit detail promise:', result.reason);
    } else if (result.status === 'fulfilled' && !result.value) {
      console.warn('  A commit detail fetch was successful but returned null data (e.g., API error handled).');
    }
  });
  console.log(`[analyzeSearchedCommits] Analysis complete. Additions: ${totalAdditions}, Deletions: ${totalDeletions}`);
  return { totalAdditions, totalDeletions, repoStats };
}
