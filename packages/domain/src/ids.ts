import { randomUUID, createHash } from 'node:crypto';

/** Prefixed random identifier, e.g. `review_3f2a...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

/** Stable SHA-256 hex digest; used for content hashes, input hashes and action hashes. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Deterministic JSON (sorted keys) so equal objects hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
