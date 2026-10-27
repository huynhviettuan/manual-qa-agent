import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, latestRevision, seedProject, type Db, type SeededActors } from '@qa/db';
import { DraftContent } from '@qa/domain';
import { ingestSource } from '@qa/retrieval';
import { CASE_COLUMNS, importCases, parseCsv, staleCases, testCasesCsv, toCsv } from '../src/index.ts';

// ADR-0022: importing an existing catalogue in the workbook's columns.

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let a: SeededActors;

const row = (v: Partial<Record<(typeof CASE_COLUMNS)[number], string>>) =>
  CASE_COLUMNS.map((c) => v[c] ?? '');
const workbook = (...rows: Array<Partial<Record<(typeof CASE_COLUMNS)[number], string>>>) =>
  toCsv([[...CASE_COLUMNS], ...rows.map(row)]);

const booking = {
  'Test Case ID': 'BKG-010',
  'Requirement ID(s)': 'BR-404, NFR-SEC',
  Title: 'A booking with no session left is refused',
  'Feature/Module': 'Bookings',
  'Technique(s)': 'Boundary value analysis, Scenario-based, CRUD',
  'Test Type': 'Negative, End-to-end, Smoke-ish',
  Priority: 'P0',
  Preconditions: 'A contract with 1 session left',
  'Test Data': 'Contract "QA-1", 1 session',
  Steps: '1. Book the last session\n2. Book one more',
  'Expected Results': '1. The first booking answers 201\n2. The second answers 409 "Hết buổi"',
  Basis: 'specified',
  'Open Questions': 'Q-15',
  Status: 'Pass',
  Notes: 'Refs: PLT-13, T-046',
  'Automation Candidate': 'Yes, automated (api: tests/api/bookings.spec.ts)',
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  await ingestSource(db, a.po, {
    meta: {
      sourceId: 'FF-BR',
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

describe('parseCsv', () => {
  it('reads quoted commas, quotes, line breaks, CRLF and a BOM, and round-trips toCsv', () => {
    const rows = [
      ['a', 'b, c', 'say "hi"'],
      ['multi\nline', '', 'x'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('x,y\ny,z\n\n')).toEqual([
      ['x', 'y'],
      ['y', 'z'],
    ]);
    expect(() => parseCsv('"open')).toThrow(/quoted/);
  });
});

describe('importCases', () => {
  it('maps a workbook row onto a case, resolving requirement ids and reporting what it could not map', async () => {
    await expect(importCases(db, a.agent, { csv: workbook(booking), label: 'x' })).rejects.toThrow(
      /AI agent/,
    );
    await expect(importCases(db, a.po, { csv: workbook(booking), label: 'x' })).rejects.toThrow(
      /cannot import/,
    );
    await expect(importCases(db, a.qa, { csv: 'Title,Steps\nx,1. y', label: 'x' })).rejects.toThrow(
      /Expected Results/,
    );
    await expect(importCases(db, a.qa, { csv: workbook(booking), label: 'bad label!' })).rejects.toThrow(
      /label/,
    );

    await expect(
      importCases(db, a.qa, { csv: workbook(booking), label: 'x', approve: true }),
    ).rejects.toThrow(/QA lead or admin/);
    const r = await importCases(db, a.lead, {
      csv: workbook(
        booking,
        { Title: '', Steps: '1. x', 'Expected Results': '1. y' },
        { Title: 'No steps', 'Expected Results': '1. y' },
        { Title: 'Bad priority', Steps: '1. x', 'Expected Results': '1. y', Priority: 'High' },
        {
          'Test Case ID': 'legacy 7',
          Title: 'A manual case without an id format',
          'Feature/Module': 'Reports',
          Steps: '1. Open the report\n2. Export it\n3. Compare totals',
          'Expected Results': '1. The totals match the screen to the đồng',
          Basis: 'assumption',
          Assumptions: 'Rounding is not documented',
          'Automation Candidate': 'No: needs the printed copy',
        },
      ),
      label: 'pilot-1',
      approve: true,
    });
    expect(r).toMatchObject({ rows: 5, status: 'APPROVED', expectedOnLastStep: 1, executionsIgnored: 1 });
    expect(r.rejected).toEqual([
      { row: 3, reason: 'no title' },
      { row: 4, reason: 'no steps' },
      { row: 5, reason: 'priority "High" is not P0–P3' },
    ]);
    expect(r.unresolvedRefs).toEqual({ 'NFR-SEC': 1 });
    expect(r.unmappedTechniques).toEqual({ CRUD: 1 });
    expect(r.unmappedTestTypes).toEqual({ 'Smoke-ish': 1 });
    expect(r.imported.map((i) => i.code)).toEqual(['BKG-010', 'REPORT-001']);

    const bkg = (await latestRevision(db, S, r.imported[0]!.caseId))!;
    expect(bkg).toMatchObject({ code: 'BKG-010', status: 'APPROVED', sourceRefs: ['FF-BR@v1'] });
    const d = DraftContent.parse(bkg.content);
    expect(d).toMatchObject({
      priority: 'P0',
      module: 'Bookings',
      level: 'api',
      requirementRefs: ['BR-404', 'NFR-SEC'],
      techniques: ['boundary_value_analysis', 'scenario'],
      testTypes: ['negative', 'end_to_end'],
      openQuestions: ['Q-15'],
      refs: ['PLT-13', 'T-046'],
      testData: ['Contract "QA-1", 1 session'],
    });
    expect(d.steps.map((s) => [s.action, s.expected])).toEqual([
      ['Book the last session', 'The first booking answers 201'],
      ['Book one more', 'The second answers 409 "Hết buổi"'],
    ]);
    expect(d.reviewFlags).toEqual([
      'Imported requirement "NFR-SEC" is not in the source registry',
      'Imported technique "CRUD" has no equivalent in the agent\'s list',
      'Imported test type "Smoke-ish" has no equivalent in the agent\'s list',
    ]);

    const legacy = DraftContent.parse((await latestRevision(db, S, r.imported[1]!.caseId))!.content);
    expect(legacy).toMatchObject({
      level: 'manual',
      manualReason: 'needs the printed copy',
      basis: 'assumption',
      refs: ['imported as legacy 7'],
    });
    // Unpaired expected results sit on the last step, never invented for the others.
    expect(legacy.steps.map((s) => s.expected)).toEqual(['', '', 'The totals match the screen to the đồng']);

    // Re-importing is a no-op for kept codes; a case without a kept code is a new case.
    const again = await importCases(db, a.qa, { csv: workbook(booking), label: 'pilot-1' });
    expect(again).toMatchObject({ status: 'DRAFT', imported: [] });
    expect(again.skipped).toEqual([
      { row: 2, code: 'BKG-010', reason: 'a case with this code already exists' },
    ]);

    const audit = await db.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events WHERE action_kind = 'CASES_IMPORTED' ORDER BY created_at`,
    );
    expect(audit.map((x) => x.outcome)).toEqual([
      'APPROVED by p-lead:2 imported, 0 skipped, 3 rejected',
      'DRAFT:0 imported, 1 skipped, 0 rejected',
    ]);

    // Bare identifiers follow the active version, so an imported catalogue is never stale.
    expect((await staleCases(db, S)).map((s) => s.code)).not.toContain('BKG-010');
  });

  it("round-trips the agent's own export into another project", async () => {
    const other = { tenantId: 't', projectId: 'p-copy' };
    const b = await seedProject(db, other);
    const exported = await testCasesCsv(db, S);
    const r = await importCases(db, b.lead, { csv: exported, label: 'copy', approve: true });
    expect(r.rejected).toEqual([]);
    expect(r.imported.map((i) => i.code).sort()).toEqual(['BKG-010', 'REPORT-001']);
    const copy = DraftContent.parse(
      (await latestRevision(db, other, r.imported.find((i) => i.code === 'BKG-010')!.caseId))!.content,
    );
    expect(copy.steps.map((s) => s.expected)).toEqual([
      'The first booking answers 201',
      'The second answers 409 "Hết buổi"',
    ]);
    expect(copy.techniques).toEqual(['boundary_value_analysis', 'scenario']);
  });
});
