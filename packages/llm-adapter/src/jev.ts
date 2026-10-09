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
import { TRIAGE_DECISIONS_PROMPT_VERSION, triageFromDecisions, triageQuestions } from './decision-triage.ts';
import { buildPayload, buildTriagePayload, userMessage } from './prompts.ts';
import type {
  CallMeta,
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

type PlanQuestion =
  | {
      kind: 'choice';
      name: string;
      instructions: string;
      choices: Array<{ value: string; description: string }>;
    }
  | { kind: 'yesno'; name: string; instructions: string; yes: string; no: string };

/** Readiness and failure triage via TypeSafe Jev `systemOne` (choice + noul questions; ADR-0007/0009). */
export class JevClassifier implements ReadinessClassifier, TriageClassifier {
  readonly model: string;
  constructor(private readonly config: { client: TypeSafeClient; model?: string; providerLabel?: string }) {
    this.model = config.model ?? DEFAULT_JEV_MODEL;
  }

  private get label() {
    return this.config.providerLabel ?? 'jev';
  }

  get readinessCacheId(): string {
    return `${this.label}|${this.model}|${DECISIONS_PROMPT_VERSION}`;
  }

  get triageCacheId(): string {
    return `${this.label}|${this.model}|${TRIAGE_DECISIONS_PROMPT_VERSION}`;
  }

  /** One systemOne call; returns raw answers by name, or a fail-closed provider failure. */
  private async ask(
    plan: PlanQuestion[],
    payload: unknown,
    promptVersion: string,
  ): Promise<{ ok: true; answers: Record<string, unknown>; meta: CallMeta } | ProviderFailure> {
    const meta: CallMeta = {
      provider: this.label,
      requestedModel: this.model,
      model: null,
      promptVersion,
      inputHash: sha256(canonicalJson({ promptVersion, payload, plan })),
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
      return { ok: true, answers: result.answers as Record<string, unknown>, meta };
    } catch (err) {
      meta.latencyMs = performance.now() - started;
      return { ok: false, ...classifyError(err), meta };
    }
  }

  private static choice(raw: unknown, name: string) {
    const parsed = ChoiceAnswer.safeParse(raw);
    if (parsed.success)
      return { status: 'ok' as const, choice: parsed.data.choice, confidence: parsed.data.confidence };
    return raw === undefined
      ? { status: 'missing' as const, detail: `no ${name} answer` }
      : { status: 'invalid' as const, detail: `${name} answer failed validation` };
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
        readiness: JevClassifier.choice(res.answers.readiness, 'readiness'),
        // Missing or invalid noul answers count as "no" (conservative).
        yes: (name) => {
          const a = NoulAnswer.safeParse(res.answers[name]);
          return a.success ? a.data.noul : 0;
        },
      },
      res.meta,
    );
  }

  async triage(facts: TriageFacts): Promise<ProviderOutcome<TriageAssessment>> {
    const res = await this.ask(triageQuestions(), buildTriagePayload(facts), TRIAGE_DECISIONS_PROMPT_VERSION);
    if (!res.ok) return res;
    const security = NoulAnswer.safeParse(res.answers.security);
    return triageFromDecisions(
      {
        cause: JevClassifier.choice(res.answers.cause, 'cause'),
        // Missing/invalid -> null -> escalates (fail safe).
        securityProbability: security.success ? security.data.noul : null,
      },
      res.meta,
    );
  }
}
