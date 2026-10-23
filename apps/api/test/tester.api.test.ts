import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestCase, createTestDb, seedProject, type Db, type SeededActors } from '@qa/db';
import { buildApp } from '../src/app.ts';

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let app: FastifyInstance;
let a: SeededActors;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  const unused = async () => {
    throw new Error('no model calls in this test');
  };
  app = await buildApp({
    deps: { db, classifier: { classify: unused }, generator: { generate: unused } },
    rateLimitPerMinute: 1000,
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('the tester screen (ADR-0019)', () => {
  it('serves the page and its script without a key, with a strict CSP, and nothing else without one', async () => {
    const page = await app.inject({ method: 'GET', url: '/tester' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body).toContain('<script src="/tester/app.js">');
    expect(page.body).not.toMatch(/<script>[^<]/); // no inline script: the CSP would block it anyway

    const script = await app.inject({ method: 'GET', url: '/tester/app.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body).toContain("'/api/manual-runs'");

    expect((await app.inject({ method: 'GET', url: '/tester/../api/suites' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/suites' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/testerx' })).statusCode).toBe(401);
  });

  it("lists a suite's runs with the manual backlog, newest first", async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_t','t','p','T-1',1,'t','d','[]','x')`,
    );
    const c = await createTestCase(db, S, {
      storyId: 'story_t',
      workflowId: null,
      content: {
        title: 'By hand',
        priority: 'P2',
        preconditions: [],
        testData: [],
        steps: [{ action: 'Do', expected: 'See "ok"', sourceRefs: ['AC-1@v1'] }],
        assumptions: [],
        missingRequirements: [],
      },
      sourceRefs: ['AC-1@v1'],
      authorId: a.agent.id,
    });
    const call = (actor: string, method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: { 'x-api-key': `key-p-${actor}` }, payload });
    await call('qa', 'POST', `/api/test-cases/${c.caseId}/review`, { decision: 'APPROVE' });
    const suite = (await call('qa', 'POST', '/api/suites', { name: 'Hand run' })).json();
    await call('qa', 'POST', `/api/suites/${suite.id}/cases`, { cases: [{ caseId: c.caseId }] });
    const first = (
      await call('qa', 'POST', `/api/suites/${suite.id}/runs`, { environmentId: 'staging' })
    ).json();
    const second = (
      await call('qa', 'POST', `/api/suites/${suite.id}/runs`, { environmentId: 'staging' })
    ).json();
    await call('qa', 'POST', '/api/manual-runs', {
      caseId: c.caseId,
      environmentId: 'staging',
      suiteRunId: second.id,
      steps: [{ status: 'PASSED', actual: '' }],
    });
    const runs = (await call('lead', 'GET', `/api/suites/${suite.id}/runs`)).json();
    expect(
      runs.items.map((r: { id: string; manualPending: number; manualRecorded: number }) => [
        r.id,
        r.manualPending,
        r.manualRecorded,
      ]),
    ).toEqual([
      [second.id, 0, 1],
      [first.id, 1, 0],
    ]);
    expect((await call('qa', 'GET', '/api/suites/suite_none/runs')).statusCode).toBe(404);
  });
});
