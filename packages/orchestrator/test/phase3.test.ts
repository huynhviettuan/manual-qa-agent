import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestCase,
  createTestDb,
  getRun,
  latestTriage,
  seedProject,
  upsertEnvironment,
  workflowUsage,
  type Db,
  type SeededActors,
} from '@qa/db';
import { startDemoApp } from '@qa/demo-sut';
import { loginInvalidSpec, loginValidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { createFakeJira, JiraCloudTracker } from '@qa/integrations';
import { createProvidersFromEnv } from '@qa/llm-adapter';
import { ingestSource } from '@qa/retrieval';
import { resolveReview, reviewTestCase } from '@qa/review';
import {
  buildReproduction,
  driftAlerts,
  projectMetrics,
  proposeBug,
  proposeExecutable,
  publishBug,
  requestRun,
  reviewExecutable,
  revertBug,
  submitStory,
  triageRun,
  workOnce,
  type BugDeps,
  type RunDeps,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
const PASSWORD = 'phase3-password';
let db: Db;
let a: SeededActors;
let dir: string;
let runDeps: RunDeps;
let bugDeps: BugDeps;
let jira: ReturnType<typeof createFakeJira>;
const closers: Array<() => Promise<unknown>> = [];
const providers = createProvidersFromEnv({});
let n = 0;

const draft = {
  title: 'Wrong-password message',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [
    {
      action: 'Sign in with a wrong password',
      expected: 'Invalid email or password',
      sourceRefs: ['AC-LOGIN@v1'],
    },
  ],
  assumptions: [],
  missingRequirements: [],
};

async function caseWithExecutable(spec: unknown) {
  const id = `story_p3_${++n}`;
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,'t','d','[]','x')`,
    [id, `P3-${n}`],
  );
  const c = await createTestCase(db, S, {
    storyId: id,
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

/** A FAILED run reproducing BUG-1042 (wrong-password message leaks account existence). */
async function failedRun() {
  const caseId = await caseWithExecutable(loginInvalidSpec);
  const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'buggy' });
  await workOnce(runDeps, 'p3-worker');
  return (await getRun(db, S, run.id))!;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const buggy = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA' },
    bugUserNotFoundMessage: true,
  });
  closers.push(() => buggy.app.close());
  await upsertEnvironment(db, S, {
    id: 'buggy',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
    baseUrl: buggy.baseUrl,
    allowedHosts: [new URL(buggy.baseUrl).host],
  });
  dir = await mkdtemp(join(tmpdir(), 'qa-p3-'));
  const store = new LocalEvidenceStore(dir);
  runDeps = {
    db,
    store,
    executor: new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
    }),
    secrets: (name) => (name === 'DEMO_PASSWORD' ? PASSWORD : undefined),
    triager: providers.triager,
  };
  jira = createFakeJira({ projectKey: 'QA' });
  bugDeps = {
    db,
    store,
    tracker: new JiraCloudTracker({
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.test',
      apiToken: 'fake',
      projectKey: 'QA',
      fetch: jira.fetch,
    }),
  };
});
afterAll(async () => {
  for (const c of closers) await c();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('failure triage (QA-019)', () => {
  it('the worker triages a FAILED run, escalates a security-relevant suspicion, and never changes the verdict', async () => {
    const run = await failedRun();
    expect(run).toMatchObject({ state: 'FAILED', reason: 'ASSERTION_FAILED:message' });
    const triage = (await latestTriage(db, S, run.id))!;
    expect(triage).toMatchObject({
      suspectedCause: 'PRODUCT_DEFECT',
      securitySensitive: true,
      verifiedCause: null,
      outcome: 'OK',
    });
    const review = await db.query<{ kind: string; assigned_role: string; question: string }>(
      'SELECT kind, assigned_role, question FROM review_tasks WHERE id = $1',
      [triage.reviewId],
    );
    expect(review[0]).toMatchObject({ kind: 'SECURITY_TRIAGE', assigned_role: 'QA_LEAD' });
    expect(review[0]!.question).toMatch(/Suggested cause: PRODUCT_DEFECT \(unverified\)/);
    expect((await getRun(db, S, run.id))!.state).toBe('FAILED');
  });

  it('only the lead may confirm a security triage; confirmation requires a cause', async () => {
    const run = await failedRun();
    const triage = (await latestTriage(db, S, run.id))!;
    await expect(
      resolveReview(db, a.qa, triage.reviewId!, {
        action: 'APPROVE',
        reason: 'x',
        confirmedCause: 'PRODUCT_DEFECT',
      }),
    ).rejects.toThrow(/QA_LEAD/);
    await expect(
      resolveReview(db, a.lead, triage.reviewId!, { action: 'APPROVE', reason: 'x' }),
    ).rejects.toThrow(/confirmedCause/);
    await resolveReview(db, a.lead, triage.reviewId!, {
      action: 'APPROVE',
      reason: 'Reproduced manually',
      confirmedCause: 'PRODUCT_DEFECT',
    });
    expect(await latestTriage(db, S, run.id)).toMatchObject({
      verifiedCause: 'PRODUCT_DEFECT',
      verifiedBy: a.lead.id,
    });
  });

  it('PASSED runs are not triaged', async () => {
    const caseId = await caseWithExecutable(loginValidSpec);
    const run = await requestRun(runDeps, a.qa, { caseId, environmentId: 'buggy' });
    await workOnce(runDeps, 'p3-worker');
    await expect(triageRun({ ...runDeps, triager: providers.triager }, a.qa, run.id)).rejects.toThrow(
      /only FAILED or INCONCLUSIVE/,
    );
  });

  it('the reproduction is deterministic, marks the failure and never contains the secret', async () => {
    const run = await failedRun();
    const md = await buildReproduction(db, runDeps.store, S, run.id);
    expect(md).toContain('# Reproduction: Wrong-password message');
    expect(md).toMatch(/FAILED: expected "Invalid email or password" but was "User not found"/);
    expect(md).toContain('PRODUCT_DEFECT (suggested, unverified)');
    expect(md).not.toContain(PASSWORD);
  });
});

describe('Jira bug filing (QA-020)', () => {
  it('requires a human-verified PRODUCT_DEFECT, then a scoped approval; publishes once; reverts audibly', async () => {
    const run = await failedRun();
    await expect(proposeBug(bugDeps, a.qa, run.id)).rejects.toThrow(/verify the triage/);
    const triage = (await latestTriage(db, S, run.id))!;
    await resolveReview(db, a.lead, triage.reviewId!, {
      action: 'APPROVE',
      reason: 'ok',
      confirmedCause: 'PRODUCT_DEFECT',
    });

    const bug = await proposeBug(bugDeps, a.agent, run.id); // the agent may draft...
    expect(bug).toMatchObject({
      status: 'DRAFT',
      labels: ['qa-agent', `qa-agent-run-${run.id}`, 'security'],
    });
    expect(bug.summary).toMatch(/expected "Invalid email or password" but got "User not found"/);
    expect(await proposeBug(bugDeps, a.qa, run.id)).toMatchObject({ id: bug.id }); // one active bug per run

    // ...but nobody can publish without the scoped approval, and the agent never can.
    await expect(publishBug(bugDeps, a.qa, bug.id, 'appr_fake')).rejects.toThrow(/not allowed/);
    const { approval } = await resolveReview(db, a.lead, bug.reviewId!, {
      action: 'APPROVE',
      reason: 'file it',
    });
    await expect(publishBug(bugDeps, a.agent, bug.id, approval!.id)).rejects.toThrow(/ACTOR_NOT_AUTHORIZED/);
    expect(jira.issues.size).toBe(0);

    const published = await publishBug(bugDeps, a.qa, bug.id, approval!.id);
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      externalKey: 'QA-1',
      externalUrl: 'https://example.atlassian.net/browse/QA-1',
    });
    expect(await publishBug(bugDeps, a.qa, bug.id, approval!.id)).toMatchObject({ externalKey: 'QA-1' });
    expect(jira.issues.size).toBe(1);
    expect(JSON.stringify(jira.issues.get('QA-1')!.fields.description)).not.toContain(PASSWORD);

    await expect(revertBug(bugDeps, a.qa, bug.id, 'dup')).rejects.toThrow(/QA lead/);
    expect(await revertBug(bugDeps, a.lead, bug.id, 'Duplicate of QA-0')).toMatchObject({
      status: 'REVERTED',
    });
    expect(jira.issues.get('QA-1')!.fields.labels).toContain('qa-agent-reverted');
  });

  it('a crash after the external write never duplicates the issue (label-based idempotency)', async () => {
    const run = await failedRun();
    const triage = (await latestTriage(db, S, run.id))!;
    await resolveReview(db, a.lead, triage.reviewId!, {
      action: 'APPROVE',
      reason: 'ok',
      confirmedCause: 'PRODUCT_DEFECT',
    });
    const bug = await proposeBug(bugDeps, a.qa, run.id);
    const { approval } = await resolveReview(db, a.lead, bug.reviewId!, { action: 'APPROVE', reason: 'ok' });
    // Simulate: the issue was created in Jira, then our process died before recording it.
    await bugDeps.tracker!.create({ summary: bug.summary, description: 'd', labels: bug.labels });
    const before = jira.issues.size;
    const published = await publishBug(bugDeps, a.qa, bug.id, approval!.id);
    expect(jira.issues.size).toBe(before);
    expect(published.status).toBe('PUBLISHED');
  });

  it('a Jira outage leaves the bug PUBLISH_FAILED and retryable', async () => {
    const run = await failedRun();
    const triage = (await latestTriage(db, S, run.id))!;
    await resolveReview(db, a.lead, triage.reviewId!, {
      action: 'APPROVE',
      reason: 'ok',
      confirmedCause: 'PRODUCT_DEFECT',
    });
    const down = createFakeJira({ failCreateTimes: 99 });
    const downDeps = {
      ...bugDeps,
      tracker: new JiraCloudTracker({
        baseUrl: 'https://example.atlassian.net',
        email: 'b',
        apiToken: 'f',
        projectKey: 'QA',
        fetch: down.fetch,
      }),
    };
    const bug = await proposeBug(downDeps, a.qa, run.id);
    const { approval } = await resolveReview(db, a.lead, bug.reviewId!, { action: 'APPROVE', reason: 'ok' });
    expect(await publishBug(downDeps, a.qa, bug.id, approval!.id)).toMatchObject({
      status: 'PUBLISH_FAILED',
      error: expect.stringMatching(/503/),
    });
    expect(await publishBug(bugDeps, a.qa, bug.id, approval!.id)).toMatchObject({ status: 'PUBLISHED' });
  });

  it('is unavailable when the integration is disabled; a verified TEST_ISSUE never becomes a bug', async () => {
    const run = await failedRun();
    await expect(proposeBug({ ...bugDeps, tracker: null }, a.qa, run.id)).rejects.toThrow(/disabled/);
    const triage = (await latestTriage(db, S, run.id))!;
    await resolveReview(db, a.lead, triage.reviewId!, {
      action: 'APPROVE',
      reason: 'selector drift',
      confirmedCause: 'TEST_ISSUE',
    });
    await expect(proposeBug(bugDeps, a.qa, run.id)).rejects.toThrow(/PRODUCT_DEFECT/);
  });
});

describe('decision cache (QA-021)', () => {
  it('an identical readiness input is answered from the cache with zero provider tokens', async () => {
    await ingestSource(db, a.po, {
      meta: {
        sourceId: 'SRC-CACHE',
        version: 'v1',
        sourceType: 'ACCEPTANCE_CRITERIA',
        trustTier: 'T1',
        approvalStatus: 'APPROVED',
        approvedBy: 'po',
        owner: 'po',
        ruleKeys: [],
        effectiveFrom: new Date('2026-01-01'),
      },
      body: '# AC-CACHE-1\nSaving shows "Saved".',
    });
    const deps = {
      db,
      classifier: providers.classifier,
      generator: providers.generator,
      decisionCacheTtlMs: 3_600_000,
    };
    const story = {
      externalId: 'CACHE-1',
      title: 'Save',
      description: 'd',
      acceptanceCriteria: [{ id: 'AC-CACHE-1', text: 'Saving shows "Saved".' }],
    };
    const first = await submitStory(deps, a.qa, story, { idempotencyKey: 'cache-a' });
    const second = await submitStory(deps, a.qa, story, { idempotencyKey: 'cache-b' });
    expect(second.outcome.route).toBe(first.outcome.route);
    const d1 = (await workflowUsage(db, S, first.workflowId)).decisions.find((d) => d.kind === 'readiness')!;
    const d2 = (await workflowUsage(db, S, second.workflowId)).decisions.find((d) => d.kind === 'readiness')!;
    expect(d1).toMatchObject({ cacheHit: false });
    expect(d2).toMatchObject({ cacheHit: true, usage: { inputTokens: 0, outputTokens: 0 } });
    // Another project never sees this project's cache.
    const other = await seedProject(db, { tenantId: 't9', projectId: 'p9' });
    await expect(submitStory(deps, other.qa, story, { idempotencyKey: 'cache-c' })).resolves.toMatchObject({
      outcome: { route: 'REVIEW_REQUESTED', reason: 'NO_TRUSTED_CONTEXT' },
    });
  });
});

describe('metrics and drift alerts (QA-022)', () => {
  it('summarizes the project and raises alerts against thresholds', async () => {
    const m = await projectMetrics(db, S, 7);
    expect(m.runs.byState.FAILED).toBeGreaterThan(0);
    expect(m.triage.securityEscalations).toBeGreaterThan(0);
    expect(m.triage.verified).toBeGreaterThan(0);
    expect(m.decisions.cacheHitRate).toBeGreaterThan(0);
    const alerts = await driftAlerts(db, S, {
      providerFailureRate: 1,
      tokenSpikeFactor: 1000,
      reviewBacklogHours: 1000,
      deniedActionsPerDay: 0,
      triageDisagreementRate: 0,
      confidenceDrift: 1,
      inconclusiveRate: 1,
      minSample: 1,
    });
    expect(alerts.map((x) => x.rule)).toEqual(
      expect.arrayContaining(['DENIED_ACTIONS_SPIKE', 'TRIAGE_DISAGREEMENT']),
    );
  });
});
