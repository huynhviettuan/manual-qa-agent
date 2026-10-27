import {
  createTestCase,
  insertAuditEvent,
  insertStoryVersion,
  listActiveSources,
  listCaseCodes,
  type Db,
} from '@qa/db';
import {
  DomainError,
  DraftContent,
  hasRole,
  sourceRef,
  TestTechnique,
  TestType,
  type Actor,
  type TenantScope,
} from '@qa/domain';
import { parseCsv } from './exports.ts';

// ADR-0022: brings a team's existing catalogue in, in the 20-column workbook this agent exports
// (CASE_COLUMNS), so a project does not start from zero. Nothing is guessed: requirement ids are
// resolved against the source registry and unresolved ones are reported and flagged on the case;
// values outside the agent's vocabularies are reported, never coerced; execution columns are not
// imported, because a run record needs a run (ADR-0017).

const IMPORTER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const REQUIRED = ['Title', 'Steps', 'Expected Results'] as const;
const CODE = /^[A-Z][A-Z0-9]{0,9}-\d{1,6}$/;
export const MAX_IMPORT_ROWS = 2000;

export type ImportInput = {
  csv: string;
  /** Names the import; the cases hang off one story `import:<label>`. */
  label: string;
  /** Land as APPROVED (the team approved them already; QA lead or admin only); otherwise DRAFT, for review here. */
  approve?: boolean;
};

export type ImportReport = {
  label: string;
  storyId: string;
  status: 'APPROVED' | 'DRAFT';
  rows: number;
  imported: Array<{ row: number; code: string; caseId: string }>;
  /** Already in the project under the same code: re-importing is a no-op. */
  skipped: Array<{ row: number; code: string; reason: string }>;
  rejected: Array<{ row: number; reason: string }>;
  /** Requirement ids no approved active source carries, with the number of cases citing each. */
  unresolvedRefs: Record<string, number>;
  unmappedTechniques: Record<string, number>;
  unmappedTestTypes: Record<string, number>;
  /** Cases whose expected results did not pair one per step, so they all sit on the last step. */
  expectedOnLastStep: number;
  /** Rows that carried an execution result; results are not imported (no run record exists). */
  executionsIgnored: number;
};

const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// Spellings a catalogue uses for the agent's techniques ("Scenario-based", "Cause–effect graphing").
const TECHNIQUE_ALIASES: Record<string, string> = {
  scenario_based: 'scenario',
  checklist_based: 'checklist',
  cause_effect_graphing: 'cause_effect',
  domain_testing: 'domain',
  defect_based_testing: 'defect_based',
};

