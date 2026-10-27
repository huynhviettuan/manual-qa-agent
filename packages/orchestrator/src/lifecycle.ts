import {
  insertAuditEvent,
  latestRevision,
  listReviewsByKind,
  setCaseKnownBug,
  updateReviewStatus,
  type Db,
  type ReviewRow,
} from '@qa/db';
import {
  DomainError,
  hasRole,
  transitionReview,
  type Actor,
  type ReviewStatus,
  type TenantScope,
} from '@qa/domain';
import { openReview } from '@qa/review';

// ADR-0021: a case's known bug. An open defect blocks the expected result, so a FAILED run is
// what the team expects until the bug is fixed, and a PASSED run is the signal to retest and
// clear the mark. Set by a reviewer, never by the model or the AI agent; verdicts never change.
// ADR-0022: that signal is a review task, not only a label someone has to notice in a report.

const SETTER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const BUG_REF = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const RETEST = 'KNOWN_BUG_RETEST';
const OPEN: ReviewStatus[] = ['OPEN', 'ASSIGNED', 'NEEDS_INFO'];

const openRetests = async (db: Db, scope: TenantScope, caseId: string): Promise<ReviewRow[]> =>
  (await listReviewsByKind(db, scope, [RETEST])).filter(
    (r) => r.subjectId === caseId && OPEN.includes(r.status as ReviewStatus),
  );

export async function setKnownBug(db: Db, actor: Actor, caseId: string, bugRef: string | null) {
  if (hasRole(actor, 'AI_AGENT')) throw new DomainError('FORBIDDEN', 'the AI agent cannot mark known bugs');
  if (!hasRole(actor, ...SETTER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot mark known bugs`);
  const scope: TenantScope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const ref = bugRef?.trim() || null;
  if (ref && !BUG_REF.test(ref))
    throw new DomainError('VALIDATION', `"${ref}" is not a defect reference such as BUG-041 or PROJ-123`);
  const latest = await latestRevision(db, scope, caseId);
  if (!latest) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
  return db.transaction(async (tx) => {
    await setCaseKnownBug(tx, scope, caseId, ref);
    // Changing or clearing the mark answers any retest still open for the old one.
    if (latest.knownBug && latest.knownBug !== ref) {
      for (const r of await openRetests(tx, scope, caseId)) {
        const to: ReviewStatus = r.status === 'NEEDS_INFO' ? 'CANCELLED' : 'APPROVED';
        transitionReview(r.status as ReviewStatus, to);
        await updateReviewStatus(tx, scope, r.id, r.status, {
          status: to,
          resolution: { knownBug: latest.knownBug, now: ref },
          resolvedBy: actor.id,
        });
      }
    }
    await insertAuditEvent(tx, scope, {
      actorId: actor.id,
      workflowId: null,
      correlationId: null,
      actionKind: ref ? 'CASE_KNOWN_BUG_SET' : 'CASE_KNOWN_BUG_CLEARED',
      actionHash: null,
      target: caseId,
      policyVersion: null,
      decisionRecordId: null,
      approvalId: null,
      outcome: ref ?? 'CLEARED',
    });
    return { caseId, code: latest.code, knownBug: ref };
  });
}

/**
 * After a PASSED result (manual or automated) of a case marked with a known bug, asks a person to
 * retest the defect and clear the mark. One open review per case; the verdict is untouched.
 */
export async function openRetestReviewIfDue(
  db: Db,
  scope: TenantScope,
  actorId: string,
  passed: { caseId: string; environmentId: string; build: string; runRef: string },
): Promise<ReviewRow | null> {
  const latest = await latestRevision(db, scope, passed.caseId);
  if (!latest?.knownBug) return null;
  const existing = await openRetests(db, scope, passed.caseId);
  if (existing.length) return existing[0]!;
  const where = `${passed.environmentId}${passed.build ? ` build ${passed.build}` : ''}`;
  return openReview(db, scope, actorId, {
    workflowId: null,
    kind: RETEST,
    subjectType: 'test_case',
    subjectId: passed.caseId,
    question: `${latest.code ?? passed.caseId} passed on ${where} (${passed.runRef}) while marked with known bug ${latest.knownBug}. Retest the defect; if it is fixed, clear the mark (POST /api/test-cases/${passed.caseId}/known-bug with null).`,
    reason: 'KNOWN_BUG_PASSED',
    sourceRefs: [],
    recommendedAction: 'RETEST_AND_CLEAR_KNOWN_BUG',
    modelSuggestion: null,
    targetEnvironment: passed.environmentId,
    proposedActionHash: null,
    policyVersion: 'lifecycle-v1',
    expiresAt: null,
  });
}
