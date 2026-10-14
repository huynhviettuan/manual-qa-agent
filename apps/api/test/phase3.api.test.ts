import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createTestCase,
  createTestDb,
  seedProject,
  upsertEnvironment,
  type Db,
  type SeededActors,
} from '@qa/db';
import { startDemoApp } from '@qa/demo-sut';
import { loginInvalidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { createFakeJira, JiraCloudTracker } from '@qa/integrations';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { proposeExecutable, requestRun, reviewExecutable, workOnce, type RunDeps } from '@qa/orchestrator';
import { reviewTestCase } from '@qa/review';
import { buildApp } from '../src/app.ts';

const S = { tenantId: 't', projectId: 'p' };
const PASSWORD = 'p3-api-password';
let db: Db;
let a: SeededActors;
let app: FastifyInstance;
let runDeps: RunDeps;
let dir: string;
let closeDemo: () => Promise<unknown>;
const jira = createFakeJira({ projectKey: 'QA' });
const key = (actor: string) => ({ 'x-api-key': `key-p-${actor}` });
const post = (url: string, actor: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: key(actor), payload: payload as object });
const get = (url: string, actor: string) => app.inject({ method: 'GET', url, headers: key(actor) });

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const demo = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA' },
    bugUserNotFoundMessage: true,
  });
  closeDemo = () => demo.app.close();
  await upsertEnvironment(db, S, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['execute'],
    baseUrl: demo.baseUrl,
    allowedHosts: [new URL(demo.baseUrl).host],
  });
  dir = await mkdtemp(join(tmpdir(), 'qa-p3-api-'));
  const store = new LocalEvidenceStore(dir);
  const providers = createProvidersFromEnv({});
  app = await buildApp({
    deps: { db, classifier: providers.classifier, generator: providers.generator },
    evidenceStore: store,
    triager: providers.triager,
    tracker: new JiraCloudTracker({
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.test',
      apiToken: 'fake',
      projectKey: 'QA',
      fetch: jira.fetch,
    }),
    rateLimitPerMinute: 1000,
  });
  runDeps = {
    db,
    store,
    executor: new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
    }),
    secrets: () => PASSWORD,
    triager: providers.triager,
  };
});
afterAll(async () => {
  await app.close();
  await closeDemo();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('Phase 3 over HTTP', () => {
  it('FAILED run -> triage -> lead confirms -> bug draft -> approval -> Jira -> revert', async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_p3api','t','p','P3API',1,'t','d','[]','x')`,
    );
    const draft = {
      title: 'Wrong-password message',
      priority: 'P1',
      preconditions: [],
      testData: [],
      steps: [{ action: 'a', expected: 'e', sourceRefs: ['AC-LOGIN@v1'] }],
      assumptions: [],
      missingRequirements: [],
    };
    const c = await createTestCase(db, S, {
      storyId: 'story_p3api',
      workflowId: null,
      content: draft,
      sourceRefs: ['AC-LOGIN@v1'],
      authorId: a.agent.id,
    });
    await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
    const exe = await proposeExecutable(db, a.agent, c.caseId, loginInvalidSpec);
    await reviewExecutable(db, a.qa, exe.id, { decision: 'APPROVE' });
    const run = await requestRun(runDeps, a.qa, { caseId: c.caseId, environmentId: 'staging' });
    await workOnce(runDeps, 'p3-api-worker'); // FAILED + automatic triage

    const triage = (await get(`/api/test-runs/${run.id}/triage`, 'qa')).json();
    expect(triage).toMatchObject({
      suspectedCause: 'PRODUCT_DEFECT',
      securitySensitive: true,
      verifiedCause: null,
    });
    expect((await get(`/api/test-runs/${run.id}`, 'qa')).json().status).toBe('FAILED');

    const repro = await get(`/api/test-runs/${run.id}/reproduction`, 'qa');
    expect(repro.headers['content-type']).toMatch(/text\/markdown/);
    expect(repro.body).toContain('but was "User not found"');

    // Bug before human verification is refused (409); the lead confirms the cause.
    expect((await post(`/api/test-runs/${run.id}/bugs`, 'qa', {})).statusCode).toBe(409);
    const confirm = await post(`/api/reviews/${triage.reviewId}/resolve`, 'lead', {
      action: 'APPROVE',
      reason: 'Reproduced',
      confirmedCause: 'PRODUCT_DEFECT',
    });
    expect(confirm.statusCode).toBe(200);

    const bug = (await post(`/api/test-runs/${run.id}/bugs`, 'qa', {})).json();
    expect(bug).toMatchObject({ status: 'DRAFT', tracker: 'jira', target: 'QA' });
    expect((await post(`/api/bugs/${bug.id}/publish`, 'qa', { approvalId: 'appr_none' })).statusCode).toBe(
      403,
    );
    const approval = (
      await post(`/api/reviews/${bug.reviewId}/resolve`, 'lead', { action: 'APPROVE', reason: 'file it' })
    ).json().approval;
    const published = (await post(`/api/bugs/${bug.id}/publish`, 'qa', { approvalId: approval.id })).json();
    expect(published).toMatchObject({ status: 'PUBLISHED', externalKey: 'QA-1' });
    expect([...jira.issues.keys()]).toEqual(['QA-1']);

    expect((await post(`/api/bugs/${bug.id}/revert`, 'qa', { reason: 'x' })).statusCode).toBe(403);
    expect(
      (await post(`/api/bugs/${bug.id}/revert`, 'lead', { reason: 'Not a defect after all' })).json().status,
    ).toBe('REVERTED');
    expect((await get(`/api/bugs/${bug.id}`, 'qa')).json().status).toBe('REVERTED');
  });

  it('metrics and alerts are lead-only', async () => {
    expect((await get('/api/metrics', 'qa')).statusCode).toBe(403);
    const m = (await get('/api/metrics?days=7', 'lead')).json();
    expect(m).toMatchObject({ window: { days: 7 }, runs: { byState: { FAILED: 1 } } });
    expect((await get('/api/metrics/alerts', 'lead')).json()).toHaveProperty('alerts');
  });

  it('confirmedCause is validated', async () => {
    const r = await post('/api/reviews/review_x/resolve', 'lead', {
      action: 'APPROVE',
      reason: 'x',
      confirmedCause: 'ALIENS',
    });
    expect(r.statusCode).toBe(400);
  });
});
