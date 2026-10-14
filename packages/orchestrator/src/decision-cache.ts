import { getCachedDecision, putCachedDecision, type Db } from '@qa/db';
import { canonicalJson, sha256, type TenantScope } from '@qa/domain';
import type { ProviderOutcome } from '@qa/llm-adapter';

/**
 * Decision cache (QA-021). Scoped by tenant/project; keyed by the provider's identity
 * (provider, model, prompt version) and the exact input, so new knowledge, a different model or
 * a new prompt never reuse an old answer. Only successful, already-checked outcomes are cached;
 * failures always go back to the provider (or to a human).
 */
export async function cachedDecision<T>(
  db: Db,
  scope: TenantScope,
  kind: 'readiness' | 'triage',
  cacheId: string | undefined,
  input: unknown,
  ttlMs: number | null | undefined,
  call: () => Promise<ProviderOutcome<T>>,
): Promise<{ out: ProviderOutcome<T>; cacheHit: boolean }> {
  if (!cacheId || !ttlMs || ttlMs <= 0) return { out: await call(), cacheHit: false };
  const key = sha256(canonicalJson({ cacheId, input }));
  const hit = await getCachedDecision(db, scope, kind, key);
  if (hit) {
    return {
      cacheHit: true,
      out: {
        ok: true,
        value: hit.result as T,
        meta: {
          provider: hit.provider,
          requestedModel: hit.model ?? '',
          model: hit.model,
          promptVersion: hit.promptVersion,
          inputHash: key,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          latencyMs: 0,
        },
      },
    };
  }
  const out = await call();
  if (out.ok) {
    await putCachedDecision(db, scope, {
      kind,
      cacheKey: key,
      result: out.value,
      provider: out.meta.provider,
      model: out.meta.model,
      promptVersion: out.meta.promptVersion,
      ttlMs,
    });
  }
  return { out, cacheHit: false };
}

/** `QA_DECISION_CACHE_TTL_HOURS` (default 24; 0 disables). */
export function decisionCacheTtlFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env.QA_DECISION_CACHE_TTL_HOURS ?? 24);
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
}
