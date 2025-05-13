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

  const events = (await res.json()) as any[];

  // PushEvent のみ抽出し、各コミットのリポジトリURLへ変換
  const commits: Commit[] = [];
  for (const event of events) {
    if (event.type === "PushEvent") {
      const repoName = event.repo.name.split("/")[1];
      for (const commit of event.payload.commits) {
        commits.push({
          ...commit,
          repository: { name: repoName },
          commit: {
            author: {
              date: event.created_at
            }
          }
        });
      }
    }
  }

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
    "User-Agent": "MyMCP-Agent"
  };

  let totalAdditions = 0;
  let totalDeletions = 0;
  const repoStats: Record<string, { additions: number; deletions: number }> = {};

  for (const commit of commits) {
    const res = await fetch(commit.url, { headers });
    if (!res.ok) continue;

    const detail = (await res.json()) as CommitDetail;
    const additions = detail.stats.additions;
    const deletions = detail.stats.deletions;
    totalAdditions += additions;
    totalDeletions += deletions;

    const repo = commit.repository?.name ?? "unknown";
    if (!repoStats[repo]) {
      repoStats[repo] = { additions: 0, deletions: 0 };
    }

    repoStats[repo].additions += additions;
    repoStats[repo].deletions += deletions;
  }

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
