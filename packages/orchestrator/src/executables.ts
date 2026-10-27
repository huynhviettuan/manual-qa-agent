import { findSourceVersion, insertDecisionRecord, insertUsageEvent, latestRevision, type Db } from '@qa/db';
import {
  DomainError,
  DraftContent,
  hasRole,
  type Actor,
  type EvidenceChunk,
  type TenantScope,
} from '@qa/domain';
import type { ExecutableGenerator } from '@qa/llm-adapter';
import { proposeExecutable } from './runs.ts';

// ADR-0024: the agent proposes the executable steps of an approved case. The proposal goes through
// `proposeExecutable` like a hand-written one (schema, traceability, weak-assertion flags) and a
// different person approves it (ADR-0008); the call is recorded as a decision record.

const PROPOSER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'] as const;

export type ProposeFromCaseResult =
  | { proposed: true; executableId: string; version: number; reviewFlags: string[]; decisionRecordId: string }
  | { proposed: false; failure: string; detail: string; decisionRecordId: string };

export async function proposeExecutableFromCase(
  deps: { db: Db; executables: ExecutableGenerator | null | undefined },
  actor: Actor,
  caseId: string,
  hints: string[] = [],
): Promise<ProposeFromCaseResult> {
  if (!hasRole(actor, ...PROPOSER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot propose executables`);
  if (!deps.executables) throw new DomainError('VALIDATION', 'no executable generator is configured');
  const { db } = deps;
  const scope: TenantScope = { tenantId: actor.tenantId, projectId: actor.projectId };
  const revision = await latestRevision(db, scope, caseId);
  if (!revision) throw new DomainError('NOT_FOUND', `test case ${caseId} not found`);
  if (revision.status !== 'APPROVED')
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `case revision ${revision.revision} is ${revision.status}, not APPROVED`,
    );
  const content = DraftContent.parse(revision.content);
  if (content.level === 'manual')
    throw new DomainError(
      'VALIDATION',
      `case ${revision.code ?? caseId} is manual: ${content.manualReason || 'no reason given'}`,
    );

  // The case's own sources, whole: the steps must trace to them and the model sees nothing else.
  const sources: EvidenceChunk[] = [];
  for (const ref of revision.sourceRefs) {
    const [sourceId, version] = ref.split('@');
    if (!sourceId || !version) continue;
    const row = await findSourceVersion(db, scope, sourceId, version);
    if (row)
      sources.push({
        sourceId,
        version,
        chunkId: row.id,
        content: row.content,
        trustTier: row.trustTier,
        relevance: 1,
      });
  }

  const out = await deps.executables.generateExecutable({
    caseId,
    code: revision.code,
    content,
    sourceRefs: revision.sourceRefs,
    sources,
    hints,
  });
  const decisionRecordId = await insertDecisionRecord(db, scope, {
    workflowId: null,
    kind: 'executable',
    provider: out.meta.provider,
    requestedModel: out.meta.requestedModel,
    model: out.meta.model,
    promptVersion: out.meta.promptVersion,
    inputHash: out.meta.inputHash,
    snapshotId: null,
    sourceRefs: revision.sourceRefs,
    outcome: out.ok ? 'OK' : out.failure,
    result: out.ok ? out.value : { failure: out.failure, detail: out.detail },
    usage: out.meta.usage,
    latencyMs: out.meta.latencyMs,
  });
  await insertUsageEvent(db, scope, {
    workflowId: null,
    component: 'executable',
    model: out.meta.model,
    inputTokens: out.meta.usage?.inputTokens ?? 0,
    outputTokens: out.meta.usage?.outputTokens ?? 0,
    cacheReadTokens: out.meta.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: out.meta.usage?.cacheWriteTokens ?? 0,
    retrievedTokensEstimate: 0,
    latencyMs: out.meta.latencyMs,
  });
  if (!out.ok) return { proposed: false, failure: out.failure, detail: out.detail, decisionRecordId };
  const row = await proposeExecutable(db, actor, caseId, out.value);
  return {
    proposed: true,
    executableId: row.id,
    version: row.version,
    reviewFlags: row.reviewFlags,
    decisionRecordId,
  };
}
