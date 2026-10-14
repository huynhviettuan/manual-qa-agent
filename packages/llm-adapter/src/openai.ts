import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { canonicalJson, DraftContent, sha256 } from '@qa/domain';
import {
  assessmentFromDecisions,
  DECISIONS_PROMPT_VERSION,
  readinessQuestions,
} from './decision-readiness.ts';
import { TRIAGE_DECISIONS_PROMPT_VERSION, triageFromDecisions, triageQuestions } from './decision-triage.ts';
import { checkDraft } from './grounding.ts';
import {
  buildPayload,
  buildTriagePayload,
  DRAFT_PROMPT_VERSION,
  DRAFT_SYSTEM,
  userMessage,
} from './prompts.ts';
import type {
  CallMeta,
  DraftGenerator,
  DraftInput,
  FailureKind,
  ProviderFailure,
  ProviderOutcome,
  ReadinessAssessment,
  ReadinessClassifier,
  ReadinessInput,
  TriageAssessment,
  TriageClassifier,
  TriageFacts,
} from './types.ts';

/** Only Decisions-capable model per docs/05 (snapshot 2026-10-09); re-verify at upgrade time. */
export const DEFAULT_DECISIONS_MODEL = 'gpt-6-luna';

/** Client with bounded retries (429/5xx/connection) and an explicit timeout. */
export function createOpenAIClient(opts: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
  return new OpenAI({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    maxRetries: 2,
    timeout: opts.timeoutMs ?? 120_000,
  });
}

/** Fail-closed mapping of SDK errors, most specific first. */
function classifyError(err: unknown): { failure: FailureKind; detail: string } {
  if (err instanceof OpenAI.RateLimitError) return { failure: 'UNAVAILABLE', detail: 'rate_limited' };
  if (err instanceof OpenAI.InternalServerError)
    return { failure: 'UNAVAILABLE', detail: `server_error_${err.status}` };
  if (err instanceof OpenAI.APIConnectionTimeoutError) return { failure: 'UNAVAILABLE', detail: 'timeout' };
  if (err instanceof OpenAI.APIConnectionError) return { failure: 'UNAVAILABLE', detail: 'connection_error' };
  if (err instanceof OpenAI.APIError)
    return { failure: 'UNAVAILABLE', detail: `api_error_${err.status ?? 'unknown'}` };
  // Structured-output parse failures surface as SDK, zod or JSON errors.
  if (err instanceof OpenAI.OpenAIError || err instanceof z.ZodError || err instanceof SyntaxError) {
    return { failure: 'MALFORMED', detail: String((err as Error).message).slice(0, 300) };
  }
  return {
    failure: 'UNAVAILABLE',
    detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown_error',
  };
}

function newMeta(
  provider: string,
  requestedModel: string,
  promptVersion: string,
  hashInput: object,
): CallMeta {
  return {
    provider,
    requestedModel,
    model: null,
    promptVersion,
    inputHash: sha256(canonicalJson({ promptVersion, ...hashInput })),
    usage: null,
    latencyMs: 0,
  };
}

type PlanQuestion =
  | {
      kind: 'choice';
      name: string;
      instructions: string;
      choices: Array<{ value: string; description: string }>;
    }
  | { kind: 'yesno'; name: string; instructions: string; yes: string; no: string };

type DecisionAnswer = OpenAI.Decision['answers'][number];

/** Readiness and failure triage via the OpenAI Decisions API (beta): typed choice + predicates (ADR-0006/0009). */
export class OpenAIDecisionsClassifier implements ReadinessClassifier, TriageClassifier {
  readonly model: string;
  constructor(private readonly config: { client: OpenAI; model?: string; providerLabel?: string }) {
    this.model = config.model ?? DEFAULT_DECISIONS_MODEL;
  }

  private get label() {
    return this.config.providerLabel ?? 'openai';
  }

  get readinessCacheId(): string {
    return `${this.label}|${this.model}|${DECISIONS_PROMPT_VERSION}`;
  }

  get triageCacheId(): string {
    return `${this.label}|${this.model}|${TRIAGE_DECISIONS_PROMPT_VERSION}`;
  }

