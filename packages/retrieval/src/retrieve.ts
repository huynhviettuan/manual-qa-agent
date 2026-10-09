import {
  activeSourcesForRuleKeys,
  insertUsageEvent,
  searchTrustedChunks,
  type ChunkHit,
  type Db,
} from '@qa/db';
import { type EvidenceChunk, type RetrievalResult, type TenantScope, sha256, sourceRef } from '@qa/domain';

export type QueryType = 'GENERATE_TEST' | 'CLARIFY_AC' | 'TRIAGE_FAILURE';

// T1 defines expected behavior; T2 may inform edge cases; T3 is triage evidence only (docs/04).
const TIERS: Record<QueryType, string[]> = {
  GENERATE_TEST: ['T1', 'T2'],
  CLARIFY_AC: ['T1', 'T2'],
  TRIAGE_FAILURE: ['T1', 'T2', 'T3'],
};

/** Starting soft budget for retrieved sources (docs/04); to be tuned against evals. */
export const DEFAULT_SOURCE_BUDGET_TOKENS = 1800;

export type RetrieveInput = {
  queryType: QueryType;
  text: string;
  identifiers: string[];
  /**
   * Text a full-text-only hit must overlap with (defaults to `text`), e.g. just the acceptance
   * criteria so that generic title/description words cannot qualify a source.
   */
  focusText?: string;
  /** Minimum distinct focus keywords a non-exact hit must contain (default 2). */
  minKeywordMatches?: number;
  budgetTokens?: number;
  workflowId?: string | null;
};

const TIER_RANK: Record<string, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

/**
 * Builds an OR-of-keywords websearch query. Passing a whole story verbatim would AND every
 * term and match almost nothing; ts_rank still favours chunks matching more terms.
 */
export function toKeywordQuery(text: string, maxTerms = 40): string {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  return [...new Set(words)].slice(0, maxTerms).join(' or ');
}

const STOPWORDS = new Set(
  'the and for with that this from into when then than have has had are was were will shall should must not but all any can may each been being their there which what who whom whose where after before about above below under over only also more most other some such very just user users system page'.split(
    ' ',
  ),
);

/** Meaningful keywords, crudely stemmed (5-char prefix) so "locked"/"locks" match. */
export function keywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)).map((w) => w.slice(0, 5)));
}

function rank(a: ChunkHit, b: ChunkHit): number {
  return (
    Number(b.exactMatch) - Number(a.exactMatch) ||
    TIER_RANK[a.trustTier]! - TIER_RANK[b.trustTier]! ||
    b.textRank - a.textRank ||
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  );
}

/**
 * Trusted, scope-filtered retrieval with exact-ID priority, contradiction detection and a
 * context budget that drops whole chunks (T2 first) and never truncates a rule mid-text.
 */
export async function retrieve(db: Db, scope: TenantScope, input: RetrieveInput): Promise<RetrievalResult> {
  const started = performance.now();
  const budget = input.budgetTokens ?? DEFAULT_SOURCE_BUDGET_TOKENS;

  const hits = await searchTrustedChunks(db, scope, {
    identifiers: input.identifiers,
    text: toKeywordQuery(input.text),
    tiers: TIERS[input.queryType],
    limit: 25,
  });
  // A single shared common word is not evidence: full-text-only hits need real keyword overlap.
  const focus = keywords(input.focusText ?? input.text);
  const minMatches = Math.min(input.minKeywordMatches ?? 2, focus.size);
  const relevant = hits.filter((h) => {
    if (h.exactMatch) return true;
    const own = keywords(`${h.heading ?? ''} ${h.content}`);
    let matched = 0;
    for (const k of focus) if (own.has(k)) matched++;
    return matched >= Math.max(minMatches, 1);
  });
  const ranked = [...new Map(relevant.map((h) => [h.chunkId, h])).values()].sort(rank);

  // Budget: T1 in rank order first, then T2. A chunk that does not fit is dropped whole.
  const selected: ChunkHit[] = [];
  let used = 0;
  let budgetExceeded = false;
  const gaps: string[] = [];
  for (const tier of TIERS[input.queryType]) {
    for (const h of ranked.filter((c) => c.trustTier === tier)) {
      if (used + h.tokenEstimate > budget) {
        if (tier === 'T1') budgetExceeded = true;
        else gaps.push(`Dropped ${sourceRef(h.sourceId, h.version)} (${tier}) to fit the context budget`);
        continue;
      }
      selected.push(h);
      used += h.tokenEstimate;
    }
  }
  selected.sort(rank);

  const coveredIdentifiers = input.identifiers.filter((id) =>
    selected.some((c) => c.identifiers.includes(id)),
  );
  for (const id of input.identifiers) {
    if (!coveredIdentifiers.includes(id)) gaps.push(`No trusted source references ${id}`);
  }

  // Contradictions: different active sources asserting the same business-rule key.
  const ruleKeys = [...new Set(selected.flatMap((c) => c.ruleKeys))];
  const peers = await activeSourcesForRuleKeys(db, scope, ruleKeys);
  const contradictions: RetrievalResult['contradictions'] = [];
  for (const key of ruleKeys) {
    const holders = peers.filter((p) => p.ruleKeys.includes(key));
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const a = holders[i]!;
        const b = holders[j]!;
        const refRefines =
          a.refines.includes(sourceRef(b.sourceId, b.version)) ||
          b.refines.includes(sourceRef(a.sourceId, a.version));
        if (a.sourceId !== b.sourceId && a.contentHash !== b.contentHash && !refRefines) {
          contradictions.push({
            first: sourceRef(a.sourceId, a.version),
            second: sourceRef(b.sourceId, b.version),
            ruleKey: key,
          });
        }
      }
    }
  }

  const chunks: EvidenceChunk[] = selected.map((h) => ({
    sourceId: h.sourceId,
    version: h.version,
    chunkId: h.chunkId,
    content: h.heading ? `${h.heading}\n${h.content}` : h.content,
    trustTier: h.trustTier,
    relevance: h.exactMatch ? 1 + h.textRank : h.textRank,
  }));
  const snapshotId = `snap_${sha256(
    selected
      .map((h) => `${h.chunkId}:${h.contentHash}`)
      .sort()
      .join('|'),
  ).slice(0, 16)}`;

  await insertUsageEvent(db, scope, {
    workflowId: input.workflowId ?? null,
    component: 'retrieval',
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    retrievedTokensEstimate: used,
    latencyMs: performance.now() - started,
  });

  return {
    status: chunks.length === 0 ? 'NO_TRUSTED_CONTEXT' : 'OK',
    chunks,
    snapshotId,
    usedTokensEstimate: used,
    budgetExceeded,
    coveredIdentifiers,
    gaps,
    contradictions,
  };
}
