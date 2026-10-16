import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestCase, createTestDb, seedProject, type Db, type SeededActors } from '@qa/db';
import { buildApp } from '../src/app.ts';

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let app: FastifyInstance;
let a: SeededActors;

const call = async (actor: string, method: 'GET' | 'POST', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers: { 'x-api-key': `key-p-${actor}` }, payload });
  return { status: res.statusCode, body: res.json() };
};

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

describe('suites over HTTP', () => {
  it('creates a suite, adds a manual case, runs it and reports the case as not automated', async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_api','t','p','API-1',1,'t','d','[]','x')`,
    );
    const c = await createTestCase(db, S, {
      storyId: 'story_api',
      workflowId: null,
      content: {
        title: 'Manual check',
        priority: 'P2',
        preconditions: [],
        testData: [],
        steps: [],
        assumptions: [],
        missingRequirements: [],
      },
      sourceRefs: ['AC-1@v1'],
      authorId: a.agent.id,
    });
    expect((await call('po', 'POST', '/api/suites', { name: 'Nope' })).status).toBe(403);
    expect((await call('qa', 'POST', '/api/suites', { name: '' })).status).toBe(400);

    const suite = await call('qa', 'POST', '/api/suites', { name: 'Smoke', description: 'Daily' });
    expect(suite.status).toBe(201);
    const added = await call('qa', 'POST', `/api/suites/${suite.body.id}/cases`, {
      cases: [{ caseId: c.caseId, section: 'Basics' }],
    });
    expect(added.body.cases).toMatchObject([{ title: 'Manual check', section: 'Basics', automated: false }]);
    expect((await call('qa', 'GET', '/api/suites')).body.items).toMatchObject([
      { name: 'Smoke', caseCount: 1 },
    ]);

    const run = await call('qa', 'POST', `/api/suites/${suite.body.id}/runs`, { environmentId: 'staging' });
    expect(run.status).toBe(202);
    expect(run.body.totals).toMatchObject({ cases: 1, notApproved: 1 });
    const report = await call('lead', 'GET', `/api/suite-runs/${run.body.id}`);
    expect(report.body).toMatchObject({ complete: true, items: [{ status: 'NOT_APPROVED', runId: null }] });
    expect((await call('qa', 'GET', '/api/suite-runs/suiterun_missing')).status).toBe(404);
  });
});
