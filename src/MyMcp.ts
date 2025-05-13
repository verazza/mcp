import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: 'MyMCP Server',
    version: '0.1.0',
  });

  async init() {
    this.server.tool(
      'dice_roll',
      'サイコロを振った結果を返します',
      { sides: z.number().min(1).max(100).default(6).describe('サイコロの面の数') },
      async ({ sides }) => {
        const result = Math.floor(Math.random() * sides) + 1;
        return {
          content: [{ type: 'text', text: result.toString() }],
        };
      }
    );
  }

  onStateUpdate(state: any) {
    console.log({ stateUpdate: state });
  }
}
