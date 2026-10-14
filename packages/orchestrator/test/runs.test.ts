import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  claimNextRun,
  createActor,
  createTestCase,
  createTestDb,
  getRun,
  revokeApproval,
  seedProject,
  updateRunState,
  upsertEnvironment,
  workflowUsage,
  type Db,
  type SeededActors,
} from '@qa/db';
import { startDemoApp } from '@qa/demo-sut';
import { deleteAccountSpec, loginInvalidSpec, loginValidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { resolveReview, reviewTestCase } from '@qa/review';
import {
  getRunReport,
  proposeExecutable,
  requestRun,
  reviewExecutable,
  workOnce,
  type RunDeps,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
const PASSWORD = 'pilot-password-123';
let db: Db;
let a: SeededActors;
let deps: RunDeps;
let dir: string;
let baseUrl: string;
let closeDemo: () => Promise<unknown>;
let n = 0;

const draft = {
  title: 'Sign in',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [{ action: 'Sign in', expected: 'Welcome back', sourceRefs: ['AC-LOGIN@v1'] }],
  assumptions: [],
  missingRequirements: [],
};

/** An APPROVED case with an APPROVED executable (proposed by the AI agent, approved by QA). */
async function approvedCase(spec: unknown) {
  const story = await db.query<{ id: string }>(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,'Sign in','d','[]','x') RETURNING id`,
    [`story_${++n}`, `RUN-${n}`],
  );
  const c = await createTestCase(db, S, {
    storyId: story[0]!.id,
    workflowId: null,
    content: draft,
    sourceRefs: ['AC-LOGIN@v1'],
    authorId: a.agent.id,
  });
  await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
  const exe = await proposeExecutable(db, a.agent, c.caseId, spec);
  await reviewExecutable(db, a.qa, exe.id, { decision: 'APPROVE' });
  return c.caseId;
}

/** Observable side effect on the system under test: can the demo user still sign in? */
const canSignIn = async () =>
  (
    await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'qa@example.test', password: PASSWORD }),
    })
  ).status === 200;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const demo = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA Tester' },
  });
  baseUrl = demo.baseUrl;
  closeDemo = () => demo.app.close();
  const host = new URL(baseUrl).host;
  await upsertEnvironment(db, S, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
    baseUrl,
    allowedHosts: [host],
  });
  await upsertEnvironment(db, S, {
    id: 'production',
    kind: 'production',
    allowedActions: ['draft', 'execute'],
    baseUrl,
    allowedHosts: [host],
  });
  await upsertEnvironment(db, S, { id: 'no-target', kind: 'staging', allowedActions: ['draft', 'execute'] });
  dir = await mkdtemp(join(tmpdir(), 'qa-runs-'));
  deps = {
    db,
    executor: new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
    }),
    store: new LocalEvidenceStore(dir),
    secrets: (name) => (name === 'DEMO_PASSWORD' ? PASSWORD : undefined),
  };
});
afterAll(async () => {
  await closeDemo();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('executable approval (ADR-0008)', () => {
  it('the proposer cannot approve their own executable; unapproved cases cannot get one', async () => {
    const story = await db.query<{ id: string }>(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_x','t','p','RUN-X',1,'t','d','[]','x') RETURNING id`,
    );
    const c = await createTestCase(db, S, {
      storyId: story[0]!.id,
      workflowId: null,
      content: draft,
      sourceRefs: ['AC-LOGIN@v1'],
      authorId: a.agent.id,
    });
    await expect(proposeExecutable(db, a.qa, c.caseId, loginValidSpec)).rejects.toThrow(/not APPROVED/);
    await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
    const exe = await proposeExecutable(db, a.qa, c.caseId, loginValidSpec);
    await expect(reviewExecutable(db, a.qa, exe.id, { decision: 'APPROVE' })).rejects.toThrow(
      /own executable/,
    );
    await expect(reviewExecutable(db, a.po, exe.id, { decision: 'APPROVE' })).rejects.toThrow(
      /cannot review/,
    );
    expect((await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' })).status).toBe('APPROVED');
  });

  it('rejects specs whose steps cite sources the approved case does not', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const untraced = {
      ...loginValidSpec,
      steps: loginValidSpec.steps.map((s) => ({ ...s, sourceRefs: ['OTHER@v9'] })),
    };
    await expect(proposeExecutable(db, a.qa, caseId, untraced)).rejects.toThrow(/outside the approved case/);
  });

  it('rejects requests to run a case without an approved executable', async () => {
    await expect(
      requestRun(deps, a.qa, { caseId: 'case_missing', environmentId: 'staging' }),
    ).rejects.toThrow(/no approved executable/);
  });
});

