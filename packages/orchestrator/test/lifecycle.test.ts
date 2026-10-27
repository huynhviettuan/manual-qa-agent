import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignMissingCaseCodes,
  claimNextRun,
  createOrGetRun,
  createTestCase,
  createTestDb,
  getRun,
  seedProject,
  updateRunState,
  upsertEnvironment,
  type Db,
  type SeededActors,
} from '@qa/db';
import { loginValidSpec } from '@qa/demo-sut/specs';
import { caseCodePrefix, DomainError } from '@qa/domain';
import { ingestSource } from '@qa/retrieval';
import { reviewTestCase } from '@qa/review';
import {
  addSuiteCases,
  createSuite,
  getCoverage,
  projectMetrics,
  getSuiteRunReport,
  proposeExecutable,
  recordManualRun,
  regressionScope,
  reviewExecutable,
  runSuite,
  setKnownBug,
  staleCases,
  testCasesCsv,
  testDesignMarkdown,
} from '../src/index.ts';

// ADR-0021: what a case needs over its life. Nothing here calls a model or a browser.

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
let n = 0;

const src = (sourceId: string, version: string, body: string) => ({
  meta: {
    sourceId,
    version,
    sourceType: 'SPECIFICATION' as const,
    trustTier: 'T1' as const,
    approvalStatus: 'APPROVED' as const,
    approvedBy: 'po',
    owner: 'po',
    ruleKeys: [],
    effectiveFrom: new Date(`2026-0${version.slice(-1)}-01`),
  },
  body,
});

const content = (title: string, refs: string[], extra: Record<string, unknown> = {}) => ({
  title,
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [
    { action: 'Book a session', expected: 'Message "Hết buổi" is shown', sourceRefs: refs, testData: '' },
  ],
  assumptions: [],
  missingRequirements: [],
  requirementRefs: refs,
  module: 'Booking',
  level: 'manual',
  ...extra,
});

async function newCase(title: string, refs: string[], extra: Record<string, unknown> = {}, approve = true) {
  const story = await db.query<{ id: string }>(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,$3,'d','[]','x') RETURNING id`,
    [`story_l${++n}`, `LIFE-${n}`, title],
  );
  const c = await createTestCase(db, S, {
    storyId: story[0]!.id,
    workflowId: null,
    content: content(title, refs, extra),
    sourceRefs: refs,
    authorId: a.agent.id,
  });
  if (approve) await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
  return c;
}

const pass = (k: number) => Array.from({ length: k }, () => ({ status: 'PASSED' as const }));

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await ingestSource(
    db,
    a.po,
    src('BR-404', 'v1', '# BR-404\nA booking needs a session left; otherwise "Hết buổi".'),
  );
});
afterAll(() => db.close());

describe('case codes', () => {
  it('derives a prefix from the module and numbers cases per prefix and project', async () => {
    expect(caseCodePrefix('Booking and sessions')).toBe('BOOKIN');
    expect(caseCodePrefix('Đặt lịch PT')).toBe('DAT');
    expect(caseCodePrefix('')).toBe('CASE');
    expect(caseCodePrefix('a b')).toBe('CASE');

    const first = await newCase('Code one', ['BR-404@v1'], {}, false);
    const second = await newCase('Code two', ['BR-404@v1'], {}, false);
    const other = await newCase('Code other', ['BR-404@v1'], { module: 'Money' }, false);
    expect(first.code).toMatch(/^BOOKIN-\d{3}$/);
    expect(Number(second.code!.slice(-3))).toBe(Number(first.code!.slice(-3)) + 1);
    expect(other.code).toBe('MONEY-001');

    const foreign = await seedProject(db, { tenantId: 't2', projectId: 'p2' });
    const story = await db.query<{ id: string }>(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_l_foreign','t2','p2','X',1,'t','d','[]','x') RETURNING id`,
    );
    const theirs = await createTestCase(db, foreign.qa, {
      storyId: story[0]!.id,
      workflowId: null,
      content: content('Theirs', [], { module: 'Money' }),
      sourceRefs: [],
      authorId: foreign.qa.id,
    });
    expect(theirs.code).toBe('MONEY-001'); // sequences are per project
  });
});

