import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { canonicalJson, type DraftSet, DraftSetOutput, sha256 } from '@qa/domain';
import { ReadinessSchema } from './claude.ts';
import { checkDraftSet, checkReadiness } from './grounding.ts';
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
} from './types.ts';

/**
 * ADR-0020: drafts and readiness answered by Claude in an interactive Claude Code session, through
 * files. For each call the provider looks for `<hash>.answer.json` in the exchange directory; if it
 * is missing it writes `<hash>.request.json` (the exact system prompt and user message a model
 * would receive) and fails as UNAVAILABLE, so the workflow routes to review and nothing is guessed.
 * A person in the session reads the requests and writes the answers; a rerun replays them. Every
 * answer goes through the same schema and grounding checks as any provider. Nothing here calls a
 * network or a model, and nothing runs unattended on a subscription.
 */
export type SessionExchangeConfig = {
  dir: string;
  /** Recorded as the answering model; say what actually answered. */
  modelLabel: string;
};

export const SESSION_PROVIDER = 'claude-code-session';

export class SessionExchangeProvider implements ReadinessClassifier, DraftGenerator {
  constructor(private readonly config: SessionExchangeConfig) {}

  private async exchange<T>(
    kind: 'readiness' | 'draft',
    promptVersion: string,
    system: string,
    payload: unknown,
    schema: z.ZodType<T>,
  ): Promise<ProviderOutcome<T>> {
    const inputHash = sha256(canonicalJson({ promptVersion, payload }));
    const meta: CallMeta = {
      provider: SESSION_PROVIDER,
      requestedModel: this.config.modelLabel,
      model: null,
      promptVersion,
      inputHash,
      usage: null,
      latencyMs: 0,
    };
    const base = join(this.config.dir, `${kind}-${inputHash.slice(0, 16)}`);
    if (!existsSync(`${base}.answer.json`)) {
      await mkdir(this.config.dir, { recursive: true });
      await writeFile(
        `${base}.request.json`,
        JSON.stringify({ kind, promptVersion, inputHash, system, user: userMessage(payload) }, null, 2),
      );
      return { ok: false, failure: 'UNAVAILABLE', detail: 'awaiting an answer from the session', meta };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(`${base}.answer.json`, 'utf8'));
    } catch {
      return { ok: false, failure: 'MALFORMED', detail: 'answer file is not JSON', meta };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        failure: 'MALFORMED',
        detail: parsed.error.issues.map((i) => i.message).join('; '),
        meta,
      };
    }
    meta.model = this.config.modelLabel;
    return { ok: true, value: parsed.data, meta };
  }

  async classify(input: ReadinessInput): Promise<ProviderOutcome<ReadinessAssessment>> {
    const out = await this.exchange(
      'readiness',
      READINESS_PROMPT_VERSION,
      READINESS_SYSTEM,
      buildPayload(input.story, input.sources),
      ReadinessSchema,
    );
    if (!out.ok) return out;
    return checkReadiness(input, { ...out, value: { ...out.value, confidence: null } });
  }

  async generate(input: DraftInput): Promise<ProviderOutcome<DraftSet>> {
    const out = await this.exchange(
      'draft',
      DRAFT_PROMPT_VERSION,
      DRAFT_SYSTEM,
      buildPayload(input.story, input.sources),
      DraftSetOutput,
    );
    return checkDraftSet(input, out);
  }
}
