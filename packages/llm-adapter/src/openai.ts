import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { canonicalJson, DraftContent, sha256 } from '@qa/domain';
import {
  assessmentFromDecisions,
  DECISIONS_PROMPT_VERSION,
  readinessQuestions,
} from './decision-readiness.ts';
import { checkDraft } from './grounding.ts';
import { buildPayload, DRAFT_PROMPT_VERSION, DRAFT_SYSTEM, userMessage } from './prompts.ts';
import type {
  CallMeta,
  DraftGenerator,
  DraftInput,
  FailureKind,
  ProviderOutcome,
  ReadinessAssessment,
  ReadinessClassifier,
  ReadinessInput,
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

/** Readiness via the OpenAI Decisions API (beta): typed choice + yes/no predicates (ADR-0006). */
export class OpenAIDecisionsClassifier implements ReadinessClassifier {
  readonly model: string;
  constructor(private readonly config: { client: OpenAI; model?: string; providerLabel?: string }) {
    this.model = config.model ?? DEFAULT_DECISIONS_MODEL;
  }

  async classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>> {
    const payload = buildPayload(input.story, input.sources);
    const questions = readinessQuestions(input.story.acceptanceCriteria.length, input.sources.length);
    const meta = newMeta(this.config.providerLabel ?? 'openai', this.model, DECISIONS_PROMPT_VERSION, {
      payload,
      questions,
    });
    const started = performance.now();
    try {
      const decision = await this.config.client.decisions.create({
        model: this.model,
        input: userMessage(payload),
        questions: questions.map((q) =>
          q.kind === 'choice'
            ? { type: 'choice' as const, name: q.name, instructions: q.instructions, choices: q.choices }
            : {
                type: 'predicate' as const,
                name: q.name,
                instructions: `${q.instructions}\nYes: ${q.yes}\nNo: ${q.no}`,
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

      const byName = new Map(decision.answers.map((a) => [a.name, a]));
      const r = byName.get('readiness');
      return assessmentFromDecisions(
        input,
        {
          readiness: !r
            ? { status: 'missing', detail: 'no readiness answer' }
            : r.type === 'refusal'
              ? { status: 'refused' }
              : r.type === 'choice'
                ? { status: 'ok', choice: r.choice, confidence: r.confidence }
                : { status: 'invalid', detail: `readiness answer type ${r.type}` },
          // A refused or missing predicate counts as "no" (conservative).
          yes: (name) => {
            const a = byName.get(name);
            return a?.type === 'predicate' ? a.probability : 0;
          },
        },
        meta,
      );
    } catch (err) {
      meta.latencyMs = performance.now() - started;
      return { ok: false, ...classifyError(err), meta };
    }
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
