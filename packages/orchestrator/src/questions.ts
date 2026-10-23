import {
  getReview,
  insertAuditEvent,
  listLatestCases,
  listReviewsByKind,
  setReviewObservation,
  type Db,
} from '@qa/db';
import { DomainError, DraftContent, hasRole, type Actor, type TenantScope } from '@qa/domain';

// ADR-0018: the open-question register. A clarification review is the question; a QA engineer
// may record what the product does today, labelled as observed, never as a requirement. Cases
// that depend on a question name its review id in `openQuestions`.

const QUESTION_KINDS = ['REQUIREMENT_CLARIFICATION', 'MISSING_KNOWLEDGE'];

export async function listQuestions(db: Db, scope: TenantScope) {
  const [reviews, cases] = await Promise.all([
    listReviewsByKind(db, scope, QUESTION_KINDS),
    listLatestCases(db, scope),
  ]);
  const dependents = new Map<string, Array<{ caseId: string; title: string }>>();
  for (const c of cases) {
    const d = DraftContent.safeParse(c.content).data;
    for (const q of d?.openQuestions ?? []) {
      dependents.set(q, [...(dependents.get(q) ?? []), { caseId: c.caseId, title: d?.title ?? c.caseId }]);
    }
  }
  return reviews.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    story: r.subjectType === 'story' ? r.subjectId : null,
    question: r.question,
    about: r.sourceRefs,
    currentBehaviour: r.observedBehaviour,
    resolution: r.resolution,
    cases: dependents.get(r.id) ?? [],
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));
}

/** Records the product's current behaviour for a question. Observed by a person, audited, replaceable. */
export async function recordObservation(db: Db, actor: Actor, reviewId: string, currentBehaviour: string) {
  if (hasRole(actor, 'AI_AGENT'))
    throw new DomainError('FORBIDDEN', 'the AI agent cannot record observations');
  if (!hasRole(actor, 'QA_ENGINEER', 'QA_LEAD', 'ADMIN')) {
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot record observations`);
  }
  const scope: TenantScope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const review = await getReview(db, scope, reviewId);
  if (!review) throw new DomainError('NOT_FOUND', `review ${reviewId} not found`);
  if (!QUESTION_KINDS.includes(review.kind)) {
    throw new DomainError('VALIDATION', `review ${reviewId} is a ${review.kind}, not a question`);
  }
  const text = currentBehaviour.trim();
  if (!text) throw new DomainError('VALIDATION', 'describe what the product does today');
  const updated = await setReviewObservation(db, scope, reviewId, text);
  await insertAuditEvent(db, scope, {
    actorId: actor.id,
    workflowId: review.workflowId,
    correlationId: null,
    actionKind: 'QUESTION_OBSERVATION_RECORDED',
    actionHash: null,
    target: reviewId,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome: 'RECORDED',
  });
  return updated;
}
