import { describe, expect, it } from 'vitest';
import type { Actor } from '@qa/domain';
import { actionHash, decideGate, evaluate, type Evaluation, type PolicyContext } from '../src/index.ts';

const base: Evaluation = {
  action: 'draft',
  targetEnvironment: 'staging',
  sourcesTrusted: true,
  hasContradiction: false,
  classifiedReadiness: 'ready',
  grounded: true,
  criteriaCovered: true,
  authorized: true,
  hasScopedApproval: false,
};

describe('decideGate (docs/05)', () => {
  it('ready + trusted + grounded draft proceeds', () => {
    expect(decideGate(base).gate).toBe('AUTO_PROCEED');
  });

  it('unauthorized actors are denied before anything else', () => {
    expect(decideGate({ ...base, authorized: false, hasScopedApproval: true }).gate).toBe('DENY');
  });

  it('production writes are denied even with a scoped approval', () => {
    for (const action of ['execute', 'delete', 'publish_bug'] as const) {
      expect(
        decideGate({ ...base, action, targetEnvironment: 'production', hasScopedApproval: true }),
      ).toEqual({
        gate: 'DENY',
        reason: 'PRODUCTION_WRITE_DISABLED',
      });
    }
  });

  it('drafting against a production project context is not a write', () => {
    expect(decideGate({ ...base, targetEnvironment: 'production' }).gate).toBe('AUTO_PROCEED');
  });

  it('an approved delete with a source contradiction still needs review', () => {
    expect(
      decideGate({ ...base, action: 'delete', hasContradiction: true, hasScopedApproval: true }).gate,
    ).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('a ready classification never authorizes a destructive action without approval', () => {
    expect(decideGate({ ...base, action: 'delete' })).toEqual({
      gate: 'NEEDS_HUMAN_REVIEW',
      reason: 'SCOPED_APPROVAL_REQUIRED',
    });
  });

  it('publish_bug without approval needs review', () => {
    expect(decideGate({ ...base, action: 'publish_bug' }).gate).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('missing trusted sources asks for more retrieval', () => {
    expect(decideGate({ ...base, sourcesTrusted: false }).gate).toBe('RETRIEVE_MORE');
  });

  it.each(['clarification', 'blocked', 'other', undefined] as const)('readiness %s routes to review', (r) => {
    expect(decideGate({ ...base, classifiedReadiness: r }).gate).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('a ready draft with an acceptance criterion no trusted source supports routes to review', () => {
    expect(decideGate({ ...base, criteriaCovered: false })).toEqual({
      gate: 'NEEDS_HUMAN_REVIEW',
      reason: 'UNSUPPORTED_ACCEPTANCE_CRITERIA',
    });
  });

  it('a configured confidence floor can only downgrade to review', () => {
    expect(decideGate({ ...base, confidence: 0.6, minReadyConfidence: 0.8 })).toEqual({
      gate: 'NEEDS_HUMAN_REVIEW',
      reason: 'LOW_CONFIDENCE',
    });
    expect(decideGate({ ...base, confidence: 0.95, minReadyConfidence: 0.8 }).gate).toBe('AUTO_PROCEED');
    // Providers without confidence (Claude) are unaffected; no floor means no effect.
    expect(decideGate({ ...base, confidence: null, minReadyConfidence: 0.8 }).gate).toBe('AUTO_PROCEED');
    expect(decideGate({ ...base, confidence: 0.1 }).gate).toBe('AUTO_PROCEED');
  });

  it('high confidence never upgrades a not-ready or destructive action', () => {
    expect(decideGate({ ...base, classifiedReadiness: 'clarification', confidence: 0.99 }).gate).toBe(
      'NEEDS_HUMAN_REVIEW',
    );
    expect(decideGate({ ...base, action: 'delete', confidence: 0.99 }).gate).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('ungrounded ready routes to review', () => {
    expect(decideGate({ ...base, grounded: false }).reason).toBe('UNGROUNDED_CLASSIFICATION');
  });
});

describe('evaluate', () => {
  const lead: Actor = { id: 'lead', tenantId: 't', projectId: 'p', roles: ['QA_LEAD'] };
  const agent: Actor = { id: 'agent', tenantId: 't', projectId: 'p', roles: ['AI_AGENT'] };
  const now = new Date('2026-10-09T12:00:00Z');
  const proposal = {
    kind: 'delete' as const,
    projectId: 'p',
    environmentId: 'staging',
    caseId: 'case_1',
    parameters: { ids: [1] },
  };
  const staging = { id: 'staging', kind: 'staging' as const, allowedActions: ['draft', 'execute', 'delete'] };
  const ctx: PolicyContext = {
    actor: lead,
    proposal,
    environment: staging,
    sourcesTrusted: true,
    hasContradiction: false,
    classifiedReadiness: 'ready',
    grounded: true,
    now,
  };
  const approval = {
    id: 'appr_1',
    actionHash: actionHash(proposal),
    environmentId: 'staging',
    expiresAt: new Date('2026-10-09T13:00:00Z'),
    revokedAt: null,
  };

  it('a valid scoped approval lets an authorized lead proceed and is recorded', () => {
    const r = evaluate({ ...ctx, approval });
    expect(r).toMatchObject({
      gate: 'AUTO_PROCEED',
      approvalId: 'appr_1',
      policyVersion: expect.any(String),
    });
  });

  it('expired or revoked approvals cannot be replayed', () => {
    expect(
      evaluate({ ...ctx, approval: { ...approval, expiresAt: new Date('2026-10-09T11:00:00Z') } }),
    ).toMatchObject({
      gate: 'NEEDS_HUMAN_REVIEW',
      reasons: ['SCOPED_APPROVAL_REQUIRED', 'APPROVAL_EXPIRED'],
    });
    expect(evaluate({ ...ctx, approval: { ...approval, revokedAt: now } }).reasons).toContain(
      'APPROVAL_REVOKED',
    );
  });

  it('an approval for different parameters does not transfer', () => {
    const r = evaluate({ ...ctx, proposal: { ...proposal, parameters: { ids: [1, 2] } }, approval });
    expect(r.reasons).toContain('APPROVAL_ACTION_MISMATCH');
    expect(r.gate).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('the AI agent can never delete, approval or not', () => {
    expect(evaluate({ ...ctx, actor: agent, approval }).gate).toBe('DENY');
  });

  it('actions outside the environment allowlist are denied', () => {
    expect(
      evaluate({ ...ctx, environment: { ...staging, allowedActions: ['draft'] }, approval }),
    ).toMatchObject({
      gate: 'DENY',
      reasons: ['ACTION_NOT_ALLOWLISTED'],
    });
  });

  it('unknown environments are denied', () => {
    expect(evaluate({ ...ctx, environment: null }).reasons).toEqual(['UNKNOWN_ENVIRONMENT']);
  });

  it('cross-project proposals are denied', () => {
    expect(evaluate({ ...ctx, proposal: { ...proposal, projectId: 'other' } }).reasons).toEqual([
      'CROSS_PROJECT_ACTION',
    ]);
  });

  it('budget overruns route to review', () => {
    expect(evaluate({ ...ctx, budget: { usedTokens: 10, limitTokens: 5 } }).reasons).toEqual([
      'BUDGET_EXCEEDED',
    ]);
  });

  it('production delete with valid approval is denied', () => {
    const prod = { id: 'production', kind: 'production' as const, allowedActions: ['draft', 'delete'] };
    const p = { ...proposal, environmentId: 'production' };
    const a = { ...approval, actionHash: actionHash(p), environmentId: 'production' };
    expect(evaluate({ ...ctx, proposal: p, environment: prod, approval: a }).gate).toBe('DENY');
  });
});