describe('known bugs', () => {
  it('is set by reviewers only, validated, audited, and labels results without changing them', async () => {
    const c = await newCase('Known bug case', ['BR-404@v1']);
    await expect(setKnownBug(db, a.agent, c.caseId, 'BUG-041')).rejects.toThrow(/AI agent/);
    await expect(setKnownBug(db, a.po, c.caseId, 'BUG-041')).rejects.toThrow(/cannot mark/);
    await expect(setKnownBug(db, a.qa, c.caseId, 'fixed later')).rejects.toThrow(DomainError);
    await expect(setKnownBug(db, a.qa, 'case_missing', 'BUG-041')).rejects.toThrow(/not found/);
    expect(await setKnownBug(db, a.qa, c.caseId, 'BUG-041')).toMatchObject({
      caseId: c.caseId,
      knownBug: 'BUG-041',
    });

    const suite = await createSuite(db, a.qa, { name: 'Known bugs' });
    await addSuiteCases(db, a.qa, suite.id, [{ caseId: c.caseId }]);
    const started = await runSuite({ db, probe: null }, a.qa, suite.id, {
      environmentId: 'staging',
      build: 'a981386',
    });
    expect(started.status).toBe('REQUESTED');
    expect(started.build).toBe('a981386');

    await recordManualRun(db, a.qa, {
      caseId: c.caseId,
      suiteRunId: started.id,
      environmentId: 'staging',
      steps: [{ status: 'FAILED', actual: 'No message; the booking is saved (BUG-041)' }],
    });
    let report = await getSuiteRunReport(db, S, started.id);
    expect(report.items[0]).toMatchObject({
      code: c.code,
      status: 'FAILED',
      knownBug: 'BUG-041',
      expectedFailure: true,
      retestNeeded: false,
    });
    expect(report.totals).toMatchObject({ failed: 1, expectedFailures: 1, retestNeeded: 0 });

    await recordManualRun(db, a.qa, {
      caseId: c.caseId,
      suiteRunId: started.id,
      environmentId: 'staging',
      steps: pass(1),
    });
    report = await getSuiteRunReport(db, S, started.id);
    expect(report.items[0]).toMatchObject({ status: 'PASSED', expectedFailure: false, retestNeeded: true });
    expect(report.totals).toMatchObject({ passed: 1, retestNeeded: 1 });

    const csv = await testCasesCsv(db, S);
    const row = csv.split('\r\n').find((l) => l.startsWith(`${c.code},`))!;
    expect(row).toContain('Known bug BUG-041');

    const audits = await db.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE action_kind = 'CASE_KNOWN_BUG_SET' AND target = $1`,
      [c.caseId],
    );
    expect(audits.map((r) => r.outcome)).toEqual(['BUG-041']);

    expect(await setKnownBug(db, a.lead, c.caseId, null)).toMatchObject({ knownBug: null });
    report = await getSuiteRunReport(db, S, started.id);
    expect(report.items[0]).toMatchObject({ knownBug: null, retestNeeded: false });
  });
});

describe('stale cases and regression scope', () => {
  it('flags approved cases citing a superseded version and selects the cases of one requirement', async () => {
    const cited = await newCase('Cites BR-404 v1', ['BR-404@v1'], { priority: 'P2' });
    const p0 = await newCase('A P0 elsewhere', [], { priority: 'P0', module: 'Money' });
    const draft = await newCase('Still a draft', ['BR-404@v1'], {}, false);
    const guard = await newCase('Guards a defect', [], { priority: 'P3', module: 'Money' });
    await setKnownBug(db, a.qa, guard.caseId, 'BUG-007');

    expect((await staleCases(db, S)).map((s) => s.caseId)).not.toContain(cited.caseId);

    await ingestSource(
      db,
      a.po,
      src('BR-404', 'v2', '# BR-404\nA booking needs a session left; otherwise "Hết buổi tập".'),
    );
    const stale = await staleCases(db, S);
    const mine = stale.find((s) => s.caseId === cited.caseId)!;
    expect(mine).toMatchObject({ code: cited.code, refs: [{ ref: 'BR-404@v1', status: 'SUPERSEDED' }] });
    expect(stale.map((s) => s.caseId)).not.toContain(draft.caseId); // only approved cases are stale
    expect((await getCoverage(db, S)).totals.staleCases).toBe(stale.length);

    const scope = await regressionScope(db, S, 'BR-404');
    expect(scope.cited.map((c) => c.caseId)).toContain(cited.caseId);
    expect(scope.cited.map((c) => c.caseId)).not.toContain(draft.caseId);
    expect(scope.p0.map((c) => c.caseId)).toContain(p0.caseId);
    expect(scope.guarding.find((c) => c.caseId === guard.caseId)?.bugs).toEqual(['BUG-007']);
    expect(scope.caseIds).toEqual(expect.arrayContaining([cited.caseId, p0.caseId, guard.caseId]));
    expect((await regressionScope(db, S, 'BR-404@v1')).cited.map((c) => c.caseId)).toContain(cited.caseId);
    expect((await regressionScope(db, S, 'NOPE-1')).cited).toEqual([]);
  });
});

describe('suite preflight', () => {
  it('blocks the whole run with a reason before any case is queued', async () => {
    const manual = await newCase('Manual only', ['BR-404@v2']);
    const auto = await newCase('Automated', ['AC-LOGIN@v1'], { level: 'ui' }); // the demo spec cites AC-LOGIN
    const exe = await proposeExecutable(db, a.qa, auto.caseId, loginValidSpec);
    await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    const suite = await createSuite(db, a.qa, { name: 'Preflight' });
    await addSuiteCases(db, a.qa, suite.id, [{ caseId: manual.caseId }, { caseId: auto.caseId }]);

    const unknown = await runSuite({ db, probe: null }, a.qa, suite.id, { environmentId: 'nowhere' });
    expect(unknown).toMatchObject({ status: 'BLOCKED', reason: 'PREFLIGHT:UNKNOWN_ENVIRONMENT' });
    expect(unknown.items.map((i) => i.status)).toEqual(['BLOCKED', 'BLOCKED']);
    expect(unknown.items.every((i) => i.runId === null)).toBe(true);
    expect(unknown.totals.blocked).toBe(2);

    // No target registered: nothing can execute, so nothing is queued.
    const noTarget = await runSuite({ db, probe: null }, a.qa, suite.id, { environmentId: 'staging' });
    expect(noTarget.reason).toBe('PREFLIGHT:ENVIRONMENT_NOT_EXECUTABLE');

    await upsertEnvironment(db, S, {
      id: 'dead',
      kind: 'test',
      allowedActions: ['draft', 'execute'],
      baseUrl: 'http://127.0.0.1:9/',
      allowedHosts: ['127.0.0.1:9'],
    });
    const probed: string[] = [];
    const dead = await runSuite({ db, probe: async (url) => (probed.push(url), false) }, a.qa, suite.id, {
      environmentId: 'dead',
    });
    expect(probed).toEqual(['http://127.0.0.1:9/']);
    expect(dead.reason).toBe('PREFLIGHT:TARGET_UNREACHABLE');
    const runs = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM test_runs WHERE case_id = $1`,
      [auto.caseId],
    );
    expect(runs[0]!.n).toBe('0');

    // A reachable target queues the automated case and leaves the manual one to a tester.
    const alive = await runSuite({ db, probe: async () => true }, a.qa, suite.id, { environmentId: 'dead' });
    expect(alive.status).toBe('REQUESTED');
    expect(alive.items.map((i) => i.status).sort()).toEqual(['NOT_AUTOMATED', 'QUEUED']);

    // A suite of manual cases only needs an environment that exists, even without a target.
    const manualSuite = await createSuite(db, a.qa, { name: 'Preflight manual' });
    await addSuiteCases(db, a.qa, manualSuite.id, [{ caseId: manual.caseId }]);
    expect(
      (await runSuite({ db, probe: null }, a.qa, manualSuite.id, { environmentId: 'staging' })).status,
    ).toBe('REQUESTED');
    expect(
      await db.query(`SELECT 1 FROM audit_events WHERE action_kind = 'SUITE_RUN_BLOCKED' AND target = $1`, [
        dead.id,
      ]),
    ).toHaveLength(1);
  });
});

