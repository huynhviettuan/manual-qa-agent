import { insertAuditEvent, latestRevision, setCaseKnownBug, type Db } from '@qa/db';
import { DomainError, hasRole, type Actor, type TenantScope } from '@qa/domain';

// ADR-0021: a case's known bug. An open defect blocks the expected result, so a FAILED run is
// what the team expects until the bug is fixed, and a PASSED run is the signal to retest and
// clear the mark. Set by a reviewer, never by the model or the AI agent; verdicts never change.

const SETTER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const BUG_REF = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

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
  await setCaseKnownBug(db, scope, caseId, ref);
  await insertAuditEvent(db, scope, {
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
}
