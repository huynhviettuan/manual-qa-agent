import { SessionExchangeProvider } from './session.ts';
import type { ExecutableGenerator } from './executables.ts';
import { DomainError } from '@qa/domain';
import { ClaudeProvider, createAnthropicClient, DEFAULT_CLAUDE_MODEL, type Effort } from './claude.ts';
import { createFakeAnthropicFetch, heuristicResponder } from './fake-anthropic.ts';
import { createFakeJevFetch, jevHeuristicResponder } from './fake-jev.ts';
import { createFakeOpenAIFetch, openaiHeuristicResponder } from './fake-openai.ts';
import { createJevClient, DEFAULT_JEV_MODEL, JevClassifier } from './jev.ts';
import {
  createOpenAIClient,
  DEFAULT_DECISIONS_MODEL,
  OpenAIDecisionsClassifier,
  OpenAIResponsesDrafter,
} from './openai.ts';
import type { DraftGenerator, ReadinessClassifier, TriageClassifier } from './types.ts';

export * from './claude.ts';
export * from './executables.ts';
export * from './decision-readiness.ts';
export * from './decision-triage.ts';
export * from './fake-anthropic.ts';
export * from './fake-jev.ts';
export * from './fake-openai.ts';
export * from './grounding.ts';
export * from './heuristic.ts';
export * from './jev.ts';
export * from './openai.ts';
export * from './session.ts';
export * from './prompts.ts';
export * from './types.ts';

/** Providers that can generate drafts (and, by default, also answer readiness). */
export const DRAFT_PROVIDERS = ['anthropic', 'openai'] as const;
export type DraftProviderName = (typeof DRAFT_PROVIDERS)[number];

/** Typed-decision APIs that may override readiness (ADR-0006, ADR-0007). */
export const DECISION_PROVIDERS = ['openai', 'jev'] as const;
export type ReadinessProviderName = 'anthropic' | (typeof DECISION_PROVIDERS)[number];

export type DecisionProviders = {
  providers: { readiness: ReadinessProviderName | 'session'; draft: DraftProviderName | 'session' };
  /** ADR-0026: how a real model is reached. `mock` is the keyless stand-in. */
  mode: 'api-key' | 'session' | 'mock';
  /** false = deterministic heuristic behind each provider's real SDK (no network, no cost). */
  live: boolean;
  classifier: ReadinessClassifier;
  /** Failure triage, answered by the readiness provider (ADR-0009). */
  triager: TriageClassifier;
  generator: DraftGenerator;
  /** Proposes executable steps (ADR-0024); null when the provider has no such notion. */
  executables: ExecutableGenerator | null;
  models: { readiness: string; draft: string };
};

/**
 * - `QA_LLM_PROVIDER=anthropic|openai` (default anthropic) generates drafts and, by default,
 *   answers readiness: Claude for both, or OpenAI Decisions (readiness) + Responses (drafts).
 * - `QA_READINESS_PROVIDER=openai|jev` optionally routes readiness to a typed-decision API.
 * - `QA_LLM_MODEL`: drafts model (Anthropic default `claude-opus-5-5`; OpenAI required when live).
 * - `QA_DECISIONS_MODEL`: decision-API model (OpenAI `gpt-6-luna`, Jev `jev-1.13.0`).
 * - `QA_LIVE_LLM=1` calls real APIs (billed); otherwise heuristics run behind the same SDK paths.
 * - `QA_LLM_PROVIDER=session` (ADR-0026) needs no key: readiness, drafts and executables go through the
 *   file exchange of `QA_SESSION_EXCHANGE_DIR` (default `./.session-exchange`), answered by Claude in an
 *   interactive Claude Code session (ADR-0020). Triage falls back to the stand-in.
 */
