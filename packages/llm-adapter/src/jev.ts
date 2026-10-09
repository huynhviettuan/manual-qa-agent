import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  choice,
  type Fetch,
  InternalServerError,
  noul,
  type Questions,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
} from '@typesafe-ai/sdk';
import { z } from 'zod';
import { canonicalJson, sha256 } from '@qa/domain';
import {
  assessmentFromDecisions,
  DECISIONS_PROMPT_VERSION,
  readinessQuestions,
} from './decision-readiness.ts';
import { buildPayload, userMessage } from './prompts.ts';
import type {
  CallMeta,
  FailureKind,
  ProviderOutcome,
  ReadinessAssessment,
  ReadinessClassifier,
  ReadinessInput,
} from './types.ts';

/**
 * Pinned rather than `jev-latest`: TypeSafe advises explicit versions once confidence
 * thresholds are calibrated (docs.typesafe.ai/models, 2026-10-09).
 */
export const DEFAULT_JEV_MODEL = 'jev-1.13.0';

export function createJevClient(opts: { apiKey?: string; fetch?: Fetch; timeoutMs?: number } = {}) {
  return new TypeSafeClient({
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    // The SDK logs request bodies (requirement text) at `debug`; pin a level so the
    // TYPESAFE_LOG_LEVEL env var cannot turn that on.
    logLevel: 'warn',
    retry: { maxRetries: 2 },
    timeout: opts.timeoutMs ?? 30_000,
  });
}

// Runtime validation of external answers (the SDK's types are compile-time only).
const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
});
const NoulAnswer = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });

/** Fail-closed mapping of SDK errors, most specific first. */
function classifyError(err: unknown): { failure: FailureKind; detail: string } {
  if (err instanceof RateLimitError) return { failure: 'UNAVAILABLE', detail: 'rate_limited' };
  if (err instanceof InternalServerError)
    return { failure: 'UNAVAILABLE', detail: `server_error_${err.status}` };
  if (err instanceof APIError) return { failure: 'UNAVAILABLE', detail: `api_error_${err.status}` };
  if (err instanceof APITimeoutError) return { failure: 'UNAVAILABLE', detail: 'timeout' };
  if (err instanceof APIConnectionError) return { failure: 'UNAVAILABLE', detail: 'connection_error' };
  if (err instanceof APIUserAbortError) return { failure: 'UNAVAILABLE', detail: 'aborted' };
  if (err instanceof TypeSafeError) return { failure: 'MALFORMED', detail: err.message.slice(0, 300) };
  return {
    failure: 'UNAVAILABLE',
    detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown_error',
  };
}

/** Readiness via TypeSafe Jev `systemOne` (choice + noul questions), readiness only (ADR-0007). */
export class JevClassifier implements ReadinessClassifier {
  readonly model: string;
  constructor(private readonly config: { client: TypeSafeClient; model?: string; providerLabel?: string }) {
    this.model = config.model ?? DEFAULT_JEV_MODEL;
  }

  async classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>> {
    const payload = buildPayload(input.story, input.sources);
    const plan = readinessQuestions(input.story.acceptanceCriteria.length, input.sources.length);
    const meta: CallMeta = {
      provider: this.config.providerLabel ?? 'jev',
      requestedModel: this.model,
      model: null,
      promptVersion: DECISIONS_PROMPT_VERSION,
      inputHash: sha256(canonicalJson({ promptVersion: DECISIONS_PROMPT_VERSION, payload, plan })),
      usage: null,
      latencyMs: 0,
    };
    const questions: Questions = Object.fromEntries(
      plan.map((q) => [
        q.name,
        q.kind === 'choice'
          ? choice(q.instructions, Object.fromEntries(q.choices.map((c) => [c.value, c.description])))
          : noul(q.instructions, { true: q.yes, false: q.no }),
      ]),
    );
    const started = performance.now();
    try {
      // Same delimited, redacted evidence string as the other decision provider.
      const result = await this.config.client.systemOne({
        state: userMessage(payload),
        questions,
        model: this.model,
      });
      meta.model = result.model;
      meta.latencyMs = performance.now() - started;
      meta.usage = {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };

      const answers = result.answers as Record<string, unknown>;
      const readiness = ChoiceAnswer.safeParse(answers.readiness);
      return assessmentFromDecisions(
        input,
        {
          readiness: readiness.success
            ? { status: 'ok', choice: readiness.data.choice, confidence: readiness.data.confidence }
            : answers.readiness === undefined
              ? { status: 'missing', detail: 'no readiness answer' }
              : { status: 'invalid', detail: 'readiness answer failed validation' },
          // Missing or invalid noul answers count as "no" (conservative).
          yes: (name) => {
            const a = NoulAnswer.safeParse(answers[name]);
            return a.success ? a.data.noul : 0;
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
