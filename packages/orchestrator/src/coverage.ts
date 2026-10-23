import { listActiveSources, listLatestCases, listLatestStories, type Db } from '@qa/db';
import { DraftContent, type TenantScope } from '@qa/domain';

// ADR-0018: requirement coverage, computed from what cases actually cite. Granularity is the
// source (`sourceId@version`) and the story criterion (`story:AC`); an identifier inside a source
// counts as covered when a case cites that source. Nothing here is estimated.

export type CoverageCase = { caseId: string; title: string; status: string; revision: number };

const sourceIdOf = (ref: string) => ref.split('@')[0]!;

export async function getCoverage(db: Db, scope: TenantScope) {
  const [sources, cases, stories] = await Promise.all([
    listActiveSources(db, scope),
    listLatestCases(db, scope),
    listLatestStories(db, scope),
  ]);

  const citing = new Map<string, CoverageCase[]>(); // sourceId or story:AC -> cases
  for (const c of cases) {
    const content = DraftContent.safeParse(c.content).data;
    const refs = new Set([...(content?.requirementRefs ?? []), ...c.sourceRefs]);
    const entry = {
      caseId: c.caseId,
      title: content?.title ?? c.caseId,
      status: c.status,
      revision: c.revision,
    };
    for (const ref of refs) {
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
    },
    gaps: {
      sources: bySource.filter((s) => s.cases.length === 0).map((s) => `${s.sourceId}@${s.version}`),
      criteria: byCriterion.filter((c) => c.cases.length === 0).map((c) => `${c.story}:${c.criterion}`),
      identifiers: [...identifiers.entries()].filter(([, s]) => s.size === 0).map(([id]) => id),
    },
    bySource,
    byCriterion,
    byIdentifier: [...identifiers.entries()].map(([identifier, set]) => ({ identifier, caseIds: [...set] })),
  };
}
