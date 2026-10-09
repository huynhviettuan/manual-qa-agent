import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { ApprovalStatus, DomainError, SourceType, TrustTier } from '@qa/domain';

/** Metadata every knowledge source file must declare (docs/04 "Metadata required on every chunk"). */
export const SourceMeta = z.object({
  sourceId: z.string().regex(/^[A-Za-z0-9._-]+$/),
  version: z.string().regex(/^[A-Za-z0-9._-]+$/),
  sourceType: SourceType,
  trustTier: TrustTier,
  approvalStatus: ApprovalStatus,
  approvedBy: z.string().nullish(),
  owner: z.string().min(1),
  productArea: z.string().nullish(),
  releaseVersion: z.string().nullish(),
  /** Stable business-rule keys (e.g. `login.lockout.threshold`) used for contradiction detection. */
  ruleKeys: z.array(z.string()).default([]),
  /** Source versions (`sourceId@version`) this source refines rather than contradicts. */
  refines: z.array(z.string()).optional(),
  effectiveFrom: z.coerce.date(),
});
export type SourceMeta = z.infer<typeof SourceMeta>;

export type SourceDocument = { meta: SourceMeta; body: string };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parses Markdown with YAML front-matter, or JSON `{ ...meta, content }`. */
export function parseSourceFile(fileName: string, raw: string): SourceDocument {
  let metaInput: unknown;
  let body: string;
  if (fileName.endsWith('.json')) {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const { content, ...rest } = obj;
    if (typeof content !== 'string')
      throw new DomainError('VALIDATION', `${fileName}: "content" must be a string`);
    metaInput = rest;
    body = content;
  } else {
    const m = FRONT_MATTER.exec(raw);
    if (!m) throw new DomainError('VALIDATION', `${fileName}: missing YAML front-matter`);
    metaInput = parseYaml(m[1]!);
    body = m[2]!;
  }
  const parsed = SourceMeta.safeParse(metaInput);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', `${fileName}: invalid metadata: ${z.prettifyError(parsed.error)}`);
  }
  if (!body.trim()) throw new DomainError('VALIDATION', `${fileName}: empty content`);
  return { meta: parsed.data, body };
}
