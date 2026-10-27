import {
  listActiveSources,
  listLatestCases,
  listLatestStories,
  listPublishedBugCases,
  listSourceStatuses,
  type Db,
  type LatestCaseRow,
} from '@qa/db';
import { DraftContent, type TenantScope } from '@qa/domain';

// ADR-0018: requirement coverage, computed from what cases actually cite. Granularity is the
// source (`sourceId@version`) and the story criterion (`story:AC`); an identifier inside a source
// counts as covered when a case cites that source. Nothing here is estimated.
// ADR-0021 adds what a case's citations say about its own life: a case citing a superseded or
// revoked source version is stale, and a requirement's regression set is the cases citing it.

export type CoverageCase = {
  caseId: string;
  code: string | null;
  title: string;
  status: string;
  revision: number;
};

const sourceIdOf = (ref: string) => ref.split('@')[0]!;

const summary = (c: LatestCaseRow): CoverageCase => ({
  caseId: c.caseId,
  code: c.code,
  title: DraftContent.safeParse(c.content).data?.title ?? c.caseId,
  status: c.status,
  revision: c.revision,
});

const refsOf = (c: LatestCaseRow) =>
  new Set([...(DraftContent.safeParse(c.content).data?.requirementRefs ?? []), ...c.sourceRefs]);

/**
 * Approved cases whose cited source versions are no longer the active ones (superseded by a newer
 * approved version, revoked, or unknown to the registry). Their expected results were approved
 * against text that no longer governs: review them against the current version.
 */
export async function staleCases(db: Db, scope: TenantScope) {
  const [cases, statuses] = await Promise.all([listLatestCases(db, scope), listSourceStatuses(db, scope)]);
  const byRef = new Map(statuses.map((s) => [`${s.sourceId}@${s.version}`, s.status]));
  const out: Array<CoverageCase & { refs: Array<{ ref: string; status: string }> }> = [];
  for (const c of cases) {
    if (c.status !== 'APPROVED') continue;
    const refs = [...refsOf(c)]
      .filter((ref) => !ref.startsWith('story:'))
      .map((ref) => ({ ref, status: byRef.get(ref) ?? 'UNKNOWN' }))
      .filter((r) => r.status !== 'ACTIVE');
    if (refs.length) out.push({ ...summary(c), refs });
  }
  return out;
}

/**
 * The cases to run for a change to one requirement (ADR-0021 §regression): every case citing the
 * reference (an identifier such as `BR-404`, a source id, `sourceId@version` or `story:AC`), plus
 * every approved P0 case, plus the cases that guard a defect (published bugs and known bugs).
 */
export async function regressionScope(db: Db, scope: TenantScope, ref: string) {
  const [cases, sources, bugs] = await Promise.all([
    listLatestCases(db, scope),
    listActiveSources(db, scope),
    listPublishedBugCases(db, scope),
  ]);
  // Sources carrying the identifier, so `BR-404` finds cases that cite the source holding it.
  const holders = new Set(sources.filter((s) => s.identifiers.includes(ref)).map((s) => s.sourceId));
  const cites = (c: LatestCaseRow) =>
    [...refsOf(c)].some((r) => r === ref || sourceIdOf(r) === ref || holders.has(sourceIdOf(r)));
  const approved = cases.filter((c) => c.status === 'APPROVED');
  const guards = new Map(bugs.map((b) => [b.caseId, b.bugs]));
  const cited = approved.filter(cites).map(summary);
  const p0 = approved.filter((c) => DraftContent.safeParse(c.content).data?.priority === 'P0').map(summary);
  const guarding = approved
    .filter((c) => guards.has(c.caseId) || c.knownBug)
    .map((c) => ({
      ...summary(c),
      bugs: [...(guards.get(c.caseId) ?? []), ...(c.knownBug ? [c.knownBug] : [])],
    }));
  const all = new Map([...cited, ...p0, ...guarding].map((c) => [c.caseId, c]));
  return { ref, cited, p0, guarding, caseIds: [...all.keys()] };
}

export async function getCoverage(db: Db, scope: TenantScope) {
  const [sources, cases, stories, stale] = await Promise.all([
    listActiveSources(db, scope),
    listLatestCases(db, scope),
    listLatestStories(db, scope),
    staleCases(db, scope),
  ]);

  const citing = new Map<string, CoverageCase[]>(); // sourceId or story:AC -> cases
  for (const c of cases) {
    const entry = summary(c);
    for (const ref of refsOf(c)) {
      const key = ref.startsWith('story:') ? ref : sourceIdOf(ref);
      citing.set(key, [...(citing.get(key) ?? []), entry]);
    }
  }
  const approvedOnly = (list: CoverageCase[]) => list.filter((c) => c.status === 'APPROVED');

  const bySource = sources.map((s) => {
    const list = citing.get(s.sourceId) ?? [];
    return {
      sourceId: s.sourceId,
      version: s.version,
      sourceType: s.sourceType,
      productArea: s.productArea,
      identifiers: s.identifiers,
      cases: list,
      approvedCases: approvedOnly(list).length,
    };
  });
  const byCriterion = stories.flatMap((st) =>
    st.acceptanceCriteria.map((ac) => {
      const list = citing.get(`story:${ac.id}`) ?? [];
      return {
        story: st.externalId,
        criterion: ac.id,
        text: ac.text,
        cases: list,
        approvedCases: approvedOnly(list).length,
      };
    }),
  );
  const identifiers = new Map<string, Set<string>>(); // identifier -> case ids, through its sources
  for (const s of bySource) {
    for (const id of s.identifiers) {
      const set = identifiers.get(id) ?? new Set<string>();
      s.cases.forEach((c) => set.add(c.caseId));
      identifiers.set(id, set);
    }
  }

  return {
    totals: {
      sources: bySource.length,
      sourcesCovered: bySource.filter((s) => s.cases.length > 0).length,
      criteria: byCriterion.length,
      criteriaCovered: byCriterion.filter((c) => c.cases.length > 0).length,
      identifiers: identifiers.size,
      identifiersCovered: [...identifiers.values()].filter((s) => s.size > 0).length,
      cases: cases.length,
      approvedCases: cases.filter((c) => c.status === 'APPROVED').length,
      staleCases: stale.length,
    },
    gaps: {
      sources: bySource.filter((s) => s.cases.length === 0).map((s) => `${s.sourceId}@${s.version}`),
      criteria: byCriterion.filter((c) => c.cases.length === 0).map((c) => `${c.story}:${c.criterion}`),
      identifiers: [...identifiers.entries()].filter(([, s]) => s.size === 0).map(([id]) => id),
    },
    /** Approved cases citing a source version that is no longer active (ADR-0021). */
    stale,
    bySource,
    byCriterion,
    byIdentifier: [...identifiers.entries()].map(([identifier, set]) => ({ identifier, caseIds: [...set] })),
  };
}