const list = (v: string | undefined) =>
  (v ?? '')
    .split(/,|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
const lines = (v: string | undefined) =>
  (v ?? '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
/** Numbered lines ("1. …"); an unnumbered line continues the previous one. */
function numbered(v: string | undefined): string[] {
  const out: string[] = [];
  for (const l of lines(v)) {
    const m = /^\d+[.)]\s*(.*)$/.exec(l);
    if (m) out.push(m[1]!);
    else if (out.length) out[out.length - 1] += `\n${l}`;
    else out.push(l);
  }
  return out;
}
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export async function importCases(db: Db, actor: Actor, input: ImportInput): Promise<ImportReport> {
  if (hasRole(actor, 'AI_AGENT')) throw new DomainError('FORBIDDEN', 'the AI agent cannot import cases');
  if (!hasRole(actor, ...IMPORTER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot import cases`);
  if (input.approve && !hasRole(actor, 'QA_LEAD', 'ADMIN'))
    throw new DomainError('FORBIDDEN', 'importing cases as APPROVED needs a QA lead or admin');
  const label = input.label.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label))
    throw new DomainError('VALIDATION', 'label: 1–64 letters, digits, dot, dash or underscore');
  const scope: TenantScope = { tenantId: actor.tenantId, projectId: actor.projectId };

  const table = parseCsv(input.csv);
  const header = (table[0] ?? []).map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new DomainError('VALIDATION', `missing columns: ${missing.join(', ')}`);
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS)
    throw new DomainError('VALIDATION', `at most ${MAX_IMPORT_ROWS} rows per import`);
  const col = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i < 0 ? '' : (row[i] ?? '').trim();
  };

  // What a requirement id resolves to: a source version, a source id, or an identifier a source carries.
  const sources = await listActiveSources(db, scope);
  const resolve = (ref: string): string[] => {
    if (ref.startsWith('story:')) return [];
    const byVersion = sources.find((s) => sourceRef(s.sourceId, s.version) === ref);
    if (byVersion) return [ref];
    return sources
      .filter((s) => s.sourceId === ref || s.identifiers.includes(ref))
      .map((s) => sourceRef(s.sourceId, s.version));
  };

  const status = input.approve ? 'APPROVED' : 'DRAFT';
  const report: ImportReport = {
    label,
    storyId: '',
    status,
    rows: body.length,
    imported: [],
    skipped: [],
    rejected: [],
    unresolvedRefs: {},
    unmappedTechniques: {},
    unmappedTestTypes: {},
    expectedOnLastStep: 0,
    executionsIgnored: 0,
  };

  return db.transaction(async (tx) => {
    const story = await insertStoryVersion(tx, scope, {
      externalId: `import:${label}`,
      title: `Imported catalogue ${label}`,
      description: `Cases imported from a test-case workbook by ${actor.id} (ADR-0022).`,
      acceptanceCriteria: [],
      targetRelease: null,
      createdBy: actor.id,
    });
    report.storyId = story.id;
    const taken = await listCaseCodes(tx, scope);

    for (const [k, row] of body.entries()) {
      const n = k + 2; // the spreadsheet row, counting the header as row 1
      const title = col(row, 'Title');
      const steps = numbered(col(row, 'Steps'));
      const expected = numbered(col(row, 'Expected Results'));
      const priority = col(row, 'Priority') || 'P2';
      if (!title) {
        report.rejected.push({ row: n, reason: 'no title' });
        continue;
      }
      if (steps.length === 0) {
        report.rejected.push({ row: n, reason: 'no steps' });
        continue;
      }
      if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) {
        report.rejected.push({ row: n, reason: `priority "${priority}" is not P0–P3` });
        continue;
      }
      const id = col(row, 'Test Case ID');
      const keep = CODE.test(id) ? id : null;
      if (keep && taken.has(keep)) {
        report.skipped.push({ row: n, code: keep, reason: 'a case with this code already exists' });
        continue;
      }

      const flags: string[] = [];
      const requirementRefs = list(col(row, 'Requirement ID(s)'));
      const resolved = new Set<string>();
      for (const ref of requirementRefs) {
        const hit = resolve(ref);
        hit.forEach((r) => resolved.add(r));
        if (!hit.length && !ref.startsWith('story:')) {
          bump(report.unresolvedRefs, ref);
          flags.push(`Imported requirement "${ref}" is not in the source registry`);
        }
      }
      const techniques: TestTechnique[] = [];
      for (const t of list(col(row, 'Technique(s)'))) {
        const parsed = TestTechnique.safeParse(TECHNIQUE_ALIASES[slug(t)] ?? slug(t));
        if (parsed.success) techniques.push(parsed.data);
        else {
          bump(report.unmappedTechniques, t);
          flags.push(`Imported technique "${t}" has no equivalent in the agent's list`);
        }
      }
      const testTypes: TestType[] = [];
      for (const t of list(col(row, 'Test Type'))) {
        const parsed = TestType.safeParse(slug(t));
        if (parsed.success) testTypes.push(parsed.data);
        else {
          bump(report.unmappedTestTypes, t);
          flags.push(`Imported test type "${t}" has no equivalent in the agent's list`);
        }
      }
      const paired = expected.length === steps.length;
      if (!paired && expected.length) report.expectedOnLastStep++;
      const automation = col(row, 'Automation Candidate');
      const level = /\bapi\b/i.test(automation) ? 'api' : /\bui\b/i.test(automation) ? 'ui' : 'manual';
      const manualReason = level === 'manual' ? (/^no\s*:\s*(.+)$/i.exec(automation)?.[1] ?? '') : '';
      const notes = lines(col(row, 'Notes'));
      const refs = [
        ...notes.flatMap((l) => (/^refs?:/i.test(l) ? list(l.replace(/^refs?:/i, '')) : [])),
        ...(id && !keep ? [`imported as ${id}`] : []),
      ];
      const stepRefs = [...resolved];
      const content = DraftContent.parse({
        title,
        priority,
        preconditions: lines(col(row, 'Preconditions')),
        testData: lines(col(row, 'Test Data')),
        steps: steps.map((action, i) => ({
          action,
          expected: paired ? expected[i]! : i === steps.length - 1 ? expected.join('\n') : '',
          sourceRefs: stepRefs,
          testData: '',
        })),
        assumptions: lines(col(row, 'Assumptions')),
        missingRequirements: [],
        requirementRefs,
        techniques: [...new Set(techniques)],
        testTypes: [...new Set(testTypes)],
        testConditions: [],
        module: col(row, 'Feature/Module'),
        level,
        manualReason,
        basis: col(row, 'Basis') === 'assumption' ? 'assumption' : 'specified',
        openQuestions: list(col(row, 'Open Questions')),
        refs,
        smoke: false,
        reviewFlags: flags,
      });
      if (!['', 'not run'].includes(col(row, 'Status').toLowerCase())) report.executionsIgnored++;
      const created = await createTestCase(tx, scope, {
        storyId: story.id,
        workflowId: null,
        content,
        sourceRefs: stepRefs,
        authorId: actor.id,
        code: keep ?? undefined,
        status,
      });
      taken.add(created.code!);
      report.imported.push({ row: n, code: created.code!, caseId: created.caseId });
    }

    await insertAuditEvent(tx, scope, {
      actorId: actor.id,
      workflowId: null,
      correlationId: null,
      actionKind: 'CASES_IMPORTED',
      actionHash: null,
      target: `import:${label}`,
      policyVersion: null,
      decisionRecordId: null,
      approvalId: null,
      outcome: `${status}${status === 'APPROVED' ? ` by ${actor.id}` : ''}:${report.imported.length} imported, ${report.skipped.length} skipped, ${report.rejected.length} rejected`,
    });
    return report;
  });
}
