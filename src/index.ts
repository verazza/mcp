import { DurableObject } from "cloudflare:workers";
import { MyMCP } from './MyMcp.js';

export { MyMCP };

export class MyDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async sayHello(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }
}

const corsHeaders: { [key: string]: string } = {
  'Access-Control-Allow-Origin': '*', // 許可するオリジン (本番環境では特定のオリジンに限定することを推奨)
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    let response: Response;
    if (url.pathname.startsWith('/sse')) {
      response = await MyMCP.serveSSE('/sse').fetch(request, env, ctx);
    } else if (url.pathname === '/mcp') {
      response = await MyMCP.serve('/mcp').fetch(request, env, ctx); // Streamable HTTP
    } else if (url.pathname === '/hello') {
      let id: DurableObjectId;
      id = env.MY_DURABLE_OBJECT.idFromName("foo");
      const stub = env.MY_DURABLE_OBJECT.get(id);
      const greeting = await stub.sayHello("world");
      response = new Response(greeting);
    } else {
      response = new Response('Not found', { status: 404 });
    }

    // giving cors header
    for (const key in corsHeaders) {
      response.headers.set(key, corsHeaders[key]);
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
