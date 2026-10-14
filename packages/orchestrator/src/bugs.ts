import {
  getApproval,
  getBug,
  getRun,
  insertAuditEvent,
  insertBug,
  insertPolicyEvaluation,
  latestRevision,
  latestTriage,
  updateBug,
  type BugRow,
  type BugStatus,
  type Db,
} from '@qa/db';
import {
  type Actor,
  DomainError,
  DraftContent,
  hasRole,
  redactSecrets,
  sha256,
  type TenantScope,
} from '@qa/domain';
import type { EvidenceStore } from '@qa/evidence';
import type { BugTracker } from '@qa/integrations';
import { evaluate, type PolicyResult } from '@qa/policy-engine';
import { openReview } from '@qa/review';
import { buildReproduction } from './triage.ts';

export type BugDeps = { db: Db; store: EvidenceStore; tracker: BugTracker | null };

const PROPOSER_ROLES = ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'] as const;
const STALE_PUBLISHING_MS = 5 * 60_000;

const scopeOf = (a: Actor): TenantScope => ({ tenantId: a.tenantId, projectId: a.projectId });
const trackerEnv = (t: BugTracker) => `tracker:${t.name}:${t.target}`;

function requireTracker(deps: BugDeps): BugTracker {
  if (!deps.tracker)
    throw new DomainError('VALIDATION', 'bug tracker integration is disabled (QA_JIRA_ENABLED)');
  return deps.tracker;
}

/** publish_bug is gated like any other action: capability, scoped approval, versioned policy. */
async function evaluatePublish(
  db: Db,
  actor: Actor,
  bug: BugRow,
  tracker: BugTracker,
  approvalId: string | null,
) {
  const scope = scopeOf(actor);
  const run = (await getRun(db, scope, bug.runId))!;
  const environmentId = trackerEnv(tracker);
  const approval = approvalId ? await getApproval(db, scope, approvalId) : null;
  const result: PolicyResult = evaluate({
    actor,
    proposal: {
      kind: 'publish_bug',
      projectId: scope.projectId,
      environmentId,
      caseId: run.caseId,
      parameters: { bugId: bug.id, payloadHash: bug.payloadHash, target: tracker.target },
    },
    // External trackers are not execution environments; publishing is their only allowed action.
    environment: { id: environmentId, kind: 'test', allowedActions: ['publish_bug'] },
    sourcesTrusted: true,
    hasContradiction: false,
    classifiedReadiness: 'ready',
    grounded: true,
    criteriaCovered: true,
    approval,
  });
  await insertPolicyEvaluation(db, scope, {
    workflowId: null,
    actorId: actor.id,
    actionKind: 'publish_bug',
    actionHash: result.actionHash,
    environmentId,
    policyVersion: result.policyVersion,
    gate: result.gate,
    reasons: result.reasons,
    decisionRecordId: null,
    approvalId: result.approvalId,
  });
  return result;
}

async function audit(
  db: Db,
  actor: Actor,
  actionKind: string,
  bug: BugRow,
  outcome: string,
  policy?: PolicyResult,
) {
  await insertAuditEvent(db, scopeOf(actor), {
    actorId: actor.id,
    workflowId: null,
    correlationId: null,
    actionKind,
    actionHash: policy?.actionHash ?? bug.payloadHash,
    target: bug.id,
    policyVersion: policy?.policyVersion ?? null,
    decisionRecordId: null,
    approvalId: policy?.approvalId ?? null,
    outcome,
  });
}

/**
 * Drafts a bug from a FAILED run whose triage a human verified as PRODUCT_DEFECT, and opens a
 * scoped approval review for publishing it. One active bug per run.
 */
