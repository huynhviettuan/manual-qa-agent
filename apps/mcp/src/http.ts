import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiError, QaApiClient } from './client.ts';
import { agentKeyProblem, createAgentToolServer } from './server.ts';

// Streamable HTTP transport for the agent tool server (ADR-0013), for assistants that can't spawn a stdio
// process. The server holds no key of its own: every request carries the caller's AI_AGENT key, which is checked with
// GET /api/me before any tool runs, and every API call is made with that key — so the API's role checks apply to each
// caller separately. Stateless: one MCP server instance per HTTP request, no sessions to steal or expire.

export type HttpToolServerOptions = {
  /** Base URL of the QA API the tools call. */
  apiUrl: string;
  /** Endpoint path (default `/mcp`). */
  path?: string;
  fetch?: typeof fetch;
};

function keyFrom(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    if (m) return m[1];
  }
  const key = req.headers['x-api-key'];
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(JSON.stringify(body));
}

export function createHttpToolServer(opts: HttpToolServerOptions): Server {
  const endpoint = opts.path ?? '/mcp';

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return reply(res, 200, { ok: true });
    if (url.pathname !== endpoint) return reply(res, 404, { error: 'NOT_FOUND', message: `use ${endpoint}` });
    if (req.method !== 'POST')
      return reply(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'stateless server: POST only' });

    const key = keyFrom(req);
    if (!key)
      return reply(res, 401, {
        error: 'UNAUTHENTICATED',
        message: 'send an AI_AGENT key as Authorization: Bearer <key>',
      });
    const api = new QaApiClient({
      baseUrl: opts.apiUrl,
      apiKey: key,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    let problem: string | null;
    try {
      problem = agentKeyProblem(await api.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        return reply(res, 401, { error: 'UNAUTHENTICATED', message: 'unknown API key' });
      // Network failure or an API error other than 401: the caller's key was never judged.
      return reply(res, 502, { error: 'UPSTREAM', message: 'QA API unavailable' });
    }
    if (problem) return reply(res, 403, { error: 'FORBIDDEN', message: problem });

    const server = createAgentToolServer(api);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: 'INTERNAL', message: 'tool server error' });
    });
  });
}
