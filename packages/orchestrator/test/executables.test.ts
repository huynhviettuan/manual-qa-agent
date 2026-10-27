import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCase, createTestDb, getExecutable, seedProject, type Db, type SeededActors } from '@qa/db';
import { FakeExecutableGenerator, SessionExchangeProvider } from '@qa/llm-adapter';
import { ingestSource } from '@qa/retrieval';
import { reviewTestCase } from '@qa/review';
import { proposeExecutableFromCase } from '../src/index.ts';

// ADR-0024: the agent proposes executable steps; the same checks and a different approver apply.

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
let n = 0;

const content = (overrides: Record<string, unknown> = {}) => ({
  title: 'A booking with no session left is refused',
  priority: 'P0',
  preconditions: [],
  testData: [],
  steps: [
    {
      action: 'Book the last session',
      expected: 'The booking is saved',
      sourceRefs: ['BR-404@v1'],
      testData: '',
    },
    {
      action: 'Book one more',
      expected: 'Message "Hết buổi" is shown',
      sourceRefs: ['BR-404@v1'],
      testData: '',
    },
  ],
  assumptions: [],
  missingRequirements: [],
  requirementRefs: ['BR-404@v1'],
  module: 'Bookings',
  level: 'ui',
  ...overrides,
});

async function approvedCase(overrides: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ($1,'t','p',$2,1,'t','d','[]','x')`,
    [`story_x${++n}`, `EXE-${n}`],
  );
  const c = await createTestCase(db, S, {
    storyId: `story_x${n}`,
    workflowId: null,
    content: content(overrides),
    sourceRefs: ['BR-404@v1'],
    authorId: a.qa.id,
  });
  await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
  return c;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await ingestSource(db, a.po, {
    meta: {
      sourceId: 'BR-404',
      version: 'v1',
      sourceType: 'SPECIFICATION',
      trustTier: 'T1',
      approvalStatus: 'APPROVED',
      approvedBy: 'po',
      owner: 'po',
      ruleKeys: [],
      effectiveFrom: new Date('2026-01-01'),
    },
    body: '## BR-404\nA booking needs a session left; otherwise "Hết buổi".',
  });
});
afterAll(() => db.close());

describe('proposeExecutableFromCase', () => {
  it('proposes through the same checks as a hand-written spec, records the call, and leaves approval to a person', async () => {
    const c = await approvedCase();
    const deps = { db, executables: new FakeExecutableGenerator() };
    const r = await proposeExecutableFromCase(deps, a.agent, c.caseId, ['Sign in at POST /api/login']);
    expect(r.proposed).toBe(true);
    if (!r.proposed) return;
    const exe = (await getExecutable(db, S, r.executableId))!;
    expect(exe).toMatchObject({ caseId: c.caseId, status: 'PROPOSED', proposedBy: a.agent.id });
    expect((exe.spec as { steps: unknown[] }).steps).toHaveLength(2); // navigate + the one quoted message
    expect(r.reviewFlags).toEqual([]);
    const record = await db.query<{
      kind: string;
      provider: string;
      outcome: string;
      prompt_version: string;
    }>(`SELECT kind, provider, outcome, prompt_version FROM decision_records WHERE id = $1`, [
      r.decisionRecordId,
    ]);
    expect(record[0]).toEqual({
      kind: 'executable',
      provider: 'fake',
      outcome: 'OK',
      prompt_version: 'exec-v1',
    });

    // The stand-in cannot assert on a case that quotes no message: a REFUSED outcome, recorded, no executable.
    const vague = await approvedCase({
      steps: [{ action: 'Open', expected: 'The page is shown', sourceRefs: ['BR-404@v1'], testData: '' }],
    });
    const refused = await proposeExecutableFromCase(deps, a.qa, vague.caseId);
    expect(refused).toMatchObject({ proposed: false, failure: 'REFUSED' });

    const manual = await approvedCase({ level: 'manual', manualReason: 'needs the printed copy' });
    await expect(proposeExecutableFromCase(deps, a.qa, manual.caseId)).rejects.toThrow(/is manual/);
    await expect(proposeExecutableFromCase(deps, a.po, c.caseId)).rejects.toThrow(/cannot propose/);
    await expect(proposeExecutableFromCase({ db, executables: null }, a.qa, c.caseId)).rejects.toThrow(
      /no executable generator/,
    );
  });

  it('the session provider writes the request and answers UNAVAILABLE until a person answers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-exe-exchange-'));
    try {
      const c = await approvedCase();
      const session = new SessionExchangeProvider({ dir, modelLabel: 'test session' });
      const r = await proposeExecutableFromCase({ db, executables: session }, a.qa, c.caseId);
      expect(r).toMatchObject({ proposed: false, failure: 'UNAVAILABLE' });
      const files = await readdir(dir);
      expect(files.some((f) => f.startsWith('executable-') && f.endsWith('.request.json'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
