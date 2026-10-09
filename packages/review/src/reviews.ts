import {
  getReview,
  insertApproval,
  insertAuditEvent,
  insertReview,
  listReviews,
  triageByReview,
  updateReviewStatus,
  verifyTriage,
  type ApprovalRow,
  type Db,
  type ReviewInsert,
  type ReviewRow,
} from '@qa/db';
import type { Role } from '@qa/domain';
import {
  type Actor,
  DomainError,
  hasRole,
  type ReviewStatus,
  type TenantScope,
  transitionReview,
} from '@qa/domain';
import { ingestSource, SOURCE_APPROVER_ROLES, type IngestResult } from '@qa/retrieval';

export const REVIEW_KINDS = [
  'REQUIREMENT_CLARIFICATION',
  'SOURCE_CONFLICT',
  'MISSING_KNOWLEDGE',
  'PROVIDER_FAILURE',
  'ACTION_APPROVAL',
  'FAILURE_TRIAGE',
  'SECURITY_TRIAGE',
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** Default routing (docs/06 "What requires review?"). */
const ROUTING: Record<ReviewKind, { role: Role; risk: ReviewRow['risk'] }> = {
  REQUIREMENT_CLARIFICATION: { role: 'PRODUCT_OWNER', risk: 'MEDIUM' },
  SOURCE_CONFLICT: { role: 'PRODUCT_OWNER', risk: 'HIGH' },
  MISSING_KNOWLEDGE: { role: 'QA_ENGINEER', risk: 'MEDIUM' },
  PROVIDER_FAILURE: { role: 'QA_ENGINEER', risk: 'MEDIUM' },
  ACTION_APPROVAL: { role: 'QA_LEAD', risk: 'HIGH' },
  FAILURE_TRIAGE: { role: 'QA_ENGINEER', risk: 'MEDIUM' },
  // Security/privacy-sensitive suspected defects: secure review by a lead (docs/06).
  SECURITY_TRIAGE: { role: 'QA_LEAD', risk: 'HIGH' },
};

const TRIAGE_KINDS: ReviewKind[] = ['FAILURE_TRIAGE', 'SECURITY_TRIAGE'];
export const CONFIRMABLE_CAUSES = ['PRODUCT_DEFECT', 'TEST_ISSUE', 'ENVIRONMENT', 'UNKNOWN'] as const;
export type ConfirmedCause = (typeof CONFIRMABLE_CAUSES)[number];

const KNOWLEDGE_KINDS: ReviewKind[] = ['REQUIREMENT_CLARIFICATION', 'SOURCE_CONFLICT', 'MISSING_KNOWLEDGE'];
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type OpenReviewInput = Omit<ReviewInsert, 'assignedRole' | 'risk' | 'kind'> & {
  kind: ReviewKind;
  risk?: ReviewRow['risk'];
};

export async function openReview(
  db: Db,
  scope: TenantScope,
  actorId: string,
  input: OpenReviewInput,
  correlationId: string | null = null,
): Promise<ReviewRow> {
  const routing = ROUTING[input.kind];
  const review = await insertReview(db, scope, {
    ...input,
    risk: input.risk ?? routing.risk,
    assignedRole: routing.role,
  });
  await insertAuditEvent(db, scope, {
    actorId,
    workflowId: input.workflowId,
    correlationId,
    actionKind: 'OPEN_REVIEW',
    actionHash: input.proposedActionHash,
    target: review.id,
    policyVersion: input.policyVersion,
    decisionRecordId: null,
    approvalId: null,
    outcome: input.kind,
  });
  return review;
}

function assertHuman(actor: Actor) {
  if (hasRole(actor, 'AI_AGENT')) throw new DomainError('FORBIDDEN', 'the AI agent cannot act on reviews');
}

export async function listQueue(
  db: Db,
  actor: Actor,
  f: { status?: ReviewStatus; mine?: boolean; limit?: number; offset?: number } = {},
): Promise<ReviewRow[]> {
  assertHuman(actor);
  return listReviews(db, actor, {
    status: f.status,
    assignedRoles: f.mine ? actor.roles : undefined,
    limit: Math.min(f.limit ?? 50, 200),
    offset: f.offset ?? 0,
  });
}

export type ResolveInput =
  | { action: 'ASSIGN' }
  | { action: 'REQUEST_INFO'; reason: string }
  | { action: 'ESCALATE'; reason: string; toRole: Role }
  | { action: 'REJECT'; reason: string }
  | { action: 'CANCEL'; reason: string }
  | {
      action: 'APPROVE';
      reason: string;
      /** Knowledge reviews: the authoritative answer, published as a new immutable source version. */
      publishSource?: { sourceId: string; version: string; content: string; ruleKeys?: string[] };
      /** Action approvals: lifetime of the grant (default 1h, max 24h). */
      approvalTtlMs?: number;
      /** Triage reviews: the human-verified cause (may differ from the suggestion). */
      confirmedCause?: ConfirmedCause;
    };

export type ResolveResult = {
  review: ReviewRow;
  approval: ApprovalRow | null;
  publishedSource: IngestResult | null;
};

const NEXT_STATUS: Record<ResolveInput['action'], ReviewStatus> = {
  ASSIGN: 'ASSIGNED',
  REQUEST_INFO: 'NEEDS_INFO',
  ESCALATE: 'ASSIGNED',
  REJECT: 'REJECTED',
  CANCEL: 'CANCELLED',
  APPROVE: 'APPROVED',
};

/**
 * Applies a reviewer decision. Authorization comes from the actor's database roles: the
 * assigned role, or a QA lead/admin. The AI agent can never resolve reviews.
 */
export async function resolveReview(
  db: Db,
  actor: Actor,
  reviewId: string,
  input: ResolveInput,
  now: Date = new Date(),
): Promise<ResolveResult> {
  assertHuman(actor);
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const review = await getReview(db, scope, reviewId);
  if (!review) throw new DomainError('NOT_FOUND', `review ${reviewId} not found`);

  const mayAct = actor.roles.includes(review.assignedRole as Role) || hasRole(actor, 'QA_LEAD', 'ADMIN');
  if (!mayAct) throw new DomainError('FORBIDDEN', `review requires role ${review.assignedRole}`);
  if (review.expiresAt && review.expiresAt.getTime() <= now.getTime() && input.action === 'APPROVE') {
    throw new DomainError('CONFLICT', 'review has expired and cannot be approved');
  }
  if (input.action === 'ESCALATE' && input.toRole === 'AI_AGENT') {
    throw new DomainError('VALIDATION', 'cannot escalate to the AI agent');
  }

  const next = transitionReview(review.status as ReviewStatus, NEXT_STATUS[input.action]);

  return db.transaction(async (tx) => {
    let approval: ApprovalRow | null = null;
    let publishedSource: IngestResult | null = null;

    if (input.action === 'APPROVE' && review.kind === 'ACTION_APPROVAL') {
      if (!hasRole(actor, 'QA_LEAD', 'ADMIN'))
        throw new DomainError('FORBIDDEN', 'action approvals need QA lead/admin');
      if (!review.proposedActionHash || !review.targetEnvironment) {
        throw new DomainError('VALIDATION', 'action review has no action hash or environment');
      }
      const ttl = Math.min(input.approvalTtlMs ?? 60 * 60 * 1000, MAX_APPROVAL_TTL_MS);
      approval = await insertApproval(tx, scope, {
        reviewId: review.id,
        actionHash: review.proposedActionHash,
        environmentId: review.targetEnvironment,
        approvedBy: actor.id,
        expiresAt: new Date(now.getTime() + ttl),
      });
    }

    if (TRIAGE_KINDS.includes(review.kind as ReviewKind) && input.action === 'APPROVE') {
      if (!input.confirmedCause)
        throw new DomainError('VALIDATION', 'triage approval requires confirmedCause');
      const triage = await triageByReview(tx, scope, review.id);
      if (!triage) throw new DomainError('NOT_FOUND', `no triage linked to review ${review.id}`);
      await verifyTriage(tx, scope, triage.id, input.confirmedCause, actor.id);
    }

    if (input.action === 'APPROVE' && input.publishSource) {
      if (!KNOWLEDGE_KINDS.includes(review.kind as ReviewKind)) {
        throw new DomainError('VALIDATION', `${review.kind} reviews cannot publish knowledge`);
      }
      // Only source-owner roles create trusted knowledge; anyone else's answer is kept as untrusted T4.
      const trusted = hasRole(actor, ...SOURCE_APPROVER_ROLES);
      publishedSource = await ingestSource(tx, actor, {
        meta: {
          sourceId: input.publishSource.sourceId,
          version: input.publishSource.version,
          sourceType: 'CLARIFICATION',
          trustTier: trusted ? 'T1' : 'T4',
          approvalStatus: trusted ? 'APPROVED' : 'UNAPPROVED',
          approvedBy: trusted ? actor.id : null,
          owner: actor.id,
          ruleKeys: input.publishSource.ruleKeys ?? [],
          // The answer refines the sources the question was raised against.
          refines: review.sourceRefs,
          effectiveFrom: now,
        },
        body: input.publishSource.content,
      });
    }

    const updated = await updateReviewStatus(tx, scope, review.id, review.status, {
      status: next,
      assignedRole: input.action === 'ESCALATE' ? input.toRole : undefined,
      assigneeId: input.action === 'ASSIGN' ? actor.id : undefined,
      resolution: {
        action: input.action,
        reason: 'reason' in input ? input.reason : null,
        approvalId: approval?.id ?? null,
        publishedSource: publishedSource ? `${publishedSource.sourceId}@${publishedSource.version}` : null,
        publishedTrusted: publishedSource?.trusted ?? null,
        confirmedCause: 'confirmedCause' in input ? (input.confirmedCause ?? null) : null,
      },
      resolvedBy: ['APPROVED', 'REJECTED', 'CANCELLED'].includes(next) ? actor.id : undefined,
    });

    await insertAuditEvent(tx, scope, {
      actorId: actor.id,
      workflowId: review.workflowId,
      correlationId: null,
      actionKind: `REVIEW_${input.action}`,
      actionHash: review.proposedActionHash,
      target: review.id,
      policyVersion: review.policyVersion,
      decisionRecordId: null,
      approvalId: approval?.id ?? null,
      outcome: next,
    });

    return { review: updated, approval, publishedSource };
  });
}
