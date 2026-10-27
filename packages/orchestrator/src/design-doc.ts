import { listLatestCases, listPublishedBugCases, type Db, type LatestCaseRow } from '@qa/db';
import { DraftContent, type TenantScope } from '@qa/domain';
import { getCoverage } from './coverage.ts';
import { listQuestions } from './questions.ts';

// ADR-0021: the test-design document a team reads (the eight sections of the manual-test-design
// skill), assembled from the records: coverage, the question register, priorities, the smoke set
// and the regression scope by module. Nothing here is written by a model; every number is a count
// of stored cases, and execution facts come only from recorded runs.

type Case = {
  id: string;
  code: string;
  title: string;
  status: string;
  module: string;
  priority: string;
  level: string;
  basis: string;
  smoke: boolean;
  techniques: string[];
  assumptions: string[];
  openQuestions: string[];
  refs: string[];
  knownBug: string | null;
};

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const list = (cs: Case[]) => (cs.length ? cs.map((c) => c.code).join(', ') : 'none');
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');

function toCase(c: LatestCaseRow): Case {
  const d = DraftContent.safeParse(c.content).data;
  return {
    id: c.caseId,
    code: c.code ?? c.caseId,
    title: d?.title ?? c.caseId,
    status: c.status,
    module: d?.module || '(no module)',
    priority: d?.priority ?? 'P3',
    level: d?.level ?? 'manual',
    basis: d?.basis ?? 'specified',
    smoke: d?.smoke ?? false,
    techniques: d?.techniques ?? [],
    assumptions: d?.assumptions ?? [],
    openQuestions: d?.openQuestions ?? [],
    refs: [...new Set([...(d?.requirementRefs ?? []), ...c.sourceRefs])],
    knownBug: c.knownBug,
  };
}

