import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCase, createTestDb, seedProject, type Db, type SeededActors } from '@qa/db';
import { DomainError } from '@qa/domain';
import {
  ClaudeProvider,
  createAnthropicClient,
  createFakeAnthropicFetch,
  heuristicResponder,
} from '@qa/llm-adapter';
import { ingestSource } from '@qa/retrieval';
import { reviewTestCase } from '@qa/review';
import {
  getCoverage,
  listQuestions,
  recordManualRun,
  recordObservation,
  submitStory,
  testCasesCsv,
  traceabilityCsv,
  type OrchestratorDeps,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;
let deps: OrchestratorDeps;

const src = (sourceId: string, body: string) => ({
  meta: {
    sourceId,
    version: 'v1',
    sourceType: 'ACCEPTANCE_CRITERIA' as const,
    trustTier: 'T1' as const,
    approvalStatus: 'APPROVED' as const,
    approvedBy: 'po',
    owner: 'po',
    ruleKeys: [],
    effectiveFrom: new Date('2026-01-01'),
  },
  body,
});

const caseContent = (title: string, refs: string[], extra: Record<string, unknown> = {}) => ({
  title,
  priority: 'P1',
  preconditions: ['Signed in as receptionist'],
  testData: ['Customer "Ngân"'],
  steps: [
    {
      action: 'Open the contract form',
      expected: 'Heading "Thêm hợp đồng" is shown',
      sourceRefs: refs,
      testData: '',
    },
    {
      action: 'Type 1001 sessions',
      expected: 'Message "Tối đa 1000 buổi"',
      sourceRefs: refs,
      testData: 'sessions = 1001',
    },
  ],
  assumptions: [],
  missingRequirements: [],
  requirementRefs: refs,
  techniques: ['boundary_value_analysis'],
  testTypes: ['negative', 'boundary'],
  testConditions: ['sessions: 1001 above the top tier'],
  module: 'Contracts',
  level: 'ui',
  manualReason: '',
  ...extra,
});

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const p = new ClaudeProvider({
    client: createAnthropicClient({ apiKey: 'test', fetch: createFakeAnthropicFetch(heuristicResponder) }),
  });
  deps = { db, classifier: p, generator: p };
  await ingestSource(
    db,
    a.po,
    src('BR-301', '# BR-301\nA contract has 1 to 1000 sessions; 1001 is refused with "Tối đa 1000 buổi".'),
  );
  await ingestSource(
    db,
    a.po,
    src('BR-404', '# BR-404\nA booking needs a session left; otherwise "Hết buổi".'),
  );
  await db.query(
    `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
     VALUES ('story_cov','t','p','COV-1',1,'Contracts','d','[{"id":"AC-COV-1","text":"x"},{"id":"AC-COV-2","text":"y"}]','x')`,
  );
});
afterAll(() => db.close());

