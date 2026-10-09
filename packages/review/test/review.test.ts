import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestCase,
  createTestDb,
  insertStoryVersion,
  listRevisions,
  seedProject,
  type Db,
  type SeededActors,
} from '@qa/db';
import { actionHash } from '@qa/policy-engine';
import { retrieve } from '@qa/retrieval';
import {
  listQueue,
  openReview,
  promoteToReference,
  resolveReview,
  reviewTestCase,
  type OpenReviewInput,
} from '../src/index.ts';

const S = { tenantId: 't', projectId: 'p' };
const OTHER = { tenantId: 't2', projectId: 'p2' };
let db: Db;
let a: SeededActors;
let other: SeededActors;
let storyId: string;

const clarification = (): OpenReviewInput => ({
  workflowId: null,
  kind: 'REQUIREMENT_CLARIFICATION',
  subjectType: 'story',
  subjectId: storyId,
  question: 'How many failed logins lock the account?',
  reason: 'READINESS_CLARIFICATION',
  sourceRefs: ['AC-LOGIN@v1'],
  recommendedAction: 'PAUSE_SCENARIO',
  modelSuggestion: { readiness: 'clarification' },
  targetEnvironment: null,
  proposedActionHash: null,
  policyVersion: 'policy-test',
  expiresAt: null,
});

const draft = {
  title: 'Lockout',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [{ action: 'Fail login 5 times', expected: 'Locked 15 min', sourceRefs: ['AC-LOGIN@v1'] }],
  assumptions: [],
  missingRequirements: [],
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  other = await seedProject(db, OTHER);
  storyId = (
    await insertStoryVersion(db, S, {
      externalId: 'LOGIN-1',
      title: 'Lockout',
      description: 'd',
      acceptanceCriteria: [
        { id: 'AC-LOGIN-04', text: 'After multiple failed logins the user is locked out.' },
      ],
      targetRelease: null,
      createdBy: a.qa.id,
    })
  ).id;
});
afterAll(() => db.close());

describe('review queue', () => {
  it('routes clarifications to the product owner and is tenant scoped', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    expect(r).toMatchObject({ status: 'OPEN', assignedRole: 'PRODUCT_OWNER', risk: 'MEDIUM' });
    expect((await listQueue(db, a.po, { mine: true })).map((x) => x.id)).toContain(r.id);
    expect((await listQueue(db, a.qa, { mine: true })).map((x) => x.id)).not.toContain(r.id);
    expect(await listQueue(db, other.lead)).toEqual([]);
  });

  it('the AI agent can neither read nor resolve reviews', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    await expect(listQueue(db, a.agent)).rejects.toThrow(/AI agent/);
    await expect(resolveReview(db, a.agent, r.id, { action: 'APPROVE', reason: 'x' })).rejects.toThrow(
      /AI agent/,
    );
  });

  it('reviewers outside the assigned role cannot resolve; another tenant cannot see it', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    await expect(resolveReview(db, a.qa, r.id, { action: 'APPROVE', reason: 'x' })).rejects.toThrow(
      /PRODUCT_OWNER/,
    );
    await expect(resolveReview(db, other.admin, r.id, { action: 'APPROVE', reason: 'x' })).rejects.toThrow(
      /not found/,
    );
  });

  it('request info -> assign -> approve follows the state machine; resolved reviews are final', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    await resolveReview(db, a.po, r.id, { action: 'REQUEST_INFO', reason: 'need data' });
    await expect(resolveReview(db, a.po, r.id, { action: 'APPROVE', reason: 'x' })).rejects.toThrow(
      /NEEDS_INFO -> APPROVED/,
    );
    await resolveReview(db, a.po, r.id, { action: 'ASSIGN' });
    const done = await resolveReview(db, a.po, r.id, { action: 'REJECT', reason: 'not a requirement' });
    expect(done.review).toMatchObject({ status: 'REJECTED', resolvedBy: a.po.id });
    await expect(resolveReview(db, a.po, r.id, { action: 'APPROVE', reason: 'x' })).rejects.toThrow(
      /REJECTED -> APPROVED/,
    );
  });

  it('escalation reassigns the role', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    const { review } = await resolveReview(db, a.po, r.id, {
      action: 'ESCALATE',
      reason: 'legal',
      toRole: 'ADMIN',
    });
    expect(review).toMatchObject({ status: 'ASSIGNED', assignedRole: 'ADMIN' });
  });
});

