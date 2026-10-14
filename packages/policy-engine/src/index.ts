import {
  type ActionKind,
  type ActionProposal,
  type Actor,
  type EnvironmentKind,
  type Readiness,
  type Role,
  canonicalJson,
  sha256,
} from '@qa/domain';

/** Bump on every behavioural change; persisted with every evaluation and review. */
export const POLICY_VERSION = 'policy-2026-10-09.1';

export type Gate = 'AUTO_PROCEED' | 'RETRIEVE_MORE' | 'NEEDS_HUMAN_REVIEW' | 'DENY';

export type Evaluation = {
  action: ActionKind;
  targetEnvironment: EnvironmentKind;
  sourcesTrusted: boolean;
  hasContradiction: boolean;
  classifiedReadiness?: Readiness;
  grounded: boolean;
  /** Every acceptance criterion is referenced by a retrieved trusted source (US-01). */
  criteriaCovered: boolean;
  /** Provider-reported readiness confidence, if any (OpenAI Decisions); null/undefined otherwise. */
  confidence?: number | null;
  /**
   * Optional floor, applied only when the provider reports a confidence. It can only route to
   * review; confidence never authorizes anything (ADR-0003). Unset until calibrated on evals.
   */
  minReadyConfidence?: number | null;
  /** The action contains irreversible steps (e.g. an executable spec's destructive clicks). */
  destructive?: boolean;
  authorized: boolean;
  hasScopedApproval: boolean;
};

/** Core gate from docs/05. Ordering matters: non-negotiable controls, then evidence, then approvals. */
export function decideGate(e: Evaluation): { gate: Gate; reason: string } {
  if (!e.authorized) return { gate: 'DENY', reason: 'ACTOR_NOT_AUTHORIZED' };
  if (e.targetEnvironment === 'production' && e.action !== 'draft') {
    return { gate: 'DENY', reason: 'PRODUCTION_WRITE_DISABLED' };
  }
  if (e.hasContradiction) return { gate: 'NEEDS_HUMAN_REVIEW', reason: 'SOURCE_CONTRADICTION' };
  if (!e.sourcesTrusted) return { gate: 'RETRIEVE_MORE', reason: 'NO_TRUSTED_SOURCES' };
  if (e.action === 'delete' || e.action === 'publish_bug' || e.destructive) {
    return e.hasScopedApproval
      ? { gate: 'AUTO_PROCEED', reason: 'SCOPED_APPROVAL_VALID' }
      : { gate: 'NEEDS_HUMAN_REVIEW', reason: 'SCOPED_APPROVAL_REQUIRED' };
  }
  if (e.classifiedReadiness !== 'ready') {
    return {
      gate: 'NEEDS_HUMAN_REVIEW',
      reason: `READINESS_${(e.classifiedReadiness ?? 'unknown').toUpperCase()}`,
    };
  }
  if (!e.grounded) return { gate: 'NEEDS_HUMAN_REVIEW', reason: 'UNGROUNDED_CLASSIFICATION' };
  if (e.action === 'draft' && !e.criteriaCovered) {
    return { gate: 'NEEDS_HUMAN_REVIEW', reason: 'UNSUPPORTED_ACCEPTANCE_CRITERIA' };
  }
  if (e.minReadyConfidence != null && e.confidence != null && e.confidence < e.minReadyConfidence) {
    return { gate: 'NEEDS_HUMAN_REVIEW', reason: 'LOW_CONFIDENCE' };
  }
  return { gate: 'AUTO_PROCEED', reason: 'READY_AND_GROUNDED' };
}

/** Capability matrix (docs/09). The AI agent may only draft and request execution via the gate. */
const CAPABILITIES: Record<ActionKind, Role[]> = {
  draft: ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'],
  execute: ['QA_ENGINEER', 'QA_LEAD', 'ADMIN', 'AI_AGENT'],
  delete: ['QA_LEAD', 'ADMIN'],
  publish_bug: ['QA_ENGINEER', 'QA_LEAD', 'ADMIN'],
};

export function isAuthorized(actor: Actor, action: ActionKind): boolean {
  return actor.roles.some((r) => CAPABILITIES[action].includes(r));
}