export function createProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): DecisionProviders {
  const live = env.QA_LIVE_LLM === '1';
  const label = (name: string) => (live ? name : `${name}-mock`);

  if (env.QA_LLM_PROVIDER === 'session') {
    const session = new SessionExchangeProvider({
      dir: env.QA_SESSION_EXCHANGE_DIR || './.session-exchange',
      modelLabel: env.QA_SESSION_MODEL_LABEL || 'claude (interactive Claude Code session)',
    });
    const standIn = new ClaudeProvider({
      client: createAnthropicClient({
        apiKey: 'mock-no-network',
        fetch: createFakeAnthropicFetch(heuristicResponder),
      }),
      model: DEFAULT_CLAUDE_MODEL,
      effort: 'medium',
      providerLabel: 'anthropic-mock',
    });
    return {
      providers: { readiness: 'session', draft: 'session' },
      mode: 'session',
      live: false,
      classifier: session,
      triager: standIn,
      generator: session,
      executables: session,
      models: { readiness: 'session', draft: 'session' },
    };
  }

  const draft = (env.QA_LLM_PROVIDER || 'anthropic') as DraftProviderName;
  if (!DRAFT_PROVIDERS.includes(draft)) {
    const hint =
      draft === ('jev' as string) ? ' (jev answers readiness only: set QA_READINESS_PROVIDER=jev)' : '';
    throw new DomainError(
      'VALIDATION',
      `QA_LLM_PROVIDER must be one of ${DRAFT_PROVIDERS.join(', ')}${hint}`,
    );
  }
  const override = env.QA_READINESS_PROVIDER as (typeof DECISION_PROVIDERS)[number] | undefined;
  if (override && !DECISION_PROVIDERS.includes(override)) {
    throw new DomainError(
      'VALIDATION',
      `QA_READINESS_PROVIDER must be one of ${DECISION_PROVIDERS.join(', ')}`,
    );
  }
  const readiness: ReadinessProviderName = override ?? (draft === 'anthropic' ? 'anthropic' : 'openai');

  let openaiClient: ReturnType<typeof createOpenAIClient> | undefined;
  const openai = () =>
    (openaiClient ??= live
      ? createOpenAIClient()
      : createOpenAIClient({
          apiKey: 'mock-no-network',
          fetch: createFakeOpenAIFetch(openaiHeuristicResponder),
        }));

  // Drafts.
  let generator: DraftGenerator;
  let claude: ClaudeProvider | undefined;
  let draftModel: string;
  if (draft === 'anthropic') {
    draftModel = env.QA_LLM_MODEL || DEFAULT_CLAUDE_MODEL;
    claude = new ClaudeProvider({
      client: live
        ? createAnthropicClient()
        : createAnthropicClient({
            apiKey: 'mock-no-network',
            fetch: createFakeAnthropicFetch(heuristicResponder),
          }),
      model: draftModel,
      effort: (env.QA_LLM_EFFORT as Effort | undefined) || 'medium',
      providerLabel: label('anthropic'),
    });
    generator = claude;
  } else {
    draftModel = env.QA_LLM_MODEL || (live ? '' : 'gpt-mock-draft');
    if (!draftModel) {
      throw new DomainError(
        'VALIDATION',
        'QA_LLM_MODEL (Responses API model for drafts) is required for live OpenAI',
      );
    }
    generator = new OpenAIResponsesDrafter({
      client: openai(),
      model: draftModel,
      providerLabel: label('openai'),
    });
  }

  // Readiness.
  let classifier: ReadinessClassifier & TriageClassifier;
  let readinessModel: string;
  if (readiness === 'anthropic') {
    classifier = claude!;
    readinessModel = draftModel;
  } else if (readiness === 'openai') {
    const c = new OpenAIDecisionsClassifier({
      client: openai(),
      model: env.QA_DECISIONS_MODEL || DEFAULT_DECISIONS_MODEL,
      providerLabel: label('openai'),
    });
    classifier = c;
    readinessModel = c.model;
  } else {
    const c = new JevClassifier({
      client: live
        ? createJevClient()
        : createJevClient({ apiKey: 'mock-no-network', fetch: createFakeJevFetch(jevHeuristicResponder) }),
      model: env.QA_DECISIONS_MODEL || DEFAULT_JEV_MODEL,
      providerLabel: label('jev'),
    });
    classifier = c;
    readinessModel = c.model;
  }

  return {
    providers: { readiness, draft },
    mode: live ? 'api-key' : 'mock',
    live,
    classifier,
    triager: classifier,
    generator,
    executables: claude ?? null,
    models: { readiness: readinessModel, draft: draftModel },
  };
}