describe('coverage, exports and the question register (ADR-0018)', () => {
  it('reports coverage per source, criterion and identifier from what cases cite, and lists the gaps', async () => {
    const c = await createTestCase(db, S, {
      storyId: 'story_cov',
      workflowId: null,
      content: caseContent('1001 sessions are refused', ['BR-301@v1', 'story:AC-COV-1']),
      sourceRefs: ['BR-301@v1'],
      authorId: a.agent.id,
    });
    await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
    const cov = await getCoverage(db, S);
    expect(cov.totals).toMatchObject({
      sources: 2,
      sourcesCovered: 1,
      criteria: 2,
      criteriaCovered: 1,
      approvedCases: 1,
    });
    expect(cov.gaps.sources).toEqual(['BR-404@v1']);
    expect(cov.gaps.criteria).toEqual(['COV-1:AC-COV-2']);
    expect(cov.gaps.identifiers).toContain('BR-404');
    expect(cov.bySource.find((s) => s.sourceId === 'BR-301')).toMatchObject({
      approvedCases: 1,
      cases: [{ caseId: c.caseId, status: 'APPROVED' }],
    });
    expect(cov.byIdentifier.find((i) => i.identifier === 'BR-301')?.caseIds).toEqual([c.caseId]);
  });

  it('exports the tester workbook with the schema columns, execution from recorded runs only, and traceability', async () => {
    const cases = await db.query<{ id: string; code: string }>(
      `SELECT id, code FROM test_cases WHERE story_id = 'story_cov' ORDER BY created_at`,
    );
    const { id: caseId, code } = cases[0]!; // the CSV's Test Case ID is the case code (ADR-0021)
    await recordManualRun(db, a.qa, {
      caseId,
      environmentId: 'staging',
      build: 'c65902a',
      steps: [
        { status: 'PASSED', actual: '' },
        { status: 'FAILED', actual: 'Raw "Too big: expected number to be <=1000"' },
      ],
      defectRef: 'BUG-025',
    });
    const manualOnly = await createTestCase(db, S, {
      storyId: 'story_cov',
      workflowId: null,
      content: caseContent('Renewal reminder after 30 days', ['BR-404@v1'], {
        level: 'manual',
        manualReason: 'Depends on time passing',
        assumptions: ['The reminder delay is not documented; 30 days is assumed'],
        basis: 'assumption',
        openQuestions: ['rev_q1'],
      }),
      sourceRefs: ['BR-404@v1'],
      authorId: a.agent.id,
    });

    const csv = await testCasesCsv(db, S);
    expect(csv.startsWith('﻿Test Case ID,Requirement ID(s),Title,Feature/Module')).toBe(true);
    const lines = csv.split('\r\n');
    expect(lines[0]!.split(',')).toHaveLength(20);
    const executed = lines.find((l) => l.startsWith(`${code},`))!;
    expect(executed).toContain('"BR-301@v1, story:AC-COV-1"');
    expect(executed).toContain('Fail');
    expect(executed).toContain('BUG-025');
    expect(executed).toContain('Raw ""Too big: expected number to be <=1000""');
    expect(executed).toContain('Yes (ui)');
    const notRun = lines.find((l) => l.startsWith(`${manualOnly.code},`))!;
    expect(notRun).toContain('Not Run');
    expect(notRun).toContain('No: Depends on time passing');
    expect(notRun).toContain('assumption');
    expect(notRun).toContain('rev_q1');
    expect(notRun).toContain('Revision 1 is DRAFT');

    const trace = await traceabilityCsv(db, S);
    expect(trace).toContain('﻿Requirement,Cases,Approved cases,Case list');
    expect(trace).toContain('BR-301@v1,1,1,');
    expect(trace).toContain('BR-404@v1,1,0,');
  });

  it('keeps clarification reviews as the question register, with observed behaviour recorded by a person', async () => {
    const vague = {
      externalId: 'Q-STORY',
      title: 'Lockout',
      description: 'd',
      acceptanceCriteria: [{ id: 'AC-Q-1', text: 'After multiple failed logins the user is locked out.' }],
    };
    await ingestSource(db, a.po, src('SRC-AC-Q-1', '# AC-Q-1\nThe account locks after failed logins.'));
    const r = await submitStory(deps, a.qa, vague);
    expect(r.outcome.route).toBe('REVIEW_REQUESTED');
    if (r.outcome.route !== 'REVIEW_REQUESTED') return;
    const reviewId = r.outcome.reviewId;

    const before = (await listQuestions(db, S)).find((q) => q.id === reviewId);
    expect(before).toMatchObject({
      kind: 'REQUIREMENT_CLARIFICATION',
      status: 'OPEN',
      currentBehaviour: null,
      cases: [],
    });
    expect(before?.question).toContain('AC-Q-1');

    const forbidden = async (actor: typeof a.agent) => {
      try {
        await recordObservation(db, actor, reviewId, 'locks after 5');
        return 'OK';
      } catch (e) {
        return e instanceof DomainError ? e.code : String(e);
      }
    };
    expect(await forbidden(a.agent)).toBe('FORBIDDEN');
    expect(await forbidden(a.po)).toBe('FORBIDDEN');

    const updated = await recordObservation(
      db,
      a.qa,
      reviewId,
      'Today: 10 wrong passwords, then 423 ACCOUNT_LOCKED',
    );
    expect(updated.observedBehaviour).toBe('Today: 10 wrong passwords, then 423 ACCOUNT_LOCKED');
    const linked = await createTestCase(db, S, {
      storyId: 'story_cov',
      workflowId: null,
      content: caseContent('Lockout at the observed count', ['BR-301@v1'], { openQuestions: [reviewId] }),
      sourceRefs: ['BR-301@v1'],
      authorId: a.agent.id,
    });
    const after = (await listQuestions(db, S)).find((q) => q.id === reviewId);
    expect(after).toMatchObject({
      currentBehaviour: 'Today: 10 wrong passwords, then 423 ACCOUNT_LOCKED',
      cases: [{ caseId: linked.caseId }],
    });
  });
});
