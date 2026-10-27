import { listLatestCases, listLatestExecutions, listSuiteCases, type Db } from '@qa/db';
import { DraftContent, type TenantScope } from '@qa/domain';

// ADR-0018: the tester workbook, generated from the stored cases. Columns follow the team's
// manual test-case schema (manual-test-design skill §7). Execution columns come only from
// recorded runs; a case never executed reads "Not Run".

export const CASE_COLUMNS = [
  'Test Case ID',
  'Requirement ID(s)',
  'Title',
  'Feature/Module',
  'Technique(s)',
  'Test Type',
  'Priority',
  'Preconditions',
  'Test Data',
  'Steps',
  'Expected Results',
  'Basis',
  'Assumptions',
  'Open Questions',
  'Actual Result',
  'Status',
  'Defect ID',
  'Environment',
  'Notes',
  'Automation Candidate',
] as const;

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 with CRLF and a UTF-8 BOM, so spreadsheet programs read accented text correctly. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return `${BOM}${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

const STATUS_WORD: Record<string, string> = {
  PASSED: 'Pass',
  FAILED: 'Fail',
  BLOCKED: 'Blocked',
  INCONCLUSIVE: 'Inconclusive',
};

export async function testCasesCsv(db: Db, scope: TenantScope, filter: { suiteId?: string } = {}) {
  const [cases, executions] = await Promise.all([
    listLatestCases(db, scope),
    listLatestExecutions(db, scope),
  ]);
  const inSuite = filter.suiteId
    ? new Map((await listSuiteCases(db, scope, filter.suiteId)).map((c) => [c.caseId, c.section]))
    : null;
  const latest = new Map(executions.map((e) => [e.caseId, e]));
  const lines = (xs: string[]) => xs.join('\n');
  const rows = cases
    .filter((c) => !inSuite || inSuite.has(c.caseId))
    .map((c) => {
      const d = DraftContent.parse(c.content);
      const e = latest.get(c.caseId);
      const refs = [...new Set([...d.requirementRefs, ...c.sourceRefs])];
      return [
        c.code ?? c.caseId,
        refs.join(', '),
        d.title,
        d.module || inSuite?.get(c.caseId) || '',
        d.techniques.join(', '),
        d.testTypes.join(', '),
        d.priority,
        lines(d.preconditions),
        lines([
          ...d.testData,
          ...d.steps.map((s, i) => (s.testData ? `${i + 1}. ${s.testData}` : '')).filter(Boolean),
        ]),
        lines(d.steps.map((s, i) => `${i + 1}. ${s.action}`)),
        lines(d.steps.map((s, i) => `${i + 1}. ${s.expected}`)),
        d.basis,
        lines(d.assumptions),
        d.openQuestions.join(', '),
        e?.actual ?? e?.reason ?? (e ? 'As expected' : ''),
        e ? (STATUS_WORD[e.status] ?? e.status) : 'Not Run',
        e?.defectRef ?? c.knownBug ?? '',
        e?.environmentId ?? '',
        lines([
          ...(c.status !== 'APPROVED' ? [`Revision ${c.revision} is ${c.status}`] : []),
          ...d.reviewFlags,
          ...(c.knownBug ? [`Known bug ${c.knownBug}: a failure is expected until it is fixed`] : []),
          ...(e?.build ? [`Last run on build ${e.build}`] : []),
        ]),
        d.level === 'manual' ? (d.manualReason ? `No: ${d.manualReason}` : 'No') : `Yes (${d.level})`,
      ];
    });
  return toCsv([[...CASE_COLUMNS], ...rows]);
}

/** Requirement × case matrix: one row per requirement reference, the cases that cite it as columns. */
export async function traceabilityCsv(db: Db, scope: TenantScope) {
  const cases = await listLatestCases(db, scope);
  const byRef = new Map<string, Array<{ caseId: string; title: string; status: string }>>();
  for (const c of cases) {
    const d = DraftContent.safeParse(c.content).data;
    for (const ref of new Set([...(d?.requirementRefs ?? []), ...c.sourceRefs])) {
      byRef.set(ref, [
        ...(byRef.get(ref) ?? []),
        { caseId: c.code ?? c.caseId, title: d?.title ?? c.caseId, status: c.status },
      ]);
    }
  }
  const rows = [...byRef.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ref, list]) => [
      ref,
      String(list.length),
      String(list.filter((c) => c.status === 'APPROVED').length),
      list.map((c) => `${c.caseId} (${c.status}): ${c.title}`).join('\n'),
    ]);
  return toCsv([['Requirement', 'Cases', 'Approved cases', 'Case list'], ...rows]);
}