describe('Workflow B: authorized execution', () => {
  it('PASSED end to end with evidence, policy evaluation and audit', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const queued = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    expect(queued.state).toBe('QUEUED');
    const done = await workOnce(deps, 'worker-1');
    expect(done).toMatchObject({ id: queued.id, state: 'PASSED', reason: 'ALL_ASSERTIONS_PASSED' });
    const report = await getRunReport(db, S, queued.id);
    expect(report).toMatchObject({
      status: 'PASSED',
      suspectedCause: null,
      blockedRequests: ['https://tracker.example.invalid/pixel.gif'],
    });
    expect(report.evidence.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['screenshot', 'step-log', 'network-log']),
    );
    const policy = await db.query<{ gate: string; action_kind: string }>(
      `SELECT gate, action_kind FROM policy_evaluations WHERE action_kind = 'execute' ORDER BY created_at DESC LIMIT 2`,
    );
    expect(policy.map((p) => p.gate)).toEqual(['AUTO_PROCEED', 'AUTO_PROCEED']); // at request + at execution
  });

  it('FAILED is recorded from the deterministic assertion, never from a model', async () => {
    const caseId = await approvedCase(loginInvalidSpec);
    // Reintroduce BUG-1042 on a separate demo instance and point the environment at it.
    const buggy = await startDemoApp({ bugUserNotFoundMessage: true });
    await upsertEnvironment(db, S, {
      id: 'buggy',
      kind: 'staging',
      allowedActions: ['execute'],
      baseUrl: buggy.baseUrl,
      allowedHosts: [new URL(buggy.baseUrl).host],
    });
    try {
      const run = await requestRun(deps, a.qa, { caseId, environmentId: 'buggy' });
      const done = await workOnce(deps, 'worker-1');
      expect(done).toMatchObject({ id: run.id, state: 'FAILED', reason: 'ASSERTION_FAILED:message' });
      expect((await getRunReport(db, S, run.id)).assertions[0]).toMatchObject({
        actual: 'User not found',
        passed: false,
      });
    } finally {
      await buggy.app.close();
    }
  });

  it('an explicit idempotency key never creates or executes a second run', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const first = await requestRun(deps, a.qa, { caseId, environmentId: 'staging', idempotencyKey: 'k-1' });
    const again = await requestRun(deps, a.qa, { caseId, environmentId: 'staging', idempotencyKey: 'k-1' });
    expect(again.id).toBe(first.id);
    await workOnce(deps, 'worker-1');
    expect(await workOnce(deps, 'worker-1')).toBeNull();
  });
});

