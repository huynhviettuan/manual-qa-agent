import {
  findSourceVersion,
  insertAuditEvent,
  insertSourceWithChunks,
  revokeSourceVersion,
  type Db,
} from '@qa/db';
import { type Actor, DomainError, hasRole, redactSecrets, sha256 } from '@qa/domain';
import { chunkMarkdown } from './chunker.ts';
import type { SourceDocument } from './source-file.ts';

export type IngestResult = {
  sourceId: string;
  version: string;
  status: 'INGESTED' | 'UNCHANGED';
  trusted: boolean;
  chunks: number;
  redactions: number;
};

/** Roles allowed to register approved (trusted) knowledge. The AI agent is never one of them. */
export const SOURCE_APPROVER_ROLES = ['PRODUCT_OWNER', 'QA_LEAD', 'ADMIN'] as const;

/**
 * Registers an immutable source version. Unapproved content, or content submitted by an actor
 * without approver authority, is stored as untrusted T4 and never returned by trusted retrieval.
 */
export async function ingestSource(db: Db, actor: Actor, doc: SourceDocument): Promise<IngestResult> {
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const { meta } = doc;

  const wantsTrust = meta.approvalStatus === 'APPROVED';
  if (wantsTrust && !meta.approvedBy) {
    throw new DomainError(
      'VALIDATION',
      `${meta.sourceId}@${meta.version}: approvedBy is required when APPROVED`,
    );
  }
  if (wantsTrust && !hasRole(actor, ...SOURCE_APPROVER_ROLES)) {
    throw new DomainError('FORBIDDEN', `actor ${actor.id} may not ingest approved sources`);
  }

  const { text: content, redactions } = redactSecrets(doc.body);
  const contentHash = sha256(content);

  const existing = await findSourceVersion(db, scope, meta.sourceId, meta.version);
  if (existing) {
    if (existing.contentHash !== contentHash) {
      throw new DomainError(
        'IMMUTABLE',
        `${meta.sourceId}@${meta.version} already exists with different content; publish a new version`,
      );
    }
    return {
      sourceId: meta.sourceId,
      version: meta.version,
      status: 'UNCHANGED',
      trusted: wantsTrust,
      chunks: 0,
      redactions,
    };
  }

  const chunks = chunkMarkdown(content);
  await insertSourceWithChunks(
    db,
    scope,
    {
      sourceId: meta.sourceId,
      version: meta.version,
      sourceType: meta.sourceType,
      trustTier: wantsTrust ? meta.trustTier : 'T4',
      approvalStatus: meta.approvalStatus,
      approvedBy: meta.approvedBy ?? null,
      owner: meta.owner,
      productArea: meta.productArea ?? null,
      releaseVersion: meta.releaseVersion ?? null,
      ruleKeys: meta.ruleKeys,
      refines: meta.refines ?? [],
      effectiveFrom: meta.effectiveFrom,
      contentHash,
      content,
      createdBy: actor.id,
    },
    chunks,
  );
  await insertAuditEvent(db, scope, {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind: 'INGEST_SOURCE',
    actionHash: contentHash,
    target: `${meta.sourceId}@${meta.version}`,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome: wantsTrust ? 'TRUSTED' : 'UNTRUSTED',
  });
  return {
    sourceId: meta.sourceId,
    version: meta.version,
    status: 'INGESTED',
    trusted: wantsTrust,
    chunks: chunks.length,
    redactions,
  };
}

/** Revokes a source version; retrieval excludes it immediately (no cache exists to invalidate in the MVP). */
export async function revokeSource(
  db: Db,
  actor: Actor,
  sourceId: string,
  version: string,
): Promise<boolean> {
  if (!hasRole(actor, ...SOURCE_APPROVER_ROLES)) {
    throw new DomainError('FORBIDDEN', `actor ${actor.id} may not revoke sources`);
  }
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const revoked = await revokeSourceVersion(db, scope, sourceId, version);
  await insertAuditEvent(db, scope, {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind: 'REVOKE_SOURCE',
    actionHash: null,
    target: `${sourceId}@${version}`,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome: revoked ? 'REVOKED' : 'NOT_FOUND',
  });
  return revoked;
}
