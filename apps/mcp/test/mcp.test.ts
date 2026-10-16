import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildApp } from '@qa/api';
import { createTestCase, createTestDb, seedProject, upsertEnvironment, type Db } from '@qa/db';
import { startDemoApp } from '@qa/demo-sut';
import { loginValidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { workOnce, type RunDeps } from '@qa/orchestrator';
import {
  ApiError,
  assertAgentIdentity,
  createAgentToolServer,
  QaApiClient,
  TOOL_NAMES,
} from '../src/index.ts';

const PASSWORD = 'mcp-demo-password';
const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let apiUrl: string;
let runDeps: RunDeps;
let dir: string;
let closeDemo: () => Promise<unknown>;
let mcp: Client;
let caseSeq = 0;

const key = (actor: string) => ({ 'x-api-key': `key-p-${actor}` });
const client = (actor: string) => new QaApiClient({ baseUrl: apiUrl, apiKey: `key-p-${actor}` });

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
/** The fields these tests read from tool JSON; everything else stays unknown. */
type ToolData = {
  [key: string]: unknown;
  id: string;
  errors: string[];
  executable: { id: string };
  assertions: Array<{ passed: boolean | null; actual: unknown }>;
};
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await mcp.callTool({ name, arguments: args })) as ToolResult;
  const text = res.content[0]?.text ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // markdown and error text stay strings
  }
  return { isError: res.isError === true, text, data: data as ToolData };
}

/** A test case at revision 1; approved by a QA engineer unless `approve` is false. */
async function testCase(approve = true) {
  const n = ++caseSeq;
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,'t','d','[]','x')`,
    [`story_mcp_${n}`, `MCP-${n}`],
  );
  const c = await createTestCase(db, S, {
    storyId: `story_mcp_${n}`,
    workflowId: null,
    content: {
      title: 'Sign in',
      priority: 'P1',
      preconditions: [],
      testData: [],
      steps: [{ action: 'Sign in', expected: 'Welcome back', sourceRefs: ['AC-LOGIN@v1'] }],
      assumptions: [],
      missingRequirements: [],
    },
    sourceRefs: ['AC-LOGIN@v1'],
    authorId: 'p-qa',
  });
  if (approve) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${c.caseId}/review`,
      headers: key('qa'),
      payload: { decision: 'APPROVE' },
    });
    expect(res.statusCode).toBe(200);
  }
  return c.caseId;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedProject(db, S);
  const demo = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA Tester' },
  });
  closeDemo = () => demo.app.close();
  await upsertEnvironment(db, S, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
    baseUrl: demo.baseUrl,
    allowedHosts: [new URL(demo.baseUrl).host],
  });
  dir = await mkdtemp(join(tmpdir(), 'qa-mcp-'));
  const store = new LocalEvidenceStore(dir);
  const providers = createProvidersFromEnv({});
  app = await buildApp({
    deps: { db, classifier: providers.classifier, generator: providers.generator },
    evidenceStore: store,
    rateLimitPerMinute: 1000,
  });
  apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  runDeps = {
    db,
    executor: new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
    }),
    store,
    secrets: (name) => (name === 'DEMO_PASSWORD' ? PASSWORD : undefined),
  };

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createAgentToolServer(client('agent')).connect(serverSide);
  mcp = new Client({ name: 'mcp-test', version: '0.0.0' });
  await mcp.connect(clientSide);
});