export type EnvironmentConfig = { id: string; kind: EnvironmentKind; allowedActions: string[] };

export type ApprovalGrant = {
  id: string;
  actionHash: string;
  environmentId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Hash binding an approval to the exact action, target and parameters. */
export function actionHash(
  p: Pick<ActionProposal, 'kind' | 'projectId' | 'environmentId' | 'caseId' | 'parameters'>,
) {
  return sha256(
    canonicalJson({
      kind: p.kind,
      projectId: p.projectId,
      environmentId: p.environmentId,
      caseId: p.caseId ?? null,
      parameters: p.parameters,
    }),
  );
}

/** Re-checked at execution time: same action hash, same environment, not expired, not revoked. */
export function approvalValid(
  approval: ApprovalGrant | null | undefined,
  hash: string,
  environmentId: string,
  now: Date,
) {
  if (!approval) return { valid: false, reason: 'NO_APPROVAL' };
  if (approval.revokedAt) return { valid: false, reason: 'APPROVAL_REVOKED' };
  if (approval.expiresAt.getTime() <= now.getTime()) return { valid: false, reason: 'APPROVAL_EXPIRED' };
  if (approval.actionHash !== hash) return { valid: false, reason: 'APPROVAL_ACTION_MISMATCH' };
  if (approval.environmentId !== environmentId)
    return { valid: false, reason: 'APPROVAL_ENVIRONMENT_MISMATCH' };
  return { valid: true, reason: 'APPROVAL_VALID' };
}

export type PolicyContext = {
  actor: Actor;
  proposal: Pick<ActionProposal, 'kind' | 'projectId' | 'environmentId' | 'caseId' | 'parameters'>;
  /** Administrator-managed; never derived from a URL or model output. */
  environment: EnvironmentConfig | null;
  sourcesTrusted: boolean;
  hasContradiction: boolean;
  classifiedReadiness?: Readiness;
  grounded: boolean;
  criteriaCovered?: boolean;
  destructive?: boolean;
  confidence?: number | null;
  minReadyConfidence?: number | null;
  approval?: ApprovalGrant | null;
  budget?: { usedTokens: number; limitTokens: number };
  now?: Date;
};

export type PolicyResult = {
  gate: Gate;
  reasons: string[];
  policyVersion: string;
  actionHash: string;
  approvalId: string | null;
};

export function evaluate(ctx: PolicyContext): PolicyResult {
  const hash = actionHash(ctx.proposal);
  const base = { policyVersion: POLICY_VERSION, actionHash: hash };
  const deny = (reason: string): PolicyResult => ({
    ...base,
    gate: 'DENY',
    reasons: [reason],
    approvalId: null,
  });

  if (!ctx.environment) return deny('UNKNOWN_ENVIRONMENT');
  if (ctx.actor.projectId !== ctx.proposal.projectId) return deny('CROSS_PROJECT_ACTION');
  if (!ctx.environment.allowedActions.includes(ctx.proposal.kind)) return deny('ACTION_NOT_ALLOWLISTED');
  if (ctx.budget && ctx.budget.usedTokens > ctx.budget.limitTokens) {
    return { ...base, gate: 'NEEDS_HUMAN_REVIEW', reasons: ['BUDGET_EXCEEDED'], approvalId: null };
  }

  const approval = approvalValid(ctx.approval, hash, ctx.environment.id, ctx.now ?? new Date());
  const { gate, reason } = decideGate({
    action: ctx.proposal.kind,
    targetEnvironment: ctx.environment.kind,
    sourcesTrusted: ctx.sourcesTrusted,
    hasContradiction: ctx.hasContradiction,
    classifiedReadiness: ctx.classifiedReadiness,
    grounded: ctx.grounded,
    criteriaCovered: ctx.criteriaCovered ?? true,
    destructive: ctx.destructive ?? false,
    confidence: ctx.confidence,
    minReadyConfidence: ctx.minReadyConfidence,
    authorized: isAuthorized(ctx.actor, ctx.proposal.kind),
    hasScopedApproval: approval.valid,
  });
  const reasons = ctx.approval ? [reason, approval.reason] : [reason];
  return { ...base, gate, reasons, approvalId: approval.valid ? ctx.approval!.id : null };
}
