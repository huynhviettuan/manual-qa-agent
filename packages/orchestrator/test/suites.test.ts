import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestCase,
  createTestDb,
  seedProject,
  upsertEnvironment,
  type Db,
  type SeededActors,
} from '@qa/db';
import { startDemoApp } from '@qa/demo-sut';
import { loginInvalidSpec, loginValidSpec } from '@qa/demo-sut/specs';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor } from '@qa/execution';
import { reviewTestCase } from '@qa/review';
import {
  addSuiteCases,
  createSuite,
  getSuiteDetail,
  getSuiteRunReport,
  proposeExecutable,
  reviewExecutable,
  runSuite,
  workOnce,
  type RunDeps,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
const PASSWORD = 'pilot-password-123';
let db: Db;
let a: SeededActors;
let deps: RunDeps;
let dir: string;
let closeDemo: () => Promise<unknown>;
let n = 0;

const draft = (title: string) => ({
  title,
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [{ action: 'Sign in', expected: 'Welcome back', sourceRefs: ['AC-LOGIN@v1'] }],
  assumptions: [],
  missingRequirements: [],
});

/** A case in the given state: draft, approved (manual) or approved with an approved executable. */
async function testCase(
  title: string,
  state: 'draft' | 'manual' | 'automated',
  spec: unknown = loginValidSpec,
) {
  const story = await db.query<{ id: string }>(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,$3,'d','[]','x') RETURNING id`,
    [`story_s${++n}`, `SUITE-${n}`, title],
  );
  const c = await createTestCase(db, S, {
    storyId: story[0]!.id,
    workflowId: null,
    content: draft(title),
    sourceRefs: ['AC-LOGIN@v1'],
    authorId: a.agent.id,
  });
  if (state === 'draft') return c.caseId;
  await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
  if (state === 'manual') return c.caseId;
  const exe = await proposeExecutable(db, a.qa, c.caseId, spec);
  await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
  return c.caseId;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const demo = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA Tester' },
  });
  closeDemo = () => demo.app.close();
  const host = new URL(demo.baseUrl).host;
  await upsertEnvironment(db, S, {
    id: 'staging',
    kind: 'staging',
    allowedActions: ['draft', 'execute'],
    baseUrl: demo.baseUrl,
    allowedHosts: [host],
  });
  dir = await mkdtemp(join(tmpdir(), 'qa-suites-'));
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

describe('test suites', () => {
  it('only QA roles manage suites, names are unique per project, and unknown or foreign cases are refused', async () => {
    await expect(createSuite(db, a.po, { name: 'Regression' })).rejects.toThrow(/cannot manage/);
    const suite = await createSuite(db, a.qa, { name: 'Unique name' });
    await expect(createSuite(db, a.lead, { name: 'Unique name' })).rejects.toThrow(/already exists/);

    const other = await seedProject(db, { tenantId: 't2', projectId: 'p2' });
    const foreign = await createSuite(db, other.qa, { name: 'Unique name' }); // same name, other project
    await expect(getSuiteDetail(db, S, foreign.id)).rejects.toThrow(/not found/);
    await expect(addSuiteCases(db, a.qa, suite.id, [{ caseId: 'case_missing' }])).rejects.toThrow(
      /not found/,
    );
    const mine = await testCase('Mine', 'manual');
    await expect(addSuiteCases(db, other.qa, foreign.id, [{ caseId: mine }])).rejects.toThrow(/not found/);
  });

  it('runs automated cases, lists manual and unapproved ones, and reports per-case verdicts', async () => {
    const passing = await testCase('Valid sign-in', 'automated', loginValidSpec);
    const invalid = await testCase('Wrong password', 'automated', loginInvalidSpec);
    const manual = await testCase('Lockout after 5 attempts', 'manual');
    const unapproved = await testCase('Still a draft', 'draft');
    const suite = await createSuite(db, a.qa, { name: 'Login regression', description: 'Sign-in flows' });
    const detail = await addSuiteCases(db, a.qa, suite.id, [
      { caseId: passing, section: 'Sign-in' },
      { caseId: invalid, section: 'Sign-in' },
      { caseId: manual, section: 'Lockout' },
      { caseId: unapproved, section: 'Lockout' },
    ]);
    expect(detail.cases.map((c) => [c.title, c.section, c.automated])).toEqual([
      ['Valid sign-in', 'Sign-in', true],
      ['Wrong password', 'Sign-in', true],
      ['Lockout after 5 attempts', 'Lockout', false],
      ['Still a draft', 'Lockout', false],
    ]);

    const started = await runSuite(deps, a.qa, suite.id, { environmentId: 'staging' });
    expect(started.complete).toBe(false);
    expect(started.totals).toMatchObject({ cases: 4, pending: 2, notAutomated: 1, notApproved: 1 });

    while (await workOnce(deps, 'suite-worker')) {
      /* drain */
    }
    const report = await getSuiteRunReport(db, S, started.id);
    expect(report.complete).toBe(true);
    expect(report.totals).toMatchObject({
      passed: 2,
      failed: 0,
      pending: 0,
      notAutomated: 1,
      notApproved: 1,
    });
    expect(report.items.find((i) => i.caseId === manual)).toMatchObject({
      status: 'NOT_AUTOMATED',
      runId: null,
    });
    expect(report.items.find((i) => i.caseId === passing)).toMatchObject({
      status: 'PASSED',
      sourceRefs: ['AC-LOGIN@v1'],
    });
    expect(report.items.find((i) => i.caseId === passing)!.evidence).toBeGreaterThan(0);
  });

  it('a second suite run requests new runs; the first report is unchanged', async () => {
    const c = await testCase('Repeatable', 'automated');
    const suite = await createSuite(db, a.qa, { name: 'Repeat' });
    await addSuiteCases(db, a.qa, suite.id, [{ caseId: c }]);
    const first = await runSuite(deps, a.qa, suite.id, { environmentId: 'staging' });
    const second = await runSuite(deps, a.qa, suite.id, { environmentId: 'staging' });
    expect(second.items[0]!.runId).not.toBe(first.items[0]!.runId);
    while (await workOnce(deps, 'suite-worker')) {
      /* drain */
    }
    expect((await getSuiteRunReport(db, S, first.id)).items[0]!.status).toBe('PASSED');
  });
});
