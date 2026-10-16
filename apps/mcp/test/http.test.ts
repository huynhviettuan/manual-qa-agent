import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApp } from '@qa/api';
import { createTestDb, seedProject, type Db } from '@qa/db';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { createHttpToolServer, TOOL_NAMES } from '../src/index.ts';

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let tools: Server;
let mcpUrl: URL;

async function connect(headers: Record<string, string>) {
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }));
  return client;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedProject(db, { tenantId: 't', projectId: 'p' });
  const providers = createProvidersFromEnv({});
  app = await buildApp({
    deps: { db, classifier: providers.classifier, generator: providers.generator },
    rateLimitPerMinute: 1000,
  });
  const apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  tools = createHttpToolServer({ apiUrl });
  await new Promise<void>((resolve) => tools.listen(0, '127.0.0.1', resolve));
  mcpUrl = new URL(`http://127.0.0.1:${(tools.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  await new Promise((resolve) => tools?.close(resolve));
  await app?.close();
  await db?.close();
});

describe('agent tool server over HTTP', () => {
  it('serves the same tools to a caller with an AI_AGENT key', async () => {
    const client = await connect({ authorization: 'Bearer key-p-agent' });
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const res = (await client.callTool({ name: 'whoami', arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(res.content[0]!.text)).toMatchObject({ actorId: 'p-agent', roles: ['AI_AGENT'] });
    await client.close();
  });

  it('accepts the key as x-api-key too', async () => {
    const client = await connect({ 'x-api-key': 'key-p-agent' });
    expect((await client.listTools()).tools).toHaveLength(TOOL_NAMES.length);
    await client.close();
  });

  it('refuses requests without a key, with an unknown key, or with a person’s key', async () => {
    await expect(connect({})).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(connect({ authorization: 'Bearer nope' })).rejects.toThrow(/401|unknown API key/);
    await expect(connect({ authorization: 'Bearer key-p-qa' })).rejects.toThrow(/403|AI_AGENT key/);
    await expect(connect({ authorization: 'Bearer key-p-admin' })).rejects.toThrow(/403|AI_AGENT key/);
  });

  it('reports an unreachable QA API as 502, not as a refused key', async () => {
    const orphan = createHttpToolServer({ apiUrl: 'http://127.0.0.1:9' });
    await new Promise<void>((resolve) => orphan.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(orphan.address() as AddressInfo).port}/mcp`;
    const res = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer key-p-agent' } });
    expect(res.status).toBe(502);
    await new Promise((resolve) => orphan.close(resolve));
  });

  it('answers health checks and rejects other paths and methods', async () => {
    const base = `http://127.0.0.1:${mcpUrl.port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/other`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(mcpUrl, { headers: { authorization: 'Bearer key-p-agent' } })).status).toBe(405);
  });
});