describe('knowledge feedback (Workflow C)', () => {
  it('a product owner answer becomes a new trusted source version', async () => {
    const r = await openReview(db, S, a.agent.id, clarification());
    const res = await resolveReview(db, a.po, r.id, {
      action: 'APPROVE',
      reason: 'clarified',
      publishSource: {
        sourceId: 'CLAR-LOCKOUT',
        version: 'v1',
        content: '# AC-LOGIN-04\nLock after 5 failed logins for 15 minutes.',
      },
    });
    expect(res.publishedSource).toMatchObject({ status: 'INGESTED', trusted: true });
    const found = await retrieve(db, S, {
      queryType: 'GENERATE_TEST',
      text: 'lock',
      identifiers: ['AC-LOGIN-04'],
    });
    expect(found.chunks.map((c) => c.sourceId)).toContain('CLAR-LOCKOUT');
  });

  it('an answer from a non-owner role is stored as untrusted T4 only', async () => {
    const r = await openReview(db, S, a.agent.id, { ...clarification(), kind: 'MISSING_KNOWLEDGE' });
    const res = await resolveReview(db, a.qa, r.id, {
      action: 'APPROVE',
      reason: 'my guess',
      publishSource: {
        sourceId: 'QA-GUESS',
        version: 'v1',
        content: '# Reset\nzebra links expire after 2 hours',
      },
    });
    expect(res.publishedSource).toMatchObject({ trusted: false });
    const found = await retrieve(db, S, { queryType: 'GENERATE_TEST', text: 'zebra', identifiers: [] });
    expect(found.status).toBe('NO_TRUSTED_CONTEXT');
  });
});

describe('action approvals', () => {
  const proposal = {
    kind: 'delete' as const,
    projectId: 'p',
    environmentId: 'staging',
    caseId: 'c',
    parameters: {},
  };

  it('issue a time-bound grant tied to the action hash and environment; only leads may approve', async () => {
    const r = await openReview(db, S, a.agent.id, {
      ...clarification(),
      kind: 'ACTION_APPROVAL',
      proposedActionHash: actionHash(proposal),
      targetEnvironment: 'staging',
    });
    await expect(resolveReview(db, a.po, r.id, { action: 'APPROVE', reason: 'ok' })).rejects.toThrow(
      /QA_LEAD/,
    );
    const now = new Date('2026-10-09T10:00:00Z');
    const res = await resolveReview(
      db,
      a.lead,
      r.id,
      { action: 'APPROVE', reason: 'ok', approvalTtlMs: 48 * 3600e3 },
      now,
    );
    expect(res.approval).toMatchObject({
      actionHash: actionHash(proposal),
      environmentId: 'staging',
      approvedBy: a.lead.id,
    });
    // TTL is capped at 24h.
    expect(res.approval!.expiresAt.toISOString()).toBe('2026-10-10T10:00:00.000Z');
  });
});

describe('test case lifecycle', () => {
  it('edit creates a new revision; approve applies to the latest; approved can be promoted', async () => {
    const c = await createTestCase(db, S, {
      storyId,
      workflowId: null,
      content: draft,
      sourceRefs: ['AC-LOGIN@v1'],
      authorId: a.agent.id,
    });
    await expect(promoteToReference(db, a.lead, c.caseId)).rejects.toThrow(/only APPROVED/);
    const edited = await reviewTestCase(db, a.qa, c.caseId, {
      decision: 'EDIT',
      content: { ...draft, title: 'Lockout (edited)' },
    });
    expect(edited).toMatchObject({ revision: 2, status: 'DRAFT', authorId: a.qa.id });
    const approved = await reviewTestCase(db, a.qa, c.caseId, { decision: 'APPROVE' });
    expect(approved).toMatchObject({ revision: 2, status: 'APPROVED' });
    const revs = await listRevisions(db, S, c.caseId);
    expect(revs.map((r) => [r.revision, r.status])).toEqual([
      [1, 'DRAFT'],
      [2, 'APPROVED'],
    ]);
    await expect(reviewTestCase(db, a.qa, c.caseId, { decision: 'EDIT', content: draft })).rejects.toThrow(
      /cannot edit/,
    );
    expect(await promoteToReference(db, a.lead, c.caseId)).toMatchObject({
      sourceId: `TC-${c.caseId}`,
      version: 'r2',
      trusted: true,
    });
  });

  it('rejects invalid edits and non-reviewer roles', async () => {
    const c = await createTestCase(db, S, {
      storyId,
      workflowId: null,
      content: draft,
      sourceRefs: [],
      authorId: a.agent.id,
    });
    await expect(
      reviewTestCase(db, a.qa, c.caseId, { decision: 'EDIT', content: { ...draft, steps: [] } }),
    ).rejects.toThrow(/at least one step/);
    await expect(reviewTestCase(db, a.agent, c.caseId, { decision: 'APPROVE' })).rejects.toThrow(
      /cannot review/,
    );
    await expect(reviewTestCase(db, a.po, c.caseId, { decision: 'APPROVE' })).rejects.toThrow(
      /cannot review/,
    );
  });

  it('a rejected draft can be edited back into a draft', async () => {
    const c = await createTestCase(db, S, {
      storyId,
      workflowId: null,
      content: draft,
      sourceRefs: [],
      authorId: a.agent.id,
    });
    expect((await reviewTestCase(db, a.qa, c.caseId, { decision: 'REJECT', reason: 'wrong' })).status).toBe(
      'REJECTED',
    );
    expect((await reviewTestCase(db, a.qa, c.caseId, { decision: 'EDIT', content: draft })).status).toBe(
      'DRAFT',
    );
  });
});