describe('exclusive runs', () => {
  it('keeps an exclusive run alone on its environment, in both directions', async () => {
    const c = await newCase('Exclusive', ['AC-LOGIN@v1'], { level: 'ui' });
    const exe = await proposeExecutable(db, a.qa, c.caseId, { ...loginValidSpec, exclusive: true });
    await reviewExecutable(db, a.lead, exe.id, { decision: 'APPROVE' });
    const base = {
      caseId: c.caseId,
      caseRevision: exe.caseRevision,
      executableId: exe.id,
      specHash: exe.specHash,
      requestedBy: a.qa.id,
      approvalId: null,
    };
    const mk = (key: string, environmentId: string, exclusive: boolean) =>
      createOrGetRun(db, S, { ...base, idempotencyKey: key, environmentId, exclusive }).then((r) => r.run);
    // Runs queued by earlier tests would be claimed first; take them out of the queue.
    await db.query(
      `UPDATE test_runs SET state = 'BLOCKED', reason = 'test', finished_at = now() WHERE state = 'QUEUED'`,
    );
    const plain = await mk('x-plain', 'ex-env', false);
    const excl = await mk('x-excl', 'ex-env', true);
    const later = await mk('x-later', 'ex-env', false);
    const elsewhere = await mk('x-elsewhere', 'other-env', false);

    // Plain runs share an environment; the exclusive one waits for both, and another environment proceeds.
    expect((await claimNextRun(db, 'w1', 60_000))?.id).toBe(plain.id);
    expect((await claimNextRun(db, 'w2', 60_000))?.id).toBe(later.id);
    expect((await claimNextRun(db, 'w3', 60_000))?.id).toBe(elsewhere.id);
    expect(await claimNextRun(db, 'w3', 60_000)).toBeNull();

    const finish = (id: string) =>
      updateRunState(db, S, id, 'POLICY_CHECK', { state: 'BLOCKED', reason: 'test', finished: true });
    await finish(plain.id);
    expect(await claimNextRun(db, 'w1', 60_000)).toBeNull(); // `later` is still active
    await finish(later.id);
    const second = await claimNextRun(db, 'w1', 60_000);
    expect(second?.id).toBe(excl.id);
    expect(second?.exclusive).toBe(true);

    // Nothing of that environment runs beside the exclusive run, in either order of arrival.
    const after = await mk('x-after', 'ex-env', false);
    expect(await claimNextRun(db, 'w2', 60_000)).toBeNull();
    await finish(excl.id);
    expect((await claimNextRun(db, 'w2', 60_000))?.id).toBe(after.id);
    expect((await getRun(db, S, after.id))?.state).toBe('POLICY_CHECK');
  });
});

