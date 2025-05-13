import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchCommitStats, fetchUserCommits, analyzeCommitStats } from './github/commitStats.js';

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
      'github_commit_stats',
      'GitHubユーザーの直近のコミット統計（追加・削除行数）を返す',
      {
        username: z.string().describe('GitHubのユーザー名'),
        repository: z.string().describe('対象リポジトリ名'),
      },
      async ({ username, repository }) => {
        const token = this.env.GITHUB_TOKEN; // 環境変数から取得
        const { totalAdditions, totalDeletions } = await fetchCommitStats(username, repository, token);
        return {
          content: [
            { type: 'text', text: `追加行数: ${totalAdditions}, 削除行数: ${totalDeletions}` }
          ]
        };
      }
    );

    this.server.tool(
      'github_daily_commit_stats',
      'GitHubユーザーの今日のコミット有無と統計を返します',
      {
        username: z.string().describe('GitHubのユーザー名'),
      },
      async ({ username }) => {
        const token = this.env.GITHUB_TOKEN;

        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const weekAgo = new Date(todayStart);
        weekAgo.setDate(todayStart.getDate() - 7);

        // ① 今日のコミット取得
        const todayCommits = await fetchUserCommits(username, token, todayStart.toISOString());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        // fetchUserCommits で取得後、さらにフィルタ
        const trulyTodayCommits = todayCommits.filter(c => {
          const commitDate = new Date(c.commit.author.date); // event.created_at を基準にしているのでこれを参照
          return commitDate >= todayStart && commitDate <= todayEnd;
        });


        let message = '';
        if (trulyTodayCommits.length === 0) {
          message += `ユーザー ${username} は今日はまだコミットしていません。\n`;
        } else {
          message += `ユーザー ${username} は今日 ${trulyTodayCommits.length} 件のコミットをしました。\n`;

          const todayStats = await analyzeCommitStats(trulyTodayCommits, token);
          message += `追加行数: ${todayStats.totalAdditions}, 削除行数: ${todayStats.totalDeletions}\n`;
          message += `リポジトリ別:\n`;
          for (const [repo, stats] of Object.entries(todayStats.repoStats)) {
            message += `  - ${repo}: +${stats.additions}, -${stats.deletions}\n`;
          }
        }

        // ② 直近1週間のコミット統計
        const weekCommits = await fetchUserCommits(username, token, weekAgo.toISOString());
        const weekStats = await analyzeCommitStats(weekCommits, token);
        message += `\n直近7日間の合計: +${weekStats.totalAdditions}, -${weekStats.totalDeletions}`;

        return {
          content: [{ type: 'text', text: message }]
        };
      }
    );

    this.server.tool(
      'github_commit_comparison',
      'GitHubユーザーの今日の活動を過去7日平均と比較',
      {
        username: z.string().describe('GitHubのユーザー名'),
      },
      async ({ username }) => {
        const token = this.env.GITHUB_TOKEN;

        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const weekAgo = new Date(todayStart);
        weekAgo.setDate(todayStart.getDate() - 7);

        const todayCommits = await fetchUserCommits(username, token, todayStart.toISOString());
        const weekCommits = await fetchUserCommits(username, token, weekAgo.toISOString());

        const todayStats = await analyzeCommitStats(todayCommits, token);
        const weekStats = await analyzeCommitStats(weekCommits, token);

        const averageAdditions = Math.round(weekStats.totalAdditions / 7);
        const averageDeletions = Math.round(weekStats.totalDeletions / 7);

        const additionsTrend = todayStats.totalAdditions > averageAdditions ? '増加傾向 📈' :
          todayStats.totalAdditions < averageAdditions ? '減少傾向 📉' : '同等 ⚖️';

        const deletionsTrend = todayStats.totalDeletions > averageDeletions ? '増加傾向 📈' :
          todayStats.totalDeletions < averageDeletions ? '減少傾向 📉' : '同等 ⚖️';

        let message = `📊 **${username} の今日のコミット活動**\n`;
        message += `- 追加行数: ${todayStats.totalAdditions}（週平均: ${averageAdditions}） → ${additionsTrend}\n`;
        message += `- 削除行数: ${todayStats.totalDeletions}（週平均: ${averageDeletions}） → ${deletionsTrend}`;

        return {
          content: [{ type: 'text', text: message }]
        };
      }
    );
  }

  onStateUpdate(state: any) {
    console.log({ stateUpdate: state });
  }
}
