import {
  getEnvironment,
  getManualRun,
  getSuiteRun,
  insertAuditEvent,
  insertEvidence,
  insertManualRun,
  latestRevision,
  listManualRunEvidence,
  listManualRunsForCase,
  listSuiteRunItems,
  type Db,
  type ManualRunRow,
  type ManualStepResult,
} from '@qa/db';
import {
  DomainError,
  DraftContent,
  hasRole,
  ManualRunInput,
  type Actor,
  type ManualRunRequest,
  type TenantScope,
} from '@qa/domain';
import { evidenceKey, type EvidenceStore } from '@qa/evidence';

// ADR-0017: a tester records what they observed, step by step. The overall status is derived
// here from the step results, never taken from the request and never from a model.

const TESTER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'] as const;
const scopeOf = (a: Actor): TenantScope => ({ tenantId: a.tenantId, projectId: a.projectId });

function requireTester(actor: Actor, what: string) {
  if (hasRole(actor, 'AI_AGENT')) {
    throw new DomainError('FORBIDDEN', `the AI agent cannot ${what}: manual results come from people`);
  }
  if (!hasRole(actor, ...TESTER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot ${what}`);
}

/** Derives the record's status from its steps; the one place the rules live. */
export function deriveManualStatus(steps: ManualStepResult[], reason: string) {
  const firstProblem = steps.findIndex((s) => s.status === 'FAILED' || s.status === 'BLOCKED');
  steps.forEach((s, i) => {
    if (s.status === 'SKIPPED' && (firstProblem === -1 || i < firstProblem)) {
      throw new DomainError(
        'VALIDATION',
        `step ${i + 1} is skipped although no earlier step failed or was blocked`,
      );
    }
  });
  const failed = steps.find((s) => s.status === 'FAILED');
  if (failed) {
    if (!failed.actual.trim())
      throw new DomainError('VALIDATION', `step ${failed.index} failed: record the actual result`);
    return { status: 'FAILED' as const, failedStep: failed.index };
  }
  const blocked = steps.find((s) => s.status === 'BLOCKED');
  if (blocked) {
    if (!blocked.actual.trim() && !reason.trim())
      throw new DomainError('VALIDATION', `step ${blocked.index} is blocked: say what blocked it`);
    return { status: 'BLOCKED' as const, failedStep: null };
  }
  return { status: 'PASSED' as const, failedStep: null };
}

export async function recordManualRun(db: Db, actor: Actor, raw: ManualRunRequest): Promise<ManualRunRow> {
  requireTester(actor, 'record a manual run');
  const input = ManualRunInput.parse(raw);
  const scope = scopeOf(actor);

  const rev = await latestRevision(db, scope, input.caseId);
  if (!rev) throw new DomainError('NOT_FOUND', `test case ${input.caseId} not found`);
  if (rev.status !== 'APPROVED') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `only an APPROVED revision can be executed (is ${rev.status})`,
    );
  }
  const content = DraftContent.parse(rev.content);
  if (content.steps.length !== input.steps.length) {
    throw new DomainError(
      'VALIDATION',
      `the case has ${content.steps.length} steps; ${input.steps.length} results were given`,
    );
  }
  if (!(await getEnvironment(db, scope, input.environmentId))) {
    throw new DomainError('NOT_FOUND', `environment ${input.environmentId} not found`);
  }
  if (input.suiteRunId) {
    const suiteRun = await getSuiteRun(db, scope, input.suiteRunId);
    if (!suiteRun) throw new DomainError('NOT_FOUND', `suite run ${input.suiteRunId} not found`);
    const items = await listSuiteRunItems(db, scope, input.suiteRunId);
    if (!items.some((i) => i.caseId === input.caseId)) {
      throw new DomainError(
        'VALIDATION',
        `case ${input.caseId} is not part of suite run ${input.suiteRunId}`,
      );
    }
  }

  const steps: ManualStepResult[] = input.steps.map((s, i) => ({
    index: i + 1,
    status: s.status,
    actual: s.actual,
  }));
  const derived = deriveManualStatus(steps, input.reason);
  const finishedAt = input.finishedAt ?? new Date();
  const startedAt = input.startedAt ?? finishedAt;
  if (finishedAt < startedAt) throw new DomainError('VALIDATION', 'finishedAt is before startedAt');

  const row = await insertManualRun(db, scope, {
    caseId: input.caseId,
    caseRevision: rev.revision,
    suiteRunId: input.suiteRunId ?? null,
    environmentId: input.environmentId,
    build: input.build,
    testerId: actor.id,
    status: derived.status,
    failedStep: derived.failedStep,
    reason: input.reason,
    steps,
    notes: input.notes,
    defectRef: input.defectRef ?? null,
    startedAt,
    finishedAt,
  });
  await insertAuditEvent(db, scope, {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind: 'MANUAL_RUN_RECORDED',
    actionHash: null,
    target: `${input.caseId}:r${rev.revision}`,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome: derived.status,
  });
  return row;
}

export async function getManualRunDetail(db: Db, scope: TenantScope, id: string) {
  const run = await getManualRun(db, scope, id);
  if (!run) throw new DomainError('NOT_FOUND', `manual run ${id} not found`);
  const evidence = await listManualRunEvidence(db, scope, id);
  return { ...run, evidence: evidence.map((e) => ({ id: e.id, name: e.name, contentType: e.contentType })) };
}

export async function listManualRuns(db: Db, scope: TenantScope, caseId: string) {
  if (!(await latestRevision(db, scope, caseId)))
    throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
  return listManualRunsForCase(db, scope, caseId);
}

const ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/json']);
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type ManualEvidenceDeps = { db: Db; store: EvidenceStore; evidenceRetentionDays?: number };

/**
 * Attaches a screenshot or a text file to a record: the tester who made it, or a lead/admin.
 * Stored like automated evidence (by key, with digest and retention) and served the same way.
 */
export async function attachManualEvidence(
  deps: ManualEvidenceDeps,
  actor: Actor,
  manualRunId: string,
  file: { name: string; contentType: string; data: Uint8Array },
) {
  requireTester(actor, 'attach evidence');
  const scope = scopeOf(actor);
  const run = await getManualRun(deps.db, scope, manualRunId);
  if (!run) throw new DomainError('NOT_FOUND', `manual run ${manualRunId} not found`);
  if (run.testerId !== actor.id && !hasRole(actor, 'QA_LEAD', 'ADMIN')) {
    throw new DomainError(
      'FORBIDDEN',
      'only the tester who recorded the run, or a lead/admin, may attach evidence',
    );
  }
  if (!ATTACHMENT_TYPES.has(file.contentType)) {
    throw new DomainError('VALIDATION', `unsupported content type ${file.contentType}`);
  }
  if (file.data.byteLength === 0 || file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new DomainError('VALIDATION', `attachment must be 1 byte to ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  const key = evidenceKey(scope, manualRunId, file.name); // validates every segment
  const stored = await deps.store.put(key, file.data);
  const retentionUntil = new Date(Date.now() + (deps.evidenceRetentionDays ?? 30) * 86_400_000);
  const row = await insertEvidence(deps.db, scope, {
    manualRunId,
    kind: file.contentType.startsWith('image/') ? 'screenshot' : 'attachment',
    name: file.name,
    contentType: file.contentType,
    ...stored,
    retentionUntil,
  });
  await insertAuditEvent(deps.db, scope, {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind: 'MANUAL_EVIDENCE_ATTACHED',
    actionHash: null,
    target: manualRunId,
    policyVersion: null,
    decisionRecordId: null,
    approvalId: null,
    outcome: row.id,
  });
  return { id: row.id, name: row.name, contentType: row.contentType, sizeBytes: row.sizeBytes };
}
