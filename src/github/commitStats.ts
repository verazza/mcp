const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "MyMCP-Agent";

interface Commit {
  commit: {
    author: {
      date: string;
    };
  };
  url: string;
  repository?: {
    name: string;
  };
}

interface CommitDetail {
  stats: {
    additions: number;
    deletions: number;
  };
}

export async function fetchUserCommits(
  username: string,
  token: string,
  sinceISO?: string,
  maxPages: number = 3 // GitHub Events APIの一般的な上限を考慮 (1ページ100件 x 3ページ = 300イベント)
): Promise<Commit[]> {
  const allCollectedCommits: Commit[] = [];
  let currentPage = 1;
  let nextUrl: string | null = null; // 次のページを取得するためのURL

  console.log(`Workspaceing events for ${username} (max ${maxPages} pages). Initial since: ${sinceISO || 'None'}`);

  // URLを構築するための基準となるベースURLと検索パラメータ
  let baseUrl = `${GITHUB_API_BASE}/users/${username}/events/public`;

  do {
    let currentFetchUrl: string;
    const searchParams = new URLSearchParams({ per_page: "100" }); // 常に100件取得

    if (currentPage === 1) {
      // 最初のページのリクエストの場合
      if (sinceISO) {
        searchParams.set("since", sinceISO);
      }
      currentFetchUrl = `${baseUrl}?${searchParams.toString()}`;
    } else if (nextUrl) {
      // 2ページ目以降は、Linkヘッダーから取得したURLを使用
      currentFetchUrl = nextUrl;
    } else {
      // 次のページがなく、最初のページでもない場合はループを抜ける
      break;
    }

    console.log(`  Fetching page ${currentPage}: ${currentFetchUrl}`);

    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": `${USER_AGENT}-fetchUserCommits`
    };

    const res = await fetch(currentFetchUrl, { headers });

    if (!res.ok) {
      const text = await res.text();
      console.error(`  GitHub events API error on page ${currentPage} (${currentFetchUrl}): ${res.status} ${res.statusText}\\n${text}`);
      break;
    }

    const events = (await res.json()) as any[];
    console.log(`    Page ${currentPage}: Found ${events.length} events.`);

    if (events.length === 0) {
      break;
    }

    for (const event of events) {
      if (event.type === "PushEvent" && event.payload && event.payload.commits) {
        const repoName = event.repo.name.split("/")[1]; // 'owner/repo' から 'repo' を抽出
        for (const ghCommit of event.payload.commits) { // payload内の各コミット
          allCollectedCommits.push({
            url: ghCommit.url,
            commit: {
              author: {
                // PushEventの発生日時をコミットの日付情報として使用。あとでソート用に使う
                date: event.created_at
              }
            },
            repository: { name: repoName },
            // 必要であれば、ghCommitから他の情報 (例: sha, message) もCommit型に追加
          });
        }
      }
    }

    // 次のページのURLをLinkヘッダーから取得
    const linkHeader = res.headers.get('Link');
    nextUrl = null; // 次のページがない場合に備えてリセット
    if (linkHeader) {
      const links = linkHeader.split(',');
      const nextLinkEntry = links.find(link => link.includes('rel="next"'));
      if (nextLinkEntry) {
        const match = nextLinkEntry.match(/<([^>]+)>/);
        if (match) {
          nextUrl = match[1];
        }
      }
    }
    currentPage++;
  } while (nextUrl && currentPage <= maxPages); // 次のページがあり、最大ページ数に達していない間ループ

  console.log(`  Finished fetching events. Total collected commit entries (from PushEvents): ${allCollectedCommits.length}`);
  return allCollectedCommits;
}

export async function analyzeCommitStats(
  commits: Commit[],
  token: string
): Promise<{
  totalAdditions: number;
  totalDeletions: number;
  repoStats: Record<string, { additions: number; deletions: number }>;
}> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": `${USER_AGENT}-AnalyzerCommitStats`
  };

  let totalAdditions = 0;
  let totalDeletions = 0;
  const repoStats: Record<string, { additions: number; deletions: number }> = {};

  const commitDetailPromises = commits.map(commit =>
    fetch(commit.url, { headers })
      .then(async res => {
        if (!res.ok) {
          console.error(`GitHub API error for ${commit.url}: ${res.status} ${await res.text()
            } `);
          return null;
        }
        return res.json() as Promise<CommitDetail>;
      })
      .then(detail => ({
        detail,
        repoName: commit.repository?.name ?? "unknown"
      }))
      .catch(error => {
        console.error(`Workspace error for ${commit.url}: `, error);
        return null;
      })
  );

  const results = await Promise.allSettled(commitDetailPromises);

  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value && result.value.detail) {
      const { detail, repoName } = result.value;
      const additions = detail.stats.additions;
      const deletions = detail.stats.deletions;

      totalAdditions += additions;
      totalDeletions += deletions;

      if (!repoStats[repoName]) {
        repoStats[repoName] = { additions: 0, deletions: 0 };
      }
      repoStats[repoName].additions += additions;
      repoStats[repoName].deletions += deletions;
    } else if (result.status === 'rejected') {
      console.error('Failed to fetch commit detail:', result.reason);
    }
  });

  return { totalAdditions, totalDeletions, repoStats };
}

export async function fetchCommitStats(
  username: string,
  repo: string,
  token: string,
  commitLimit: number = 20
): Promise<{ totalAdditions: number; totalDeletions: number }> {
  const headers = {
    Authorization: `token ${token} `,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': `${USER_AGENT}-fetchCommitStats`,
  };

  const commitsRes = await fetch(
    `https://api.github.com/repos/${username}/${repo}/commits?per_page=${Math.min(commitLimit, 50)}`,
    { headers }
  );

  if (!commitsRes.ok) {
    const text = await commitsRes.text();
    throw new Error(`GitHub API (commits) error: ${commitsRes.status} ${commitsRes.statusText}\n${text}`);
  }

  const commits = (await commitsRes.json()) as Commit[];

  if (commits.length < commitLimit) {
    throw new Error(`指定された件数(${commitLimit})に満たないコミットしか取得できませんでした（${commits.length}件）`);
  }

  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const commit of commits.slice(0, commitLimit)) {
    const detailRes = await fetch(commit.url, { headers });

    if (!detailRes.ok) {
      const text = await detailRes.text();
      throw new Error(`GitHub API (commit detail) error: ${detailRes.status} ${detailRes.statusText}\n${text}`);
    }

    const commitDetails = (await detailRes.json()) as CommitDetail;
    totalAdditions += commitDetails.stats.additions;
    totalDeletions += commitDetails.stats.deletions;
  }

  return { totalAdditions, totalDeletions };
}
