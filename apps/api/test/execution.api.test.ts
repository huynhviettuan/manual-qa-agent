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
import { deleteAccountSpec, loginValidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { workOnce, type RunDeps } from '@qa/orchestrator';
import { buildApp } from '../src/app.ts';

const PASSWORD = 'api-demo-password';
const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
let app: FastifyInstance;
let runDeps: RunDeps;
let dir: string;
let closeDemo: () => Promise<unknown>;

const key = (actor: string) => ({ 'x-api-key': `key-p-${actor}` });
const draft = {
  title: 'Sign in',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [{ action: 'Sign in', expected: 'Welcome back', sourceRefs: ['AC-LOGIN@v1'] }],
  assumptions: [],
  missingRequirements: [],
};

async function approvedCaseWithExecutable(spec: unknown, n: number) {
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,'t','d','[]','x')`,
    [`story_api_${n}`, `API-${n}`],
  );
  const c = await createTestCase(db, S, {
    storyId: `story_api_${n}`,
    workflowId: null,
    content: draft,
    sourceRefs: ['AC-LOGIN@v1'],
    authorId: a.agent.id,
  });
  await app.inject({
    method: 'POST',
    url: `/api/test-cases/${c.caseId}/review`,
    headers: key('qa'),
    payload: { decision: 'APPROVE' },
  });
  const proposed = await app.inject({
    method: 'POST',
    url: `/api/test-cases/${c.caseId}/executables`,
    headers: key('qa'),
    payload: { spec },
  });
  expect(proposed.statusCode).toBe(201);
  const reviewed = await app.inject({
    method: 'POST',
    url: `/api/executables/${proposed.json().id}/review`,
    headers: key('lead'),
    payload: { decision: 'APPROVE' },
  });
  expect(reviewed.json().status).toBe('APPROVED');
  return c.caseId;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await seedProject(db, { tenantId: 't2', projectId: 'q' });
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
  dir = await mkdtemp(join(tmpdir(), 'qa-api-exec-'));
  const store = new LocalEvidenceStore(dir);
  const providers = createProvidersFromEnv({});
  app = await buildApp({
    deps: { db, classifier: providers.classifier, generator: providers.generator },
    evidenceStore: store,
    rateLimitPerMinute: 1000,
  });
  runDeps = {
    db,
    executor: new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
    }),
    store,
    secrets: (name) => (name === 'DEMO_PASSWORD' ? PASSWORD : undefined),
  };
});
afterAll(async () => {
  await app.close();
  await closeDemo();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('Phase 2 over HTTP', () => {
  it('approve executable -> run -> worker -> PASSED report with downloadable evidence', async () => {
    const caseId = await approvedCaseWithExecutable(loginValidSpec, 1);

    const requested = await app.inject({
      method: 'POST',
      url: '/api/test-runs',
      headers: { ...key('qa'), 'idempotency-key': 'api-run-1' },
      payload: { caseId, environmentId: 'staging' },
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json()).toMatchObject({ status: 'QUEUED', caseRevisionId: `${caseId}:v1` });

    await workOnce(runDeps, 'api-test-worker');
    const report = (
      await app.inject({ method: 'GET', url: `/api/test-runs/${requested.json().id}`, headers: key('qa') })
    ).json();
    expect(report).toMatchObject({ status: 'PASSED', suspectedCause: null, suspectedCauseIsVerified: false });

    const shot = report.evidence.find((e: { kind: string }) => e.kind === 'screenshot');
    const download = await app.inject({ method: 'GET', url: `/api/evidence/${shot.id}`, headers: key('qa') });
    expect(download.statusCode).toBe(200);
    expect(download.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'x-evidence-digest': shot.digest,
    });

    // Raw evidence is not served to the AI agent, nor across tenants.
    expect(
      (await app.inject({ method: 'GET', url: `/api/evidence/${shot.id}`, headers: key('agent') }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/evidence/${shot.id}`,
          headers: { 'x-api-key': 'key-q-lead' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/test-runs/${report.id}`,
          headers: { 'x-api-key': 'key-q-lead' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('destructive spec: BLOCKED with an approval review; the QA lead approves; the re-request runs', async () => {
    const caseId = await approvedCaseWithExecutable(deleteAccountSpec, 2);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/test-runs',
      headers: key('qa'),
      payload: { caseId, environmentId: 'staging' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toMatchObject({ status: 'BLOCKED', reviewId: expect.any(String) });

    const review = await app.inject({
      method: 'GET',
      url: `/api/reviews/${blocked.json().reviewId}`,
      headers: key('lead'),
    });
    expect(review.json()).toMatchObject({
      kind: 'ACTION_APPROVAL',
      assignedRole: 'QA_LEAD',
      targetEnvironment: 'staging',
    });
    // A QA engineer cannot grant it.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/reviews/${blocked.json().reviewId}/resolve`,
          headers: key('qa'),
          payload: { action: 'APPROVE', reason: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/reviews/${blocked.json().reviewId}/resolve`,
      headers: key('lead'),
      payload: { action: 'APPROVE', reason: 'Sandbox account; teardown restores it', approvalTtlMs: 600000 },
    });
    const approvalId = resolved.json().approval.id;

    const queued = await app.inject({
      method: 'POST',
      url: '/api/test-runs',
      headers: key('qa'),
      payload: { caseId, environmentId: 'staging', approvalId },
    });
    expect(queued.json()).toMatchObject({ status: 'QUEUED', approvalId });
    await workOnce(runDeps, 'api-test-worker');
    expect(
      (
        await app.inject({ method: 'GET', url: `/api/test-runs/${queued.json().id}`, headers: key('qa') })
      ).json().status,
    ).toBe('PASSED');
  });

  it('rejects specs outside the allowlisted step format', async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_api_bad','t','p','API-BAD',1,'t','d','[]','x')`,
    );
    const c = await createTestCase(db, S, {
      storyId: 'story_api_bad',
      workflowId: null,
      content: draft,
      sourceRefs: [],
      authorId: a.agent.id,
    });
    await app.inject({
      method: 'POST',
      url: `/api/test-cases/${c.caseId}/review`,
      headers: key('qa'),
      payload: { decision: 'APPROVE' },
    });
    const bad = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${c.caseId}/executables`,
      headers: key('qa'),
      payload: {
        spec: {
          steps: [
            { id: 'x', type: 'navigate', path: 'javascript:alert(1)' },
            { id: 'y', type: 'expectUrl', path: '/' },
          ],
        },
      },
    });
    expect(bad.statusCode).toBe(400);
  });
});