export async function proposeBug(deps: BugDeps, actor: Actor, runId: string): Promise<BugRow> {
  if (!hasRole(actor, ...PROPOSER_ROLES))
    throw new DomainError('FORBIDDEN', `actor ${actor.id} cannot propose bugs`);
  const tracker = requireTracker(deps);
  const { db } = deps;
  const scope = scopeOf(actor);
  const run = await getRun(db, scope, runId);
  if (!run) throw new DomainError('NOT_FOUND', `run ${runId} not found`);
  if (run.state !== 'FAILED')
    throw new DomainError('ILLEGAL_TRANSITION', `only FAILED runs can produce bugs (run is ${run.state})`);
  const triage = await latestTriage(db, scope, runId);
  if (triage?.verifiedCause !== 'PRODUCT_DEFECT') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      'a human must verify the triage as PRODUCT_DEFECT before a bug is filed',
    );
  }
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM bug_reports WHERE run_id = $1 AND tenant_id = $2 AND project_id = $3 AND status <> 'REVERTED'`,
    [runId, scope.tenantId, scope.projectId],
  );
  if (existing[0]) return (await getBug(db, scope, existing[0].id))!;

  const revision = await latestRevision(db, scope, run.caseId);
  const title = DraftContent.safeParse(revision?.content).data?.title ?? run.caseId;
  const failed = (
    run.assertions as Array<{ expected: unknown; actual: unknown; passed: boolean | null }>
  ).find((a) => a.passed === false);
  const summary = redactSecrets(
    failed
      ? `[QA] ${title}: expected ${JSON.stringify(failed.expected)} but got ${JSON.stringify(failed.actual)}`
      : `[QA] ${title}: ${run.reason ?? 'failed'}`,
  ).text.slice(0, 250);
  const description = [
    await buildReproduction(db, deps.store, scope, runId),
    '',
    `Filed by manual-qa-agent after human verification (triage ${triage.id}, verified by ${triage.verifiedBy}) and a scoped approval.`,
  ].join('\n');
  const labels = ['qa-agent', `qa-agent-run-${runId}`, ...(triage.securitySensitive ? ['security'] : [])];

  const bug = await insertBug(db, scope, {
    runId,
    triageId: triage.id,
    tracker: tracker.name,
    target: tracker.target,
    summary,
    description,
    labels,
    payloadHash: sha256(JSON.stringify({ summary, description, labels, target: tracker.target })),
    createdBy: actor.id,
  });
  const policy = await evaluatePublish(db, actor, bug, tracker, null);
  const review = await openReview(db, scope, actor.id, {
    workflowId: null,
    kind: 'ACTION_APPROVAL',
    subjectType: 'bug_report',
    subjectId: bug.id,
    question: `Approve filing "${summary}" to ${tracker.name} ${tracker.target}${triage.securitySensitive ? ' (security-sensitive)' : ''}?`,
    reason: 'PUBLISH_BUG',
    sourceRefs: [],
    recommendedAction: 'APPROVE_SCOPED_ACTION',
    modelSuggestion: null,
    targetEnvironment: trackerEnv(tracker),
    proposedActionHash: policy.actionHash,
    policyVersion: policy.policyVersion,
    expiresAt: null,
  });
  const withReview = await updateBug(db, scope, bug.id, ['DRAFT'], { reviewId: review.id });
  await audit(db, actor, 'BUG_PROPOSE', withReview, 'DRAFT', policy);
  return withReview;
}

/**
 * Publishes an approved bug. Re-checks the approval at execution time; idempotent through a
 * per-run tracker label (a crash after the external write never creates a duplicate).
 */
export async function publishBug(
  deps: BugDeps,
  actor: Actor,
  bugId: string,
  approvalId: string,
): Promise<BugRow> {
  const tracker = requireTracker(deps);
  const { db } = deps;
  const scope = scopeOf(actor);
  const bug = await getBug(db, scope, bugId);
  if (!bug) throw new DomainError('NOT_FOUND', `bug ${bugId} not found`);
  if (bug.status === 'PUBLISHED') return bug;
  if (bug.target !== tracker.target || bug.tracker !== tracker.name) {
    throw new DomainError('CONFLICT', 'bug was drafted for a different tracker target');
  }

  const policy = await evaluatePublish(db, actor, bug, tracker, approvalId);
  if (policy.gate !== 'AUTO_PROCEED') {
    await audit(db, actor, 'BUG_PUBLISH_DENIED', bug, policy.reasons.join(','), policy);
    throw new DomainError('FORBIDDEN', `publishing not allowed: ${policy.reasons.join(', ')}`);
  }

  // Claim: DRAFT/PUBLISH_FAILED, or a PUBLISHING claim abandoned by a crashed request.
  const from: BugStatus[] =
    bug.status === 'PUBLISHING' && Date.now() - bug.updatedAt.getTime() > STALE_PUBLISHING_MS
      ? ['PUBLISHING']
      : ['DRAFT', 'PUBLISH_FAILED'];
  const claimed = await updateBug(db, scope, bug.id, from, { status: 'PUBLISHING', approvalId });

  const idLabel = claimed.labels.find((l) => l.startsWith('qa-agent-run-'))!;
  try {
    const issue =
      (await tracker.findByLabel(idLabel)) ??
      (await tracker.create({
        summary: claimed.summary,
        description: claimed.description,
        labels: claimed.labels,
      }));
    const published = await updateBug(db, scope, bug.id, ['PUBLISHING'], {
      status: 'PUBLISHED',
      externalKey: issue.key,
      externalUrl: issue.url,
      publishedBy: actor.id,
    });
    await audit(db, actor, 'BUG_PUBLISH', published, `PUBLISHED:${issue.key}`, policy);
    return published;
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err)).text.slice(0, 300);
    const failed = await updateBug(db, scope, bug.id, ['PUBLISHING'], {
      status: 'PUBLISH_FAILED',
      error: message,
    });
    await audit(db, actor, 'BUG_PUBLISH', failed, 'PUBLISH_FAILED', policy);
    return failed;
  }
}

/** Audited reversal of an external write: label + comment (+ optional transition); no deletes. */
export async function revertBug(deps: BugDeps, actor: Actor, bugId: string, reason: string): Promise<BugRow> {
  if (!hasRole(actor, 'QA_LEAD', 'ADMIN'))
    throw new DomainError('FORBIDDEN', 'reverting a filed bug requires QA lead/admin');
  const tracker = requireTracker(deps);
  const scope = scopeOf(actor);
  const bug = await getBug(deps.db, scope, bugId);
  if (!bug) throw new DomainError('NOT_FOUND', `bug ${bugId} not found`);
  if (bug.status !== 'PUBLISHED' || !bug.externalKey) {
    throw new DomainError('ILLEGAL_TRANSITION', `only PUBLISHED bugs can be reverted (bug is ${bug.status})`);
  }
  await tracker.revert(
    bug.externalKey,
    `Reverted by ${actor.id} via manual-qa-agent: ${redactSecrets(reason).text.slice(0, 500)} (bug ${bug.id}, run ${bug.runId})`,
  );
  const reverted = await updateBug(deps.db, scope, bug.id, ['PUBLISHED'], {
    status: 'REVERTED',
    revertedBy: actor.id,
  });
  await audit(deps.db, actor, 'BUG_REVERT', reverted, `REVERTED:${bug.externalKey}`);
  return reverted;
}
