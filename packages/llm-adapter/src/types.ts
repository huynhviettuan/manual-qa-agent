import type { AcceptanceCriterion, DraftContent, EvidenceChunk, Readiness } from '@qa/domain';

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
};

export type DraftInput = { story: StoryInput; sources: EvidenceChunk[] };

export interface ReadinessClassifier {
  classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>>;
}

export interface DraftGenerator {
  generate(input: DraftInput): Promise<ProviderOutcome<DraftContent>>;
}
