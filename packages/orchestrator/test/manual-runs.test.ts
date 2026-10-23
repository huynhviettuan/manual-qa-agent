import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCase, createTestDb, getEvidence, seedProject, type Db, type SeededActors } from '@qa/db';
import { DomainError } from '@qa/domain';
import { LocalEvidenceStore } from '@qa/evidence';
import { reviewTestCase } from '@qa/review';
import {
  addSuiteCases,
  attachManualEvidence,
  createSuite,
  deriveManualStatus,
  getManualRunDetail,
  getSuiteRunReport,
  listManualRuns,
  recordManualRun,
  runSuite,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
let dir: string;
let store: LocalEvidenceStore;

const content = (title: string, steps: number) => ({
  title,
  priority: 'P1',
  preconditions: ['A signed-in receptionist'],
  testData: ['Customer "Ngân"'],
  steps: Array.from({ length: steps }, (_, i) => ({
    action: `Step ${i + 1}`,
    expected: `Result ${i + 1} is shown`,
    sourceRefs: ['AC-1@v1'],
  })),
  assumptions: [],
  missingRequirements: [],
});

async function approvedCase(title: string, steps = 3) {
  const c = await createTestCase(db, S, {
    storyId: 'story_m',
    workflowId: null,
    content: content(title, steps),
    sourceRefs: ['AC-1@v1'],
    authorId: a.agent.id,
  });
  await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
  return c.caseId;
}

const pass = (n: number) =>
  Array.from({ length: n }, () => ({ status: 'PASSED' as const, actual: 'as expected' }));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? `${e.code}: ${e.message}` : String(e);
  }
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ('story_m','t','p','M-1',1,'t','d','[]','x')`,
  );
  dir = await mkdtemp(join(tmpdir(), 'qa-manual-'));
  store = new LocalEvidenceStore(dir);
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('deriveManualStatus', () => {
  const s = (statuses: string[], actual = 'x') =>
    statuses.map((status, i) => ({ index: i + 1, status: status as never, actual }));
  it('derives the status from the steps and never trusts a claimed one', () => {
    expect(deriveManualStatus(s(['PASSED', 'PASSED']), '')).toEqual({ status: 'PASSED', failedStep: null });
    expect(deriveManualStatus(s(['PASSED', 'FAILED', 'SKIPPED']), '')).toEqual({
      status: 'FAILED',
      failedStep: 2,
    });
    expect(deriveManualStatus(s(['BLOCKED', 'SKIPPED']), 'environment down')).toEqual({
      status: 'BLOCKED',
      failedStep: null,
    });
  });
  it('requires the actual result at a failed step, a reason when blocked, and no skip before a problem', () => {
    expect(() => deriveManualStatus(s(['FAILED'], ''), '')).toThrow('record the actual result');
    expect(() => deriveManualStatus(s(['BLOCKED'], ''), '')).toThrow('say what blocked it');
    expect(() => deriveManualStatus(s(['SKIPPED', 'PASSED']), '')).toThrow('step 1 is skipped although');
  });
});

describe('recordManualRun', () => {
  it('records a passed run for an approved case, immutably, with an audit trail and history', async () => {
    const caseId = await approvedCase('Receptionist adds a lead');
    const run = await recordManualRun(db, a.qa, {
      caseId,
      environmentId: 'staging',
      build: 'a981386',
      steps: pass(3),
    });
    expect(run).toMatchObject({ status: 'PASSED', caseRevision: 1, testerId: a.qa.id, failedStep: null });
    const again = await recordManualRun(db, a.lead, {
      caseId,
      environmentId: 'staging',
      build: 'b000001',
      steps: [
        { status: 'PASSED', actual: '' },
        { status: 'FAILED', actual: 'Shows "Too big: expected number to be <=1000"' },
        { status: 'SKIPPED', actual: '' },
      ],
      defectRef: 'BUG-025',
    });
    expect(again).toMatchObject({ status: 'FAILED', failedStep: 2, defectRef: 'BUG-025' });
    const history = await listManualRuns(db, S, caseId);
    expect(history.map((r) => [r.status, r.build])).toEqual([
      ['FAILED', 'b000001'],
      ['PASSED', 'a981386'],
    ]);
    const audits = await db.query<{ action_kind: string; outcome: string }>(
      `SELECT action_kind, outcome FROM audit_events WHERE action_kind = 'MANUAL_RUN_RECORDED' AND target = $1 ORDER BY created_at`,
      [`${caseId}:r1`],
    );
    expect(audits.map((x) => x.outcome)).toEqual(['PASSED', 'FAILED']);
  });

  it('refuses the AI agent, non-QA roles, unapproved revisions, wrong step counts and unknown environments', async () => {
    const caseId = await approvedCase('Guarded case', 2);
    const base = { caseId, environmentId: 'staging', steps: pass(2) };
    expect(await code(recordManualRun(db, a.agent, base))).toContain('FORBIDDEN: the AI agent cannot');
    expect(await code(recordManualRun(db, a.po, base))).toContain('FORBIDDEN');
    expect(await code(recordManualRun(db, a.qa, { ...base, steps: pass(3) }))).toContain(
      'has 2 steps; 3 results',
    );
    expect(await code(recordManualRun(db, a.qa, { ...base, environmentId: 'nowhere' }))).toContain(
      'NOT_FOUND: environment',
    );
    const draft = await createTestCase(db, S, {
      storyId: 'story_m',
      workflowId: null,
      content: content('Still a draft', 1),
      sourceRefs: [],
      authorId: a.agent.id,
    });
    expect(
      await code(
        recordManualRun(db, a.qa, { caseId: draft.caseId, environmentId: 'staging', steps: pass(1) }),
      ),
    ).toContain('ILLEGAL_TRANSITION: only an APPROVED revision');
  });

  it('fills a suite run: the manual result appears beside automated ones, and only for cases in that run', async () => {
    const inRun = await approvedCase('Manual case in the suite', 1);
    const outside = await approvedCase('Manual case outside', 1);
    const suite = await createSuite(db, a.qa, { name: `Manual ${Date.now()}` });
    await addSuiteCases(db, a.qa, suite.id, [{ caseId: inRun, section: 'Leads' }]);
    const started = await runSuite({ db } as never, a.qa, suite.id, { environmentId: 'staging' });
    expect(started.items[0]).toMatchObject({ status: 'NOT_AUTOMATED', manualRunId: null });
    expect(started.totals).toMatchObject({ notAutomated: 1, manualRecorded: 0 });

    expect(
      await code(
        recordManualRun(db, a.qa, {
          caseId: outside,
          environmentId: 'staging',
          suiteRunId: started.id,
          steps: pass(1),
        }),
      ),
    ).toContain('is not part of suite run');

    const blocked = await recordManualRun(db, a.qa, {
      caseId: inRun,
      environmentId: 'staging',
      suiteRunId: started.id,
      steps: [{ status: 'BLOCKED', actual: '' }],
      reason: 'The lead form is behind BUG-020',
    });
    const report = await getSuiteRunReport(db, S, started.id);
    expect(report.items[0]).toMatchObject({
      status: 'BLOCKED',
      manualRunId: blocked.id,
      testerId: a.qa.id,
      reason: 'The lead form is behind BUG-020',
    });
    expect(report.totals).toMatchObject({ blocked: 1, notAutomated: 0, manualRecorded: 1 });
  });

  it('attaches evidence for the tester or a lead, stored and listed like automated evidence', async () => {
    const caseId = await approvedCase('Evidence case', 1);
    const run = await recordManualRun(db, a.qa, { caseId, environmentId: 'staging', steps: pass(1) });
    const deps = { db, store, evidenceRetentionDays: 7 };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const shot = await attachManualEvidence(deps, a.qa, run.id, {
      name: 'step-1.png',
      contentType: 'image/png',
      data: png,
    });
    expect(shot).toMatchObject({ name: 'step-1.png', contentType: 'image/png', sizeBytes: 7 });
    const stored = await getEvidence(db, S, shot.id);
    expect(stored).toMatchObject({ manualRunId: run.id, runId: null, kind: 'screenshot' });
    expect(await store.get(stored!.objectKey)).toEqual(Buffer.from(png));

    expect(
      await code(
        attachManualEvidence(deps, a.po, run.id, { name: 'x.png', contentType: 'image/png', data: png }),
      ),
    ).toContain('FORBIDDEN');
    expect(
      await code(
        attachManualEvidence(deps, a.qa, run.id, {
          name: 'x.exe',
          contentType: 'application/octet-stream',
          data: png,
        }),
      ),
    ).toContain('unsupported content type');
    expect(
      await code(
        attachManualEvidence(deps, a.qa, run.id, { name: '../x.png', contentType: 'image/png', data: png }),
      ),
    ).not.toBe('OK');
    await attachManualEvidence(deps, a.lead, run.id, {
      name: 'notes.txt',
      contentType: 'text/plain',
      data: new TextEncoder().encode('seen'),
    });
    const detail = await getManualRunDetail(db, S, run.id);
    expect(detail.evidence.map((e) => e.name)).toEqual(['step-1.png', 'notes.txt']);
  });
});
