const GITHUB_API_BASE = "https://api.github.com";

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
  sinceISO?: string
): Promise<Commit[]> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "MyMCP-Agent"
  };

  const searchParams = new URLSearchParams({
    per_page: "100",
  });

  if (sinceISO) {
    searchParams.set("since", sinceISO);
  }

  const res = await fetch(`${GITHUB_API_BASE}/users/${username}/events/public?${searchParams}`, {
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub events API error: ${res.status} ${res.statusText}\n${text}`);
  }

  console.log(`Workspaceing events for ${username} since ${sinceISO} with params: ${searchParams.toString()}`);
  const events = (await res.json()) as any[];
  console.log(`Found ${events.length} events from API.`);

  const commits: Commit[] = [];

  // PushEvent のみ抽出し、各コミットのリポジトリURLへ変換
  // for (const event of events) {
  //   if (event.type === "PushEvent") {
  //     const repoName = event.repo.name.split("/")[1];
  //     for (const commit of event.payload.commits) {
  //       commits.push({
  //         ...commit,
  //         repository: { name: repoName },
  //         commit: {
  //           author: {
  //             date: event.created_at
  //           }
  //         }
  //       });
  //     }
  //   }
  // }

  events.forEach((event, index) => {
    // 正しいテンプレートリテラルの使用例
    console.log(`  Event ${index + 1}: type=${event.type}, created_at=${event.created_at}, repo=${event.repo.name}`);
    if (event.type === "PushEvent" && event.payload && event.payload.commits) {
      console.log(`    PushEvent contains ${event.payload.commits.length} commits.`);
      // オプション: さらに詳細なコミット情報をログ出力する場合
      // event.payload.commits.forEach((commit: any, c_index: number) => {
      //   const commitAuthorDate = commit.author && commit.author.date ? commit.author.date : 'N/A';
      //   console.log(`      Commit ${c_index + 1}: sha=${commit.sha}, message=${commit.message}, author_date=${commitAuthorDate}`);
      // });
    }
  });

  return commits;
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
    "User-Agent": "MyMCP-Agent" // User-Agentはご自身のものに適宜変更してください
  };

  let totalAdditions = 0;
  let totalDeletions = 0;
  const repoStats: Record<string, { additions: number; deletions: number }> = {};

  // 各コミット詳細取得のPromiseを作成
  const commitDetailPromises = commits.map(commit =>
    fetch(commit.url, { headers })
      .then(async res => {
        if (!res.ok) {
          console.error(`GitHub API error for ${commit.url}: ${res.status} ${await res.text()}`);
          return null; // エラー時はnullを返す
        }
        return res.json() as Promise<CommitDetail>;
      })
      .then(detail => ({ // 元のコミット情報（特にリポジトリ名）を一緒に返す
        detail,
        repoName: commit.repository?.name ?? "unknown"
      }))
      .catch(error => {
        console.error(`Workspace error for ${commit.url}:`, error);
        return null; // ネットワークエラー等
      })
  );

  // Promiseを並列で実行
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
  commitLimit: number = 10 // デフォルト値
): Promise<{ totalAdditions: number; totalDeletions: number }> {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'my-mcp-agent',
  };

  const commitsRes = await fetch(
    `https://api.github.com/repos/${username}/${repo}/commits?per_page=${Math.min(commitLimit, 100)}`,
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
