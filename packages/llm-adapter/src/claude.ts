import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { canonicalJson, DraftContent, Readiness, sha256 } from '@qa/domain';
import { checkDraft, checkReadiness } from './grounding.ts';
import {
  buildPayload,
  DRAFT_PROMPT_VERSION,
  DRAFT_SYSTEM,
  READINESS_PROMPT_VERSION,
  READINESS_SYSTEM,
  userMessage,
} from './prompts.ts';
import type {
  CallMeta,
  DraftGenerator,
  DraftInput,
  ProviderOutcome,
  ReadinessAssessment,
  ReadinessClassifier,
  ReadinessInput,
  Usage,
} from './types.ts';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ClaudeConfig = {
  client: Anthropic;
  model?: string;
  effort?: Effort;
  /** Server-side refusal fallback (on by default); the answering model is recorded per call. */
  refusalFallback?: boolean;
  /** Recorded as DecisionRecord.provider (e.g. `anthropic-mock` for the keyless heuristic). */
  providerLabel?: string;
};

const ReadinessSchema = z.object({
  readiness: Readiness,
  missingExpectations: z.array(z.string()),
  clarificationQuestion: z.string().nullable(),
  citedSourceIds: z.array(z.string()),
});

/** Client with bounded retries (429/5xx/connection) and an explicit timeout. */
export function createAnthropicClient(
  opts: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  return new Anthropic({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    maxRetries: 2,
    timeout: opts.timeoutMs ?? 120_000,
  });
}

function toUsage(u: Anthropic.Beta.BetaUsage | undefined): Usage | null {
  if (!u) return null;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** After a refusal fallback the last `fallback` block names the model that produced the answer. */
function answeringModel(message: Anthropic.Beta.BetaMessage): string {
  let model = message.model;
  for (const block of message.content) {
    if (block.type === 'fallback') model = block.to.model;
  }
  return model;
}

/** Fail-closed mapping of SDK errors, most specific first. */
function classifyError(err: unknown): { failure: 'MALFORMED' | 'UNAVAILABLE'; detail: string } {
  if (err instanceof Anthropic.RateLimitError) return { failure: 'UNAVAILABLE', detail: 'rate_limited' };
  if (err instanceof Anthropic.InternalServerError)
    return { failure: 'UNAVAILABLE', detail: `server_error_${err.status}` };
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return { failure: 'UNAVAILABLE', detail: 'timeout' };
  if (err instanceof Anthropic.APIConnectionError)
    return { failure: 'UNAVAILABLE', detail: 'connection_error' };
  if (err instanceof Anthropic.APIError)
    return { failure: 'UNAVAILABLE', detail: `api_error_${err.status ?? 'unknown'}` };
  // Non-HTTP SDK errors here are structured-output parse failures.
  if (err instanceof Anthropic.AnthropicError)
    return { failure: 'MALFORMED', detail: err.message.slice(0, 300) };
  return {
    failure: 'UNAVAILABLE',
    detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown_error',
  };
}

export class ClaudeProvider implements ReadinessClassifier, DraftGenerator {
  readonly model: string;
  private readonly effort: Effort;
  private readonly fallback: boolean;

  constructor(private readonly config: ClaudeConfig) {
    this.model = config.model ?? DEFAULT_CLAUDE_MODEL;
    this.effort = config.effort ?? 'medium';
    this.fallback = config.refusalFallback ?? true;
  }

  private async call<T>(
    promptVersion: string,
    system: string,
    payload: unknown,
    schema: z.ZodType<T>,
    maxTokens: number,
  ): Promise<ProviderOutcome<T>> {
    const started = performance.now();
    const meta: CallMeta = {
      provider: this.config.providerLabel ?? 'anthropic',
      requestedModel: this.model,
      model: null,
      promptVersion,
      inputHash: sha256(canonicalJson({ promptVersion, payload })),
      usage: null,
      latencyMs: 0,
    };
    try {
      const response = await this.config.client.beta.messages.parse({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage(payload) }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
        ...(this.fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      });
      meta.model = answeringModel(response);
      meta.usage = toUsage(response.usage);
      meta.latencyMs = performance.now() - started;

      if (response.stop_reason === 'refusal') {
        const category = response.stop_details?.category ?? 'unspecified';
        return { ok: false, failure: 'REFUSED', detail: `refusal:${category}`, meta };
      }
      if (response.stop_reason === 'max_tokens') {
        return { ok: false, failure: 'MALFORMED', detail: 'max_tokens', meta };
      }
      if (response.parsed_output == null) {
        return { ok: false, failure: 'MALFORMED', detail: 'no_structured_output', meta };
      }
      return { ok: true, value: response.parsed_output as T, meta };
    } catch (err) {
      meta.latencyMs = performance.now() - started;
      return { ok: false, ...classifyError(err), meta };
    }
  }

  async classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>> {
    const out = await this.call(
      READINESS_PROMPT_VERSION,
      READINESS_SYSTEM,
      buildPayload(input.story, input.sources),
      ReadinessSchema,
      8000,
    );
    // Claude returns no calibrated per-answer confidence (ADR-0004).
    return checkReadiness(input, out.ok ? { ...out, value: { ...out.value, confidence: null } } : out);
  }

  async generate(input: DraftInput): Promise<ProviderOutcome<DraftContent>> {
    const out = await this.call(
      DRAFT_PROMPT_VERSION,
      DRAFT_SYSTEM,
      buildPayload(input.story, input.sources),
      DraftContent,
      16000,
    );
    return checkDraft(input, out);
  }
}