export async function testDesignMarkdown(db: Db, scope: TenantScope, now = new Date()): Promise<string> {
  const [rows, coverage, questions, bugs] = await Promise.all([
    listLatestCases(db, scope),
    getCoverage(db, scope),
    listQuestions(db, scope),
    listPublishedBugCases(db, scope),
  ]);
  const cases = rows.map(toCase);
  const approved = cases.filter((c) => c.status === 'APPROVED');
  const byModule = new Map<string, Case[]>();
  for (const c of approved) byModule.set(c.module, [...(byModule.get(c.module) ?? []), c]);
  const byTechnique = new Map<string, number>();
  for (const c of approved) for (const t of c.techniques) byTechnique.set(t, (byTechnique.get(t) ?? 0) + 1);
  const byPriority = (p: string) => approved.filter((c) => c.priority === p);
  const guards = new Map(bugs.map((b) => [b.caseId, b.bugs]));
  const guarding = approved.filter((c) => guards.has(c.id) || c.knownBug);
  const t = coverage.totals;

  const out: string[] = [];
  out.push(`# ${scope.projectId} — test design`, '');
  out.push(
    `Generated ${now.toISOString().slice(0, 10)} from the stored cases: ${cases.length} cases, ${approved.length} approved, ` +
      `${approved.filter((c) => c.level !== 'manual').length} automatable (api or ui), ` +
      `${approved.filter((c) => c.level === 'manual').length} manual. Every figure is a count of records; ` +
      'execution results come only from recorded runs (see test-cases.csv).',
    '',
  );

  out.push('## 1. Requirement analysis', '');
  out.push(
    `${t.sources} approved source versions carrying ${t.identifiers} requirement identifiers; ${t.criteria} acceptance criteria across the submitted stories.`,
    '',
  );
  out.push(
    table(
      ['Source', 'Type', 'Area', 'Identifiers', 'Cases'],
      coverage.bySource.map((s) => [
        `${s.sourceId}@${s.version}`,
        s.sourceType,
        s.productArea ?? '',
        String(s.identifiers.length),
        String(s.approvedCases),
      ]),
    ),
    '',
  );
  out.push('### Ambiguities and open questions', '');
  const open = questions.filter((q) => q.status !== 'RESOLVED');
  out.push(
    open.length
      ? table(
          ['Question', 'About', 'Current behaviour (observed)', 'Cases'],
          open.map((q) => [
            `${q.id}: ${q.question}`,
            q.about.join(', '),
            q.currentBehaviour ?? '—',
            q.cases.map((c) => cases.find((x) => x.id === c.caseId)?.code ?? c.caseId).join(', ') || '—',
          ]),
        )
      : 'None open.',
    '',
  );

  out.push('## 2. Techniques selected, and why', '');
  out.push(
    byTechnique.size
      ? table(
          ['Technique', 'Approved cases'],
          [...byTechnique.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, String(n)]),
        )
      : 'No approved case names a technique yet.',
    '',
    'Each case names the technique its conditions came from (ADR-0014); the design notes of each draft set hold the partitions, boundaries and rule columns.',
    '',
  );

  out.push('## 3. Test conditions and coverage model', '');
  out.push(
    `Sources cited by at least one case: ${t.sourcesCovered} / ${t.sources}. Acceptance criteria covered: ${t.criteriaCovered} / ${t.criteria}. Requirement identifiers covered: ${t.identifiersCovered} / ${t.identifiers}.`,
    '',
  );

  out.push('## 4. Test cases', '');
  out.push(
    table(
      ['Module', 'Approved', 'P0', 'Automatable', 'Manual'],
      [...byModule.entries()].map(([m, cs]) => [
        m,
        String(cs.length),
        String(cs.filter((c) => c.priority === 'P0').length),
        String(cs.filter((c) => c.level !== 'manual').length),
        String(cs.filter((c) => c.level === 'manual').length),
      ]),
    ),
    '',
    'The full schema of every case is in test-cases.csv.',
    '',
  );

  out.push('## 5. Traceability', '');
  out.push('Requirement × case: traceability.csv. Criteria with their cases:', '');
  out.push(
    table(
      ['Story', 'Criterion', 'Cases'],
      coverage.byCriterion.map((c) => [
        c.story,
        c.criterion,
        c.cases.map((x) => x.code ?? x.caseId).join(', ') || '—',
      ]),
    ),
    '',
  );

  out.push('## 6. Coverage gaps and assumptions', '');
  out.push(
    `**Sources no case cites (${coverage.gaps.sources.length}):** ${coverage.gaps.sources.join(', ') || 'none'}.`,
    '',
  );
  out.push(
    `**Criteria no case covers (${coverage.gaps.criteria.length}):** ${coverage.gaps.criteria.join(', ') || 'none'}.`,
    '',
  );
  out.push(
    `**Identifiers no case reaches (${coverage.gaps.identifiers.length}):** ${coverage.gaps.identifiers.join(', ') || 'none'}.`,
    '',
  );
  const assumed = approved.filter((c) => c.basis === 'assumption');
  out.push(`**Cases resting on assumptions (${assumed.length}):**`, '');
  out.push(
    assumed.length
      ? table(
          ['Case', 'Assumption', 'Open question'],
          assumed.map((c) => [c.code, c.assumptions.join('; '), c.openQuestions.join(', ') || '—']),
        )
      : 'None.',
    '',
  );
  out.push(
    `**Stale cases (${coverage.stale.length}):** approved against a source version that is no longer active.`,
    '',
  );
  out.push(
    coverage.stale.length
      ? table(
          ['Case', 'Cited version', 'Now'],
          coverage.stale.flatMap((s) => s.refs.map((r) => [s.code ?? s.caseId, r.ref, r.status])),
        )
      : 'None.',
    '',
  );

  out.push('## 7. Risk-based execution order', '');
  out.push(
    'Run in this order; stop and report on any P0 failure. P0 is money, double consumption, authorization bypass or silent data loss.',
    '',
  );
  for (const p of ['P0', 'P1', 'P2', 'P3'])
    out.push(`**${p}** (${byPriority(p).length}): ${list(byPriority(p))}`, '');
  const smoke = approved.filter((c) => c.smoke);
  out.push(`**Smoke** (each run of a pull request, ${smoke.length}): ${list(smoke)}`, '');

  out.push('## 8. Suggested regression scope', '');
  out.push(
    'For a change, run the cases of the module it touches, plus all P0, plus the cases guarding a defect. `GET /api/regression?ref=<requirement id>` selects the cases citing one requirement.',
    '',
  );
  out.push(
    table(
      ['Module changed', 'Cases to run'],
      [...byModule.entries()].map(([m, cs]) => [m, list(cs)]),
    ),
    '',
  );
  out.push(
    `**Cases guarding a defect (${guarding.length}):** ` +
      (guarding
        .map(
          (c) =>
            `${c.code} (${[...(guards.get(c.id) ?? []), ...(c.knownBug ? [c.knownBug] : [])].join(', ')})`,
        )
        .join(', ') || 'none') +
      '.',
    '',
  );
  return out.join('\n');
}
