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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/sse')) {
      return MyMCP.serveSSE('/sse').fetch(request, env, ctx);
    } else if (url.pathname === '/mcp') {
      return MyMCP.serve('/mcp').fetch(request, env, ctx); // Streamable HTTP
    } else if (url.pathname === '/hello') {
      let id: DurableObjectId;
      id = env.MY_DURABLE_OBJECT.idFromName("foo");
      const stub = env.MY_DURABLE_OBJECT.get(id);
      const greeting = await stub.sayHello("world");
      return new Response(greeting);
    } else {
      return new Response('Not found', { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