describe('Workflow B: policy gates', () => {
  it('destructive steps are BLOCKED pending a scoped approval; the account is untouched', async () => {
    const caseId = await approvedCase(deleteAccountSpec);
    const run = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    expect(run).toMatchObject({
      state: 'BLOCKED',
      reason: expect.stringContaining('SCOPED_APPROVAL_REQUIRED'),
    });
    expect(run.reviewId).toBeTruthy();
    expect(await workOnce(deps, 'worker-1')).toBeNull();
    expect(await canSignIn()).toBe(true);
  });

  it('with a valid scoped approval the destructive run executes; a revoked approval is re-checked before execution', async () => {
    const caseId = await approvedCase(deleteAccountSpec);
    const blocked = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    const { approval } = await resolveReview(db, a.lead, blocked.reviewId!, {
      action: 'APPROVE',
      reason: 'sandbox data',
    });

    // Revoked between request and execution: the worker blocks it.
    const revoked = await requestRun(deps, a.qa, {
      caseId,
      environmentId: 'staging',
      approvalId: approval!.id,
    });
    expect(revoked.state).toBe('QUEUED');
    await revokeApproval(db, S, approval!.id);
    expect(await workOnce(deps, 'worker-1')).toMatchObject({
      state: 'BLOCKED',
      reason: expect.stringContaining('SCOPED_APPROVAL_REQUIRED'),
    });
    expect(await canSignIn()).toBe(true);

    // A fresh approval: executes, and the spec's teardown restores the demo account.
    const again = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    const fresh = await resolveReview(db, a.lead, again.reviewId!, {
      action: 'APPROVE',
      reason: 'sandbox data',
    });
    await requestRun(deps, a.qa, { caseId, environmentId: 'staging', approvalId: fresh.approval!.id });
    expect(await workOnce(deps, 'worker-1')).toMatchObject({ state: 'PASSED' });
    expect(await canSignIn()).toBe(true);
  });

  it('an approval for another environment does not transfer', async () => {
    const caseId = await approvedCase(deleteAccountSpec);
    const blocked = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    const { approval } = await resolveReview(db, a.lead, blocked.reviewId!, {
      action: 'APPROVE',
      reason: 'ok',
    });
    const other = await requestRun(deps, a.qa, { caseId, environmentId: 'buggy', approvalId: approval!.id });
    expect(other.state).toBe('BLOCKED');
  });

  it('production is denied even for non-destructive specs', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const run = await requestRun(deps, a.qa, { caseId, environmentId: 'production' });
    expect(run).toMatchObject({ state: 'BLOCKED', reason: 'DENIED:PRODUCTION_WRITE_DISABLED' });
  });

  it('environments without an allowlisted target are denied', async () => {
    const caseId = await approvedCase(loginValidSpec);
    expect(await requestRun(deps, a.qa, { caseId, environmentId: 'no-target' })).toMatchObject({
      state: 'BLOCKED',
      reason: 'DENIED:ENVIRONMENT_NOT_EXECUTABLE',
    });
  });

  it("the requester's authority is re-checked at execution time", async () => {
    const caseId = await approvedCase(loginValidSpec);
    await createActor(db, S, { id: 'p-temp', name: 'temp', roles: ['QA_ENGINEER'] });
    const temp = { id: 'p-temp', tenantId: 't', projectId: 'p', roles: ['QA_ENGINEER' as const] };
    const run = await requestRun(deps, temp, { caseId, environmentId: 'staging' });
    await createActor(db, S, { id: 'p-temp', name: 'temp', roles: ['PRODUCT_OWNER'] }); // role changed
    expect(await workOnce(deps, 'worker-1')).toMatchObject({
      id: run.id,
      state: 'BLOCKED',
      reason: 'DENIED:ACTOR_NOT_AUTHORIZED',
    });
  });
});

describe('Workflow B: resilience and isolation', () => {
  it('a lease lost before execution blocks the run; one lost while RUNNING is INCONCLUSIVE, never re-run', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const early = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    await claimNextRun(db, 'crashed-worker', 1); // claimed, then the worker "dies" during policy check
    const mid = await requestRun(deps, a.qa, { caseId, environmentId: 'staging' });
    const claimed = await claimNextRun(db, 'crashed-worker', 1);
    await updateRunState(db, S, claimed!.id, 'POLICY_CHECK', { state: 'RUNNING', started: true }); // dies mid-run
    await new Promise((r) => setTimeout(r, 5)); // let the 1 ms leases lapse

    expect(await workOnce(deps, 'worker-2')).toBeNull();
    expect(await getRun(db, S, early.id)).toMatchObject({
      state: 'BLOCKED',
      reason: 'LEASE_LOST_BEFORE_EXECUTION',
    });
    expect(await getRun(db, S, mid.id)).toMatchObject({ state: 'INCONCLUSIVE', reason: 'LEASE_LOST' });
  });

  // Meaningful against real PostgreSQL (QA_TEST_DATABASE_URL), where claims use separate connections.
  it('concurrent workers never claim the same run', async () => {
    const caseId = await approvedCase(loginValidSpec);
    const queued = await Promise.all(
      Array.from({ length: 4 }, () => requestRun(deps, a.qa, { caseId, environmentId: 'staging' })),
    );
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) => claimNextRun(db, `racer-${i}`, 60_000)),
    );
    const claimed = claims.filter((c) => c !== null);
    onTestFinished(async () => {
      for (const c of claimed) {
        await updateRunState(db, S, c.id, 'POLICY_CHECK', { state: 'BLOCKED', reason: 'TEST_RELEASED' });
      }
    });

    expect(claimed.map((c) => c.id).sort()).toEqual(queued.map((r) => r.id).sort());
    expect(new Set(claimed.map((c) => c.leaseOwner)).size).toBe(queued.length);
  });

  it('run reports are tenant scoped', async () => {
    const other = await seedProject(db, { tenantId: 't2', projectId: 'p2' });
    const caseId = await approvedCase(loginValidSpec);
    const run = await requestRun(deps, a.qa, { caseId, environmentId: 'production' });
    await expect(getRunReport(db, other.qa, run.id)).rejects.toThrow(/not found/);
    expect((await workflowUsage(db, S, 'none')).usage).toEqual([]);
  });
});