describe('test-design document', () => {
  it('assembles the eight sections from the records', async () => {
    const md = await testDesignMarkdown(db, S, new Date('2026-10-27T00:00:00Z'));
    for (const h of [
      '## 1. Requirement analysis',
      '### Ambiguities and open questions',
      '## 2. Techniques selected, and why',
      '## 3. Test conditions and coverage model',
      '## 4. Test cases',
      '## 5. Traceability',
      '## 6. Coverage gaps and assumptions',
      '## 7. Risk-based execution order',
      '## 8. Suggested regression scope',
    ])
      expect(md).toContain(h);
    expect(md).toContain('Generated 2026-10-27');
    expect(md).toMatch(/\*\*P0\*\* \(\d+\): MONEY-/);
    expect(md).toContain('**Stale cases (');
    expect(md).toContain('BR-404@v1 | SUPERSEDED');
    expect(md).toMatch(/Cases guarding a defect \(\d+\):.*BUG-007/);
  });
});

describe('retest reviews, code backfill and manual effort (ADR-0022)', () => {
  it('opens one retest review when a known-bug case passes, and closes it when the mark is cleared', async () => {
    const c = await newCase('Retest me', ['BR-404@v2']);
    await setKnownBug(db, a.qa, c.caseId, 'BUG-090');
    const run = (startedAt: Date, finishedAt: Date) =>
      recordManualRun(db, a.qa, {
        caseId: c.caseId,
        environmentId: 'staging',
        build: 'b7',
        steps: pass(1),
        startedAt,
        finishedAt,
      });
    await run(new Date('2026-10-27T09:00:00Z'), new Date('2026-10-27T09:04:00Z'));
    await run(new Date('2026-10-27T10:00:00Z'), new Date('2026-10-27T10:02:00Z'));
    const open = await db.query<{ id: string; status: string; question: string; assigned_role: string }>(
      `SELECT id, status, question, assigned_role FROM review_tasks WHERE kind = 'KNOWN_BUG_RETEST' AND subject_id = $1`,
      [c.caseId],
    );
    expect(open).toHaveLength(1); // one per case, however many passes
    expect(open[0]).toMatchObject({ status: 'OPEN', assigned_role: 'QA_ENGINEER' });
    expect(open[0]!.question).toContain(`${c.code} passed on staging build b7`);
    expect(open[0]!.question).toContain('BUG-090');

    await setKnownBug(db, a.qa, c.caseId, null);
    const closed = await db.query<{ status: string }>(`SELECT status FROM review_tasks WHERE id = $1`, [
      open[0]!.id,
    ]);
    expect(closed[0]!.status).toBe('APPROVED');

    // No mark, no review.
    await run(new Date('2026-10-27T11:00:00Z'), new Date('2026-10-27T11:01:00Z'));
    expect(
      await db.query(
        `SELECT 1 FROM review_tasks WHERE kind = 'KNOWN_BUG_RETEST' AND status = 'OPEN' AND subject_id = $1`,
        [c.caseId],
      ),
    ).toHaveLength(0);

    const m = (await projectMetrics(db, S, 3650)).manual;
    expect(m.runs).toBeGreaterThanOrEqual(3);
    expect(m.byTester.find((t) => t.testerId === a.qa.id)!.minutes).toBeGreaterThanOrEqual(7);
    expect(m.medianMinutesPerRun).not.toBeNull();
  });

  it('gives a code to cases created without one, once', async () => {
    const c = await newCase('Created before codes', ['BR-404@v2'], { module: 'Legacy area' }, false);
    await db.query('UPDATE test_cases SET code = NULL WHERE id = $1', [c.caseId]);
    const done = await assignMissingCaseCodes(db, S);
    expect(done).toEqual([{ caseId: c.caseId, code: 'LEGACY-001' }]);
    expect(await assignMissingCaseCodes(db, S)).toEqual([]);
  });
});
