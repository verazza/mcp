import { DurableObject } from 'cloudflare:workers'; // Import DurableObject and DurableObjectState
import { McpAgent } from 'agents/mcp'; // You might still need this for its functionalities
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';

export class MyMCP extends DurableObject<Env> { // Extend DurableObject
  private server: McpServer; // Make server a private member
  // You might need an instance of McpAgent or port its logic if MyMCP was relying on McpAgent's `this` context
  // private agent: McpAgent; // Example if you need to compose McpAgent

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // this.agent = new McpAgent(state, env); // Or however McpAgent is initialized if needed

    this.server = new McpServer({
      name: 'MyMCP Server',
      version: '0.1.0',
    });

    this.initialize();
  }

  async initialize() {
    this.server.tool(
      'dice_roll',
      'サイコロを降った結果を返します',
      { sides: z.number().min(1).max(100).default(6).describe('サイコロの面の数') },
      async ({ sides }) => {
        const result = Math.floor(Math.random() * sides) + 1;
        return {
          content: [{ type: 'text', text: result.toString() }],
        };
      }
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/sse')) {
      if (this.server && typeof (this.server as any).fetch === 'function') {
        return new Response("SSE endpoint for MyMCP Durable Object. SDK integration needed.", {
          headers: { "Content-Type": "text/plain" }
        });
      }
      return new Response("SSE handler not fully implemented in DO", { status: 501 });
    }

    if (url.pathname.startsWith('/mcp')) { // Simplified condition for example
      return new Response("MCP endpoint for MyMCP Durable Object. SDK integration needed.", {
        headers: { "Content-Type": "text/plain" }
      });
    }

    return new Response('Method not found on MyMCP Durable Object', { status: 404 });
  }
}
