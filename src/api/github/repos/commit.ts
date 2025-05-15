import { CommitDetail } from '../type.js';
import { GITHUB_API_BASE, USER_AGENT } from '../define.js';

interface Commit {
  url: string;
  sha: string;
  commit: {
    author?: {
      name?: string;
      email?: string;
      date?: string;
    };
    committer?: {
      name?: string;
      email?: string;
      date?: string;
    };
    message?: string;
  };
  author?: { login: string; id: number; } | null;
  committer?: { login: string; id: number; } | null;
}

export async function fetchCommitStats(
  username: string,
  repo: string,
  token: string,
  commitLimit: number = 20
): Promise<{ totalAdditions: number; totalDeletions: number; processedCommitsCount: number; requestedCommitLimit: number }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': `${USER_AGENT}-fetchCommitStats`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const perPage = Math.min(commitLimit, 50);
  console.log(`[fetchCommitStats] Attempting to fetch up to ${perPage} commits for ${username}/${repo}. (User requested: ${commitLimit})`);

  const commitsListUrl = `${GITHUB_API_BASE}/repos/${username}/${repo}/commits?per_page=${perPage}`;
  const commitsRes = await fetch(commitsListUrl, { headers });

  if (!commitsRes.ok) {
    const errorText = await commitsRes.text();
    console.error(`[fetchCommitStats] GitHub API error fetching commit list for ${username}/${repo}: ${commitsRes.status} ${commitsRes.statusText}`, errorText);
    throw new Error(`GitHub API (commits list) error for ${username}/${repo}: ${commitsRes.status} ${commitsRes.statusText}`);
  }

  const commits = (await commitsRes.json()) as Commit[];
  const fetchedCommitsCount = commits.length;

  if (fetchedCommitsCount === 0) {
    console.warn(`[fetchCommitStats] No commits found for ${username}/${repo} with the current parameters (per_page=${perPage}).`);
    return { totalAdditions: 0, totalDeletions: 0, processedCommitsCount: 0, requestedCommitLimit: commitLimit };
  }

  if (fetchedCommitsCount < commitLimit && perPage === commitLimit) {
    console.warn(`[fetchCommitStats] Fetched ${fetchedCommitsCount} commits for ${username}/${repo}, which is less than the requested limit of ${commitLimit}. This might be all available commits.`);
  } else if (fetchedCommitsCount < perPage && perPage < commitLimit) {
    console.warn(`[fetchCommitStats] Fetched ${fetchedCommitsCount} commits for ${username}/${repo}. Requested ${commitLimit} but API per_page was ${perPage}. This might be all available commits.`);
  }


  let totalAdditions = 0;
  let totalDeletions = 0;

  const commitsToProcess = commits.slice(0, commitLimit);

  console.log(`[fetchCommitStats] Analyzing stats for ${commitsToProcess.length} fetched commits.`);

  for (const commit of commitsToProcess) {
    if (!commit.url) {
      console.warn(`[fetchCommitStats] Commit object for SHA ${commit.sha} is missing 'url' property. Skipping stats fetch.`);
      continue;
    }
    const detailRes = await fetch(commit.url, { headers });

    if (!detailRes.ok) {
      const errorText = await detailRes.text();
      console.error(`[fetchCommitStats] GitHub API error fetching commit detail for ${commit.url}: ${detailRes.status} ${detailRes.statusText}`, errorText);
      throw new Error(`GitHub API (commit detail) error for ${commit.url}: ${detailRes.status} ${detailRes.statusText}`);
    }

    const commitDetails = (await detailRes.json()) as CommitDetail;

    if (commitDetails.stats) {
      totalAdditions += commitDetails.stats.additions;
      totalDeletions += commitDetails.stats.deletions;
    } else {
      console.warn(`[fetchCommitStats] Stats not found in commit detail response for ${commit.url}`);
    }
  }

  console.log(`[fetchCommitStats] Analysis complete for ${username}/${repo}. Additions: ${totalAdditions}, Deletions: ${totalDeletions}. Processed ${commitsToProcess.length} of ${fetchedCommitsCount} fetched commits (requested limit: ${commitLimit}).`);
  return { totalAdditions, totalDeletions, processedCommitsCount: commitsToProcess.length, requestedCommitLimit: commitLimit };
}