afterAll(async () => {
  await mcp?.close();
  await app?.close();
  await closeDemo?.();
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('identity', () => {
  it('serves only with a pure AI_AGENT key', async () => {
    await expect(assertAgentIdentity(client('agent'))).resolves.toMatchObject({
      actorId: 'p-agent',
      roles: ['AI_AGENT'],
    });
    await expect(assertAgentIdentity(client('qa'))).rejects.toThrow(/needs an AI_AGENT key/);
    await expect(assertAgentIdentity(client('admin'))).rejects.toThrow(/needs an AI_AGENT key/);
    await expect(
      assertAgentIdentity(new QaApiClient({ baseUrl: apiUrl, apiKey: 'nope' })),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it('whoami reports the agent actor', async () => {
    expect((await call('whoami')).data).toMatchObject({ actorId: 'p-agent', tenantId: 't', projectId: 'p' });
  });
});

describe('tool surface', () => {
  it('exposes propose / run / read tools only — nothing that approves, resolves, files or reads evidence', async () => {
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    for (const n of names)
      expect(n).not.toMatch(/approve|resolve|review|publish|revert|bug|ingest|evidence|seed/);
  });

  it('the API refuses review actions for the agent key even when called directly', async () => {
    const caseId = await testCase();
    const proposed = await call('propose_executable', { caseId, spec: loginValidSpec });
    expect(proposed.isError).toBe(false);
    const exeId = proposed.data.executable.id;
    await expect(
      client('agent').request('POST', `/api/executables/${exeId}/review`, { decision: 'APPROVE' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(client('agent').request('GET', '/api/reviews/any')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('check_executable', () => {
  it('refuses a case whose latest revision is not approved', async () => {
    const caseId = await testCase(false);
    const { data } = await call('check_executable', { caseId, spec: loginValidSpec });
    expect(data.ok).toBe(false);
    expect(data.errors.join()).toMatch(/not APPROVED/);
  });

  it('reports schema errors and sources the approved case does not cite', async () => {
    const caseId = await testCase();
    const bad = await call('check_executable', { caseId, spec: { steps: [{ id: 'Open', type: 'goto' }] } });
    expect(bad.data.ok).toBe(false);
    expect(bad.data.errors.join()).toMatch(/steps\.0/);

    const untraced = structuredClone(loginValidSpec) as { steps: Array<{ sourceRefs?: string[] }> };
    untraced.steps[0]!.sourceRefs = ['AC-OTHER@v9'];
    const res = await call('check_executable', { caseId, spec: untraced });
    expect(res.data.errors.join()).toMatch(/AC-OTHER@v9/);
  });

  it('passes a valid spec and lists the secrets it needs', async () => {
    const caseId = await testCase();
    const { data } = await call('check_executable', { caseId, spec: loginValidSpec });
    expect(data).toMatchObject({
      ok: true,
      caseRevision: 1,
      secrets: ['DEMO_PASSWORD'],
      destructiveSteps: [],
    });
    expect(data.specHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('propose -> person approves -> run -> read', () => {
  it('does not propose a spec that fails the checks', async () => {
    const caseId = await testCase(false);
    const res = await call('propose_executable', { caseId, spec: loginValidSpec });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/spec not proposed/);
  });

  it('proposes as the agent, runs after a second person approves, and reports PASSED with a reproduction', async () => {
    const caseId = await testCase();
    const proposed = await call('propose_executable', { caseId, spec: loginValidSpec });
    expect(proposed.data.executable).toMatchObject({ proposedBy: 'p-agent', status: 'PROPOSED' });
    expect(proposed.data.secrets).toEqual(['DEMO_PASSWORD']);

    // Not runnable until a person approves it.
    const early = await call('request_run', { caseId, environmentId: 'staging' });
    expect(early.isError).toBe(true);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/executables/${proposed.data.executable.id}/review`,
      headers: key('lead'),
      payload: { decision: 'APPROVE' },
    });
    expect(approved.json().status).toBe('APPROVED');

    const queued = await call('request_run', {
      caseId,
      environmentId: 'staging',
      idempotencyKey: `mcp-${caseId}`,
    });
    expect(queued.data).toMatchObject({ status: 'QUEUED' });
    const again = await call('request_run', {
      caseId,
      environmentId: 'staging',
      idempotencyKey: `mcp-${caseId}`,
    });
    expect(again.data.id).toBe(queued.data.id);

    await workOnce(runDeps, 'mcp-test-worker');
    const run = await call('get_run', { runId: queued.data.id, waitSeconds: 5 });
    expect(run.data).toMatchObject({ status: 'PASSED', reason: 'ALL_ASSERTIONS_PASSED' });

    expect((await call('get_triage', { runId: queued.data.id })).data).toEqual({ available: false });
    const repro = await call('get_reproduction', { runId: queued.data.id });
    expect(repro.text).toMatch(/^# Reproduction/);
    expect(repro.text).not.toContain(PASSWORD);
  });

  it('reports FAILED with the observed value when an expectation does not hold', async () => {
    const caseId = await testCase();
    const wrong = structuredClone(loginValidSpec) as { steps: Array<{ id: string; text?: string }> };
    wrong.steps.find((s) => s.id === 'welcome')!.text = 'Welcome to somewhere else';
    const proposed = await call('propose_executable', { caseId, spec: wrong });
    await app.inject({
      method: 'POST',
      url: `/api/executables/${proposed.data.executable.id}/review`,
      headers: key('qa'),
      payload: { decision: 'APPROVE' },
    });
    const queued = await call('request_run', { caseId, environmentId: 'staging' });
    await workOnce(runDeps, 'mcp-test-worker');
    const run = await call('get_run', { runId: queued.data.id, waitSeconds: 5 });
    expect(run.data).toMatchObject({ status: 'FAILED', reason: 'ASSERTION_FAILED:welcome' });
    const failed = run.data.assertions.find((a) => a.passed === false);
    expect(failed?.actual).toContain('Welcome back');
  });

  it('turns unknown ids into tool errors instead of crashing', async () => {
    const res = await call('get_run', { runId: 'run_missing' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/NOT_FOUND \(404\)/);
  });
});
