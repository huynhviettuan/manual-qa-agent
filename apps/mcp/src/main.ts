import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { QaApiClient } from './client.ts';
import { createHttpToolServer } from './http.ts';
import { assertAgentIdentity, createAgentToolServer } from './server.ts';

// Agent tool server (ADR-0011). Default: stdio, with one AI_AGENT key from QA_AGENT_KEY. `--http`: Streamable HTTP,
// where every request brings its own AI_AGENT key. stdout carries the stdio protocol, so diagnostics go to stderr.
const baseUrl = process.env.QA_API_URL ?? 'http://127.0.0.1:3000';

if (process.argv.includes('--http')) {
  const host = process.env.QA_MCP_HOST ?? '127.0.0.1';
  const port = Number(process.env.QA_MCP_PORT ?? 3100);
  createHttpToolServer({ apiUrl: baseUrl }).listen(port, host, () => {
    console.error(
      `qa-agent-tools: http://${host}:${port}/mcp → ${baseUrl} (each request needs an AI_AGENT key)`,
    );
  });
} else {
  const apiKey = process.env.QA_AGENT_KEY;
  if (!apiKey) {
    console.error('Set QA_AGENT_KEY to an AI_AGENT API key (pnpm qa seed prints one as <project>-agent).');
    process.exit(1);
  }
  const api = new QaApiClient({ baseUrl, apiKey });
  try {
    const me = await assertAgentIdentity(api);
    console.error(`qa-agent-tools: ${me.actorId} (${me.tenantId}/${me.projectId}) via ${baseUrl}`);
  } catch (err) {
    console.error(`qa-agent-tools: ${(err as Error).message}`);
    process.exit(1);
  }
  await createAgentToolServer(api).connect(new StdioServerTransport());
}