  /** One Decisions call; returns answers by name, or a fail-closed provider failure. */
  private async ask(
    plan: PlanQuestion[],
    payload: unknown,
    promptVersion: string,
  ): Promise<{ ok: true; byName: Map<string | null, DecisionAnswer>; meta: CallMeta } | ProviderFailure> {
    const meta = newMeta(this.label, this.model, promptVersion, { payload, plan });
    const started = performance.now();
    try {
      const decision = await this.config.client.decisions.create({
        model: this.model,
        input: userMessage(payload),
        questions: plan.map((q) =>
          q.kind === 'choice'
            ? { type: 'choice' as const, name: q.name, instructions: q.instructions, choices: q.choices }
            : {
                type: 'predicate' as const,
                name: q.name,
                instructions: `${q.instructions}
Yes: ${q.yes}
No: ${q.no}`,
              },
        ),
      });
      meta.model = decision.model;
      meta.latencyMs = performance.now() - started;
      meta.usage = {
        inputTokens: decision.usage.input_tokens,
        outputTokens: decision.usage.output_tokens,
        cacheReadTokens: decision.usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: decision.usage.input_tokens_details?.cache_write_tokens ?? 0,
      };
      return { ok: true, byName: new Map(decision.answers.map((a) => [a.name, a])), meta };
    } catch (err) {
      meta.latencyMs = performance.now() - started;
      return { ok: false, ...classifyError(err), meta };
    }
  }

  private static choice(a: DecisionAnswer | undefined, name: string) {
    if (!a) return { status: 'missing' as const, detail: `no ${name} answer` };
    if (a.type === 'refusal') return { status: 'refused' as const };
    if (a.type === 'choice') return { status: 'ok' as const, choice: a.choice, confidence: a.confidence };
    return { status: 'invalid' as const, detail: `${name} answer type ${a.type}` };
  }

  async classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>> {
    const res = await this.ask(
      readinessQuestions(input.story.acceptanceCriteria.length, input.sources.length),
      buildPayload(input.story, input.sources),
      DECISIONS_PROMPT_VERSION,
    );
    if (!res.ok) return res;
    return assessmentFromDecisions(
      input,
      {
        readiness: OpenAIDecisionsClassifier.choice(res.byName.get('readiness'), 'readiness'),
        // A refused or missing predicate counts as "no" (conservative).
        yes: (name) => {
          const a = res.byName.get(name);
          return a?.type === 'predicate' ? a.probability : 0;
        },
      },
      res.meta,
    );
  }

  async triage(facts: TriageFacts): Promise<ProviderOutcome<TriageAssessment>> {
    const res = await this.ask(triageQuestions(), buildTriagePayload(facts), TRIAGE_DECISIONS_PROMPT_VERSION);
    if (!res.ok) return res;
    const security = res.byName.get('security');
    return triageFromDecisions(
      {
        cause: OpenAIDecisionsClassifier.choice(res.byName.get('cause'), 'cause'),
        securityProbability: security?.type === 'predicate' ? security.probability : null,
      },
      res.meta,
    );
  }
}

/** Drafts via OpenAI Responses API structured outputs, not stored provider-side. */
export class OpenAIResponsesDrafter implements DraftGenerator {
  readonly model: string;
  constructor(private readonly config: { client: OpenAI; model: string; providerLabel?: string }) {
    this.model = config.model;
  }

  async generate(input: DraftInput): Promise<ProviderOutcome<DraftContent>> {
    const payload = buildPayload(input.story, input.sources);
    const meta = newMeta(this.config.providerLabel ?? 'openai', this.model, DRAFT_PROMPT_VERSION, {
      payload,
    });
    const started = performance.now();
    try {
      const response = await this.config.client.responses.parse({
        model: this.model,
        instructions: DRAFT_SYSTEM,
        input: userMessage(payload),
        text: { format: zodTextFormat(DraftContent, 'test_case_draft') },
        max_output_tokens: 16000,
        // Do not retain requirement text in the provider's response store.
        store: false,
      });
      meta.model = response.model;
      meta.latencyMs = performance.now() - started;
      if (response.usage) {
        meta.usage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: response.usage.input_tokens_details?.cache_write_tokens ?? 0,
        };
      }

      if (response.status === 'incomplete') {
        const reason = response.incomplete_details?.reason ?? 'unknown';
        return reason === 'content_filter'
          ? { ok: false, failure: 'REFUSED', detail: 'content_filter', meta }
          : {
              ok: false,
              failure: 'MALFORMED',
              detail: reason === 'max_output_tokens' ? 'max_tokens' : reason,
              meta,
            };
      }
      const refusal = response.output
        .flatMap((o) => (o.type === 'message' ? o.content : []))
        .find((c) => c.type === 'refusal');
      if (refusal) return { ok: false, failure: 'REFUSED', detail: 'refusal', meta };
      if (response.output_parsed == null) {
        return { ok: false, failure: 'MALFORMED', detail: 'no_structured_output', meta };
      }
      return checkDraft(input, { ok: true, value: response.output_parsed, meta });
    } catch (err) {
      meta.latencyMs = performance.now() - started;
      return { ok: false, ...classifyError(err), meta };
    }
  }
}
