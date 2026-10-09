import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, seedProject, type Db } from '@qa/db';
import {
  ClaudeProvider,
  createAnthropicClient,
  createFakeAnthropicFetch,
  heuristicResponder,
} from '@qa/llm-adapter';
import { buildApp } from '../src/app.ts';

let db: Db;
let app: FastifyInstance;
const fakeFetch = createFakeAnthropicFetch(heuristicResponder);

const key = (actor: string) => ({ 'x-api-key': `key-p-${actor}` });
const meta = (sourceId: string, extra: Record<string, unknown> = {}) => ({
  sourceId,
  version: 'v1',
  sourceType: 'ACCEPTANCE_CRITERIA',
  trustTier: 'T1',
  approvalStatus: 'APPROVED',
  approvedBy: 'p-po',
  owner: 'p-po',
  effectiveFrom: '2026-01-01',
  ...extra,
});
const lockoutStory = {
  externalId: 'LOGIN-7',
  title: 'Account lockout',
  description: 'Protect accounts from brute force',
  acceptanceCriteria: [{ id: 'AC-LOGIN-04', text: 'After multiple failed logins the user is locked out.' }],
};

beforeAll(async () => {
  db = await createTestDb();
  await seedProject(db, { tenantId: 't', projectId: 'p' });
  await seedProject(db, { tenantId: 't2', projectId: 'q' });
  const provider = new ClaudeProvider({
    client: createAnthropicClient({ apiKey: 'test', fetch: fakeFetch }),
  });
  app = await buildApp({ deps: { db, classifier: provider, generator: provider }, rateLimitPerMinute: 1000 });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('auth', () => {
  it('rejects missing and unknown API keys; health is public', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/reviews' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/reviews', headers: { 'x-api-key': 'nope' } })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('ignores roles supplied in the request body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/ingestions',
      headers: key('qa'),
      payload: { meta: meta('X-1'), content: '# X\nbody', roles: ['ADMIN'] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('MVP flow over HTTP (docs/03 lockout example)', () => {
  it('ambiguous AC -> clarification -> PO answer -> re-run -> draft -> approve; usage audited', async () => {
    // Approved policy exists but has no numeric limit.
    let res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/ingestions',
      headers: key('po'),
      payload: {
        meta: meta('POLICY-LOGIN'),
        content: '# AC-LOGIN-04\nAccounts are locked after failed login attempts.',
      },
    });
    expect(res.statusCode).toBe(201);

    res = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: key('qa'),
      payload: lockoutStory,
    });
    expect(res.statusCode).toBe(201);
    const first = res.json();
    expect(first.outcome).toMatchObject({ route: 'REVIEW_REQUESTED', kind: 'REQUIREMENT_CLARIFICATION' });
    expect(res.headers['x-correlation-id']).toBe(first.correlationId);

    // Same story again: deduplicated, 200.
    res = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: key('qa'),
      payload: lockoutStory,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflowId).toBe(first.workflowId);

    // PO sees it in their queue with the question and source references.
    res = await app.inject({ method: 'GET', url: '/api/reviews?mine=true&status=OPEN', headers: key('po') });
    const item = res.json().items.find((r: { id: string }) => r.id === first.outcome.reviewId);
    expect(item).toMatchObject({ assignedRole: 'PRODUCT_OWNER', sourceRefs: ['POLICY-LOGIN@v1'] });
    expect(item.question).toMatch(/AC-LOGIN-04/);

    // PO answers authoritatively -> new source version -> story re-runs to a draft.
    res = await app.inject({
      method: 'POST',
      url: `/api/reviews/${first.outcome.reviewId}/resolve`,
      headers: key('po'),
      payload: {
        action: 'APPROVE',
        reason: 'Security policy SP-3',
        publishSource: {
          sourceId: 'CLAR-LOGIN-LOCKOUT',
          version: 'v1',
          content: '# AC-LOGIN-04\nLock after 5 consecutive failed logins; lock lasts 15 minutes.',
          ruleKeys: ['login.lockout'],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const resolved = res.json();
    expect(resolved.rerun.outcome).toMatchObject({ route: 'DRAFT_CREATED' });
    expect(resolved.rerun.outcome.sourceRefs).toContain('CLAR-LOGIN-LOCKOUT@v1');
    const caseId = resolved.rerun.outcome.caseId;

    // QA approves the draft; it becomes an approved definition (not a pass).
    res = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${caseId}/review`,
      headers: key('qa'),
      payload: { decision: 'APPROVE' },
    });
    expect(res.json()).toMatchObject({ status: 'APPROVED', revision: 1 });

    // Usage/audit is lead-only.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/workflows/${resolved.rerun.workflowId}/usage`,
          headers: key('qa'),
        })
      ).statusCode,
    ).toBe(403);
    res = await app.inject({
      method: 'GET',
      url: `/api/workflows/${resolved.rerun.workflowId}/usage`,
      headers: key('lead'),
    });
    const usage = res.json();
    expect(usage.decisions.map((d: { kind: string }) => d.kind)).toEqual(['readiness', 'draft']);
    expect(usage.decisions[0].sourceRefs).toEqual(expect.arrayContaining(['CLAR-LOGIN-LOCKOUT@v1']));
    expect(usage.policyEvaluations[0]).toMatchObject({
      gate: 'AUTO_PROCEED',
      policyVersion: expect.any(String),
    });
  });
});

describe('validation, isolation and idempotency', () => {
  it('returns 400 for malformed bodies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers: key('qa'),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('another tenant cannot read reviews, workflows or test cases', async () => {
    const own = await app.inject({ method: 'GET', url: '/api/reviews', headers: key('po') });
    const reviewId = own.json().items[0].id;
    const otherKey = { 'x-api-key': 'key-q-lead' };
    expect(
      (await app.inject({ method: 'GET', url: `/api/reviews/${reviewId}`, headers: otherKey })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/reviews', headers: otherKey })).json().items,
    ).toEqual([]);
  });

  it('the AI agent key cannot resolve reviews or submit stories', async () => {
    const own = await app.inject({ method: 'GET', url: '/api/reviews', headers: key('po') });
    const reviewId = own.json().items[0].id;
    const agent = { 'x-api-key': 'key-p-agent' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/reviews/${reviewId}/resolve`,
          headers: agent,
          payload: { action: 'ASSIGN' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/stories', headers: agent, payload: lockoutStory }))
        .statusCode,
    ).toBe(403);
  });

  it('an explicit Idempotency-Key returns the same workflow without new model calls', async () => {
    const payload = { ...lockoutStory, externalId: 'LOGIN-IDEM' };
    const headers = { ...key('qa'), 'idempotency-key': 'client-key-1' };
    const before = fakeFetch.calls.length;
    const a = await app.inject({ method: 'POST', url: '/api/stories', headers, payload });
    const callsAfterFirst = fakeFetch.calls.length;
    const b = await app.inject({ method: 'POST', url: '/api/stories', headers, payload });
    expect(b.json().workflowId).toBe(a.json().workflowId);
    expect(b.json().deduplicated).toBe(true);
    expect(fakeFetch.calls.length).toBe(callsAfterFirst);
    expect(callsAfterFirst).toBeGreaterThan(before);
  });
});
