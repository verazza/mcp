import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchCommitStats } from './api/github/repos/commit.js';
import { searchUserCommits, analyzeSearchedCommits } from './api/github/search/commit.js';

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: 'MyMCP Server',
    version: '0.1.0',
  });

  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  async init() {
    this.server.tool(
      'dice_roll',
      'サイコロを振った結果を返す',
      { sides: z.number().min(1).max(100).default(6).describe('サイコロの面の数') },
      async ({ sides }) => {
        const result = Math.floor(Math.random() * sides) + 1;
        return {
          content: [{ type: 'text', text: result.toString() }],
        };
      }
    );

    this.server.tool(
      'github_repo_commit_stats',
      'GitHubユーザーの対象レポジトリでの直近のコミット統計（追加・削除行数）を返す',
      {
        username: z.string().describe('GitHubのユーザー名'),
        repository: z.string().describe('対象リポジトリ名'),
        commitLimit: z.number().describe('最大コミット数制限(デフォルトは20件まで)(最大50件)')
      },
      async ({ username, repository, commitLimit }) => {
        const token = this.env.GITHUB_TOKEN;
        const { totalAdditions, totalDeletions } = await fetchCommitStats(username, repository, token, commitLimit);
        return {
          content: [
            { type: 'text', text: `追加行数: ${totalAdditions}, 削除行数: ${totalDeletions}` }
          ]
        };
      }
    );

    this.server.tool(
      'github_daily_commit_stats',
      'GitHubユーザーの今日のコミット有無と統計を返す',
      { username: z.string().describe('GitHubのユーザー名') },
      async ({ username }) => {
        const token = this.env.GITHUB_TOKEN;

        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

        const weekAgoStart = new Date(todayStart);
        weekAgoStart.setDate(todayStart.getDate() - 7);

        console.log(`[github_daily_commit_stats] Searching today's commits for ${username} from ${todayStart.toISOString()} to ${todayEnd.toISOString()}`);
        const todaySearchedCommits = await searchUserCommits(username, token, todayStart.toISOString(), todayEnd.toISOString());

        let message = '';
        if (todaySearchedCommits.length === 0) {
          message += `ユーザー ${username} は今日はまだコミットしていません。\n`;
        } else {
          message += `ユーザー ${username} は今日 ${todaySearchedCommits.length} 件のコミットをしました。\n`;
          const todayStats = await analyzeSearchedCommits(todaySearchedCommits, token);
          message += `追加行数: ${todayStats.totalAdditions}, 削除行数: ${todayStats.totalDeletions}\n`;
          message += `リポジトリ別:\n`;
          for (const [repo, stats] of Object.entries(todayStats.repoStats)) {
            message += `  - ${repo}: +${stats.additions}, -${stats.deletions}\n`;
          }
        }

        console.log(`[github_daily_commit_stats] Searching week's commits for ${username} from ${weekAgoStart.toISOString()} to ${todayEnd.toISOString()}`);
        const weekSearchedCommits = await searchUserCommits(username, token, weekAgoStart.toISOString(), todayEnd.toISOString());

        if (weekSearchedCommits.length > 0) {
          const weekStats = await analyzeSearchedCommits(weekSearchedCommits, token);
          message += `\n直近7日間の合計: + ${weekStats.totalAdditions}, - ${weekStats.totalDeletions}`;
          message += ` (コミット総数: ${weekSearchedCommits.length} 件)`;
        } else {
          message += `\n直近7日間のコミットはありませんでした。`;
        }

        return { content: [{ type: 'text', text: message }] };
      }
    );

    this.server.tool(
      'github_commit_comparison',
      'GitHubユーザーの今日の活動を過去7日平均と比較',
      { username: z.string().describe('GitHubのユーザー名') },
      async ({ username }) => {
        const token = this.env.GITHUB_TOKEN;
        // ... (日付設定は同様)
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        const weekAgoStart = new Date(todayStart);
        weekAgoStart.setDate(todayStart.getDate() - 7);

        console.log(`[github_commit_comparison] Searching today's commits for ${username}`);
        const todaySearchedCommits = await searchUserCommits(username, token, todayStart.toISOString(), todayEnd.toISOString());

        console.log(`[github_commit_comparison] Searching week's commits for ${username}`);
        const weekSearchedCommits = await searchUserCommits(username, token, weekAgoStart.toISOString(), todayEnd.toISOString());

        let todayStats = { totalAdditions: 0, totalDeletions: 0, repoStats: {} };
        if (todaySearchedCommits.length > 0) {
          console.log(`[github_commit_comparison] Analyzing ${todaySearchedCommits.length} today's commits.`);
          todayStats = await analyzeSearchedCommits(todaySearchedCommits, token);
        }

        let weekStats = { totalAdditions: 0, totalDeletions: 0, repoStats: {} };
        if (weekSearchedCommits.length > 0) {
          console.log(`[github_commit_comparison] Analyzing ${weekSearchedCommits.length} week's commits.`);
          weekStats = await analyzeSearchedCommits(weekSearchedCommits, token);
        }

        const averageAdditions = weekSearchedCommits.length > 0 ? Math.round(weekStats.totalAdditions / 7) : 0; // 0除算を避ける
        const averageDeletions = weekSearchedCommits.length > 0 ? Math.round(weekStats.totalDeletions / 7) : 0; // 0除算を避ける

        const additionsTrend = todayStats.totalAdditions > averageAdditions ? '増加傾向 📈' :
          (todayStats.totalAdditions < averageAdditions ? '減少傾向 📉' : '同等 ⚖️');

        const deletionsTrend = todayStats.totalDeletions > averageDeletions ? '増加傾向 📈' :
          (todayStats.totalDeletions < averageDeletions ? '減少傾向 📉' : '同等 ⚖️');

        let message = `📊 **${username} の今日のコミット活動**\n`;
        message += `- 追加行数: ${todayStats.totalAdditions}（過去7日平均: ${averageAdditions}）→ ${additionsTrend}\n`;
        message += `- 削除行数: ${todayStats.totalDeletions}（過去7日平均: ${averageDeletions}）→ ${deletionsTrend}`;

        return { content: [{ type: 'text', text: message }] };
      }
    );
  }

  onStateUpdate(state: any) {
    console.log({ stateUpdate: state });
  }
}
