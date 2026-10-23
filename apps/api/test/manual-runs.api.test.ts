import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestCase, createTestDb, seedProject, type Db, type SeededActors } from '@qa/db';
import { LocalEvidenceStore } from '@qa/evidence';
import { buildApp } from '../src/app.ts';

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let app: FastifyInstance;
let a: SeededActors;
let dir: string;

const call = async (actor: string, method: 'GET' | 'POST', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers: { 'x-api-key': `key-p-${actor}` }, payload });
  const json = () => {
    try {
      return res.json();
    } catch {
      return undefined; // a served file, not JSON
    }
  };
  return { status: res.statusCode, body: json(), raw: res.rawPayload };
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedProject(db, S);
  dir = await mkdtemp(join(tmpdir(), 'qa-manual-api-'));
  const unused = async () => {
    throw new Error('no model calls in this test');
  };
  app = await buildApp({
    deps: { db, classifier: { classify: unused }, generator: { generate: unused } },
    evidenceStore: new LocalEvidenceStore(dir),
    rateLimitPerMinute: 1000,
  });
});
afterAll(async () => {
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('manual runs over HTTP', () => {
  it('a tester records a run, attaches a screenshot, and the evidence is served back; the agent is refused', async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_mr','t','p','MR-1',1,'t','d','[]','x')`,
    );
    const c = await createTestCase(db, S, {
      storyId: 'story_mr',
      workflowId: null,
      content: {
        title: 'Lead with a duplicate phone',
        priority: 'P1',
        preconditions: [],
        testData: [],
        steps: [
          { action: 'Open Thêm lead', expected: 'The dialog "Thêm lead" is shown', sourceRefs: ['AC-1@v1'] },
          {
            action: 'Save with phone 0909123456',
            expected: 'Dialog "Số điện thoại đã có hồ sơ"',
            sourceRefs: ['AC-1@v1'],
          },
        ],
        assumptions: [],
        missingRequirements: [],
      },
      sourceRefs: ['AC-1@v1'],
      authorId: a.agent.id,
    });
    expect(
      (await call('qa', 'POST', `/api/test-cases/${c.caseId}/review`, { decision: 'APPROVE' })).status,
    ).toBe(200);

    const body = {
      caseId: c.caseId,
      environmentId: 'staging',
      build: 'c65902a',
      steps: [
        { status: 'PASSED', actual: '' },
        { status: 'FAILED', actual: 'No dialog; a second lead was created' },
      ],
      defectRef: 'BUG-006',
    };
    expect((await call('agent', 'POST', '/api/manual-runs', body)).status).toBe(403);
    expect((await call('qa', 'POST', '/api/manual-runs', { ...body, steps: [body.steps[0]] })).status).toBe(
      400,
    );

    const recorded = await call('qa', 'POST', '/api/manual-runs', body);
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({
      status: 'FAILED',
      failedStep: 2,
      build: 'c65902a',
      testerId: a.qa.id,
    });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const upload = await call('qa', 'POST', `/api/manual-runs/${recorded.body.id}/evidence`, {
      name: 'duplicate-lead.png',
      contentType: 'image/png',
      dataBase64: png.toString('base64'),
    });
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({ name: 'duplicate-lead.png', sizeBytes: 6 });

    const detail = await call('lead', 'GET', `/api/manual-runs/${recorded.body.id}`);
    expect(detail.body.evidence).toMatchObject([{ id: upload.body.id, contentType: 'image/png' }]);
    const served = await call('lead', 'GET', `/api/evidence/${upload.body.id}`);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.raw)).toEqual(png);
    expect((await call('agent', 'GET', `/api/evidence/${upload.body.id}`)).status).toBe(403);

    const history = await call('qa', 'GET', `/api/test-cases/${c.caseId}/manual-runs`);
    expect(history.body.items).toHaveLength(1);
  });
});
