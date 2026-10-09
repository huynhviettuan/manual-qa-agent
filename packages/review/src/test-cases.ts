import {
  addRevision,
  insertAuditEvent,
  latestRevision,
  setRevisionStatus,
  type CaseRevisionRow,
  type Db,
} from '@qa/db';
import { type Actor, type CaseStatus, DomainError, DraftContent, hasRole, transitionCase } from '@qa/domain';
import { ingestSource, type IngestResult } from '@qa/retrieval';

export type CaseReviewInput =
  | { decision: 'APPROVE'; reason?: string }
  | { decision: 'REJECT'; reason: string }
  | { decision: 'EDIT'; content: unknown; reason?: string };

const REVIEWER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;

/** Walks the case state machine one validated step at a time. */
function path(from: CaseStatus, to: CaseStatus): CaseStatus[] {
  if (from === 'DRAFT' && (to === 'APPROVED' || to === 'REJECTED')) return ['IN_REVIEW', to];
  return [to];
}

/**
 * Human review of a generated draft. EDIT creates a new revision (old ones are kept);
 * APPROVE/REJECT apply to the latest revision only. Approval is of the test definition,
 * not evidence that the product passes.
 */
export async function reviewTestCase(
  db: Db,
  actor: Actor,
  caseId: string,
  input: CaseReviewInput,
): Promise<CaseRevisionRow> {
  if (!hasRole(actor, ...REVIEWER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot review test cases`);
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };

  return db.transaction(async (tx) => {
    const latest = await latestRevision(tx, scope, caseId);
    if (!latest) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);

    let result: CaseRevisionRow;
    if (input.decision === 'EDIT') {
      if (!['DRAFT', 'REJECTED', 'NEEDS_CLARIFICATION'].includes(latest.status)) {
        throw new DomainError(
          'ILLEGAL_TRANSITION',
          `cannot edit a ${latest.status} revision; retire it and draft anew`,
        );
      }
      const parsed = DraftContent.safeParse(input.content);
      if (!parsed.success || parsed.data.steps.length === 0) {
        throw new DomainError('VALIDATION', 'edited content must be a valid draft with at least one step');
      }
      if (latest.status !== 'DRAFT') transitionCase(latest.status, 'DRAFT');
      result = await addRevision(tx, scope, caseId, {
        content: parsed.data,
        sourceRefs: [...new Set(parsed.data.steps.flatMap((s) => s.sourceRefs))],
        authorId: actor.id,
        status: 'DRAFT',
      });
    } else {
      const target: CaseStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      let status = latest.status;
      for (const step of path(status, target)) status = transitionCase(status, step);
      await setRevisionStatus(tx, scope, latest.revisionId, status);
      result = { ...latest, status };
    }

    await insertAuditEvent(tx, scope, {
      actorId: actor.id,
      workflowId: null,
      correlationId: null,
      actionKind: `CASE_${input.decision}`,
      actionHash: null,
      target: `${caseId}:r${result.revision}`,
      policyVersion: null,
      decisionRecordId: null,
      approvalId: null,
      outcome: result.status,
    });
    return result;
  });
}

/** Only an APPROVED revision may become a trusted (T1) reference test case. */
export async function promoteToReference(db: Db, actor: Actor, caseId: string): Promise<IngestResult> {
  const scope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const latest = await latestRevision(db, scope, caseId);
  if (!latest) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
  if (latest.status !== 'APPROVED') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `only APPROVED revisions can be promoted (is ${latest.status})`,
    );
  }
  const content = DraftContent.parse(latest.content);
  const body = [
    `# ${content.title}`,
    ...content.steps.map(
      (s, i) => `${i + 1}. ${s.action} -> Expected: ${s.expected} (sources: ${s.sourceRefs.join(', ')})`,
    ),
  ].join('\n');
  return ingestSource(db, actor, {
    meta: {
      sourceId: `TC-${caseId}`,
      version: `r${latest.revision}`,
      sourceType: 'TEST_CASE',
      trustTier: 'T1',
      approvalStatus: 'APPROVED',
      approvedBy: actor.id,
      owner: actor.id,
      ruleKeys: [],
      effectiveFrom: new Date(),
    },
    body,
  });
}
