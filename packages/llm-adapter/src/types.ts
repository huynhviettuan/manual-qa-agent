import type { AcceptanceCriterion, DraftSet, EvidenceChunk, Readiness } from '@qa/domain';

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Everything persisted to a DecisionRecord, success or failure. */
export type CallMeta = {
  provider: string;
  requestedModel: string;
  /** Model that actually produced the answer (differs from requested after a refusal fallback). */
  model: string | null;
  promptVersion: string;
  inputHash: string;
  usage: Usage | null;
  latencyMs: number;
};

export type FailureKind = 'REFUSED' | 'MALFORMED' | 'UNAVAILABLE' | 'UNGROUNDED' | 'INCONSISTENT';

export type ProviderFailure = { ok: false; failure: FailureKind; detail: string; meta: CallMeta };
export type ProviderSuccess<T> = { ok: true; value: T; meta: CallMeta };
export type ProviderOutcome<T> = ProviderSuccess<T> | ProviderFailure;

export type StoryInput = {
  externalId: string;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
};

export type ReadinessInput = { story: StoryInput; sources: EvidenceChunk[] };

export type ReadinessAssessment = {
  readiness: Readiness;
  missingExpectations: string[];
  clarificationQuestion: string | null;
  /** `sourceId@version` citations; must all be in the supplied sources. */
  citedSourceIds: string[];
  /**
   * Provider-reported confidence in `readiness` (OpenAI Decisions), or null when the provider
   * has none (Claude). Uncalibrated; policy may only use it to downgrade, never to authorize.
   */
  confidence: number | null;
  /**
   * When not ready: the clauses of the acceptance criteria that are specified enough to draft
   * now, quoted from the criteria (ADR-0024). The rest waits for the clarification. Providers
   * without the notion leave it empty.
   */
  draftableClauses?: string[];
};

export type DraftInput = { story: StoryInput; sources: EvidenceChunk[] };

export interface ReadinessClassifier {
  classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>>;
  /** Stable provider/model/prompt identity for the decision cache; omit to disable caching. */
  readonly readinessCacheId?: string;
}

export interface DraftGenerator {
  generate(input: DraftInput): Promise<ProviderOutcome<DraftSet>>;
}

// ------------------------------------------------------------------ failure triage (ADR-0009)

export const SUSPECTED_CAUSES = ['PRODUCT_DEFECT', 'TEST_ISSUE', 'ENVIRONMENT', 'UNKNOWN'] as const;
export type SuspectedCause = (typeof SUSPECTED_CAUSES)[number];

/**
 * Deterministic, redacted facts extracted from a run's assertions and evidence logs.
 * Raw evidence (screenshots, full logs) is never sent to a model.
 */
export type TriageFacts = {
  verdict: 'FAILED' | 'INCONCLUSIVE';
  reason: string;
  environmentKind: string;
  failingStep: { id: string; description: string; expected: unknown; actual: unknown } | null;
  stepErrors: string[];
  httpErrors: Array<{ method: string; path: string; status: number }>;
  failedRequests: number;
  blockedRequests: number;
  consoleErrors: string[];
};

export type TriageAssessment = {
  /** Suggestion only: never changes the run verdict and is shown as "suspected". */
  suspectedCause: SuspectedCause;
  securitySensitive: boolean;
  /** Decision-API yes-probability for "security relevant"; null for providers without one. */
  securityProbability: number | null;
  rationale: string | null;
  confidence: number | null;
};

export interface TriageClassifier {
  triage(facts: TriageFacts): Promise<ProviderOutcome<TriageAssessment>>;
  /** Stable provider/model/prompt identity for the decision cache; omit to disable caching. */
  readonly triageCacheId?: string;
}
