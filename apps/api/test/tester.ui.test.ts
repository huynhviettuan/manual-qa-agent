import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser } from 'playwright';
import { createTestCase, createTestDb, seedProject, type Db, type SeededActors } from '@qa/db';
import { buildApp } from '../src/app.ts';

// A real browser drives the tester screen against the real API (ADR-0019): sign in with a key,
// open a suite run, record a manual result step by step, and see the derived status.

const S = { tenantId: 't', projectId: 'p' };
let db: Db;
let app: FastifyInstance;
let a: SeededActors;
let browser: Browser;
let baseUrl: string;

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
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined, headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app.close();
  await db.close();
});

describe('tester screen in a browser', () => {
  it('records a failed step through the form and shows the status the server derived', async () => {
    await db.query(
      `INSERT INTO stories (id, tenant_id, project_id, external_id, version, title, description, acceptance_criteria, created_by)
       VALUES ('story_ui','t','p','UI-1',1,'t','d','[]','x')`,
    );
    const c = await createTestCase(db, S, {
      storyId: 'story_ui',
      workflowId: null,
      content: {
        title: 'Contract with 1001 sessions',
        priority: 'P1',
        preconditions: ['Signed in as consulting'],
        testData: [],
        steps: [
          {
            action: 'Open the new contract form',
            expected: 'Heading "Thêm hợp đồng"',
            sourceRefs: ['BR-301@v1'],
          },
          {
            action: 'Type 1001 sessions',
            expected: 'Message "Tối đa 1000 buổi"',
            sourceRefs: ['BR-301@v1'],
            testData: 'sessions = 1001',
          },
        ],
        assumptions: [],
        missingRequirements: [],
        module: 'Contracts',
        level: 'manual',
        manualReason: 'Price preview needs a human eye',
      },
      sourceRefs: ['BR-301@v1'],
      authorId: a.agent.id,
    });
    const call = (actor: string, method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: { 'x-api-key': `key-p-${actor}` }, payload });
    await call('qa', 'POST', `/api/test-cases/${c.caseId}/review`, { decision: 'APPROVE' });
    const suite = (await call('qa', 'POST', '/api/suites', { name: 'UI suite' })).json();
    await call('qa', 'POST', `/api/suites/${suite.id}/cases`, {
      cases: [{ caseId: c.caseId, section: 'Contracts' }],
    });
    const run = (
      await call('qa', 'POST', `/api/suites/${suite.id}/runs`, { environmentId: 'staging' })
    ).json();

    const context = await browser.newContext({ baseURL: baseUrl, locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('/tester');
    const main = page.getByRole('main');
    await main.getByLabel('API key', { exact: true }).fill('key-p-qa');
    await main.getByRole('button', { name: 'Continue' }).click();

    await expect.poll(() => page.locator('#who').textContent()).toContain('QA_ENGINEER');
    await main.getByRole('link', { name: run.id }).click();
    await expect.poll(() => main.getByRole('heading', { name: `Suite run ${run.id}` }).count()).toBe(1);
    await main.getByRole('link', { name: 'Contract with 1001 sessions' }).click();
    await expect
      .poll(() => main.getByRole('heading', { name: 'Contract with 1001 sessions' }).count())
      .toBe(1);
    expect(await main.getByText('Data: sessions = 1001').count()).toBe(1);

    const form = main.locator('#runform');
    await expect.poll(() => form.locator('#env').inputValue()).toBe('staging');
    await form.locator('#build').fill('a981386');
    await form.locator('input[name="s1"][value="FAILED"]').check();
    await form.locator('#a1').fill('Shows the raw "Too big: expected number to be <=1000"');
    await form.locator('#defect').fill('BUG-025');
    await form.getByRole('button', { name: 'Record result' }).click();

    await expect
      .poll(() => main.locator('#result .ok').textContent())
      .toContain('Recorded as FAILED at step 2');
    await expect.poll(() => main.locator('#history tbody tr').count()).toBe(1);
    expect(await main.locator('#history tbody tr').first().textContent()).toContain('a981386');

    const rows = await db.query<{
      status: string;
      failed_step: number;
      tester_id: string;
      suite_run_id: string;
    }>(`SELECT status, failed_step, tester_id, suite_run_id FROM manual_runs WHERE case_id = $1`, [c.caseId]);
    expect(rows).toEqual([{ status: 'FAILED', failed_step: 2, tester_id: a.qa.id, suite_run_id: run.id }]);

    // Back on the suite run, the manual result sits beside the automated columns.
    await page.goto(`/tester#/suite-runs/${run.id}`);
    await expect.poll(() => main.locator('tbody .pill.FAILED').count()).toBe(1);
    await context.close();
  }, 60_000);

  it('reviews a draft: sharpens an expected result in the edit form, then approves the new revision', async () => {
    const draft = await createTestCase(db, S, {
      storyId: 'story_ui',
      workflowId: null,
      content: {
        title: 'Lead without a channel',
        priority: 'P2',
        preconditions: [],
        testData: [],
        steps: [
          { action: 'Save a lead with no channel', expected: 'An error is shown', sourceRefs: ['BR-201@v1'] },
        ],
        assumptions: [],
        missingRequirements: [],
        reviewFlags: ['step 1: no exact message, value or state in "An error is shown"'],
      },
      sourceRefs: ['BR-201@v1'],
      authorId: a.agent.id,
    });
    const context = await browser.newContext({ baseURL: baseUrl, locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('/tester');
    const main = page.getByRole('main');
    await main.getByLabel('API key', { exact: true }).fill('key-p-qa');
    await main.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => page.locator('#who').textContent()).toContain('QA_ENGINEER');

    await page.goto('/tester#/drafts');
    await main.getByRole('link', { name: 'Lead without a channel' }).click();
    await expect.poll(() => main.locator('.flag').count()).toBeGreaterThanOrEqual(1);
    await main.getByRole('button', { name: 'Edit…' }).click();
    await main.locator('#s-expected-0').fill('The field shows "Bắt buộc nhập." and no lead is created');
    await main.locator('#e-note').fill('Exact message from BR-201');
    await main.getByRole('button', { name: 'Save revision' }).click();
    await expect.poll(() => main.locator('#edit-result .ok').textContent()).toContain('Saved revision 2');

    await expect.poll(() => main.getByRole('button', { name: 'Approve' }).count()).toBe(1);
    await main.getByRole('button', { name: 'Approve' }).click();
    await expect.poll(() => main.locator('#decision .ok').textContent()).toContain('is now APPROVED');

    const rows = await db.query<{
      revision: number;
      status: string;
      content: { steps: Array<{ expected: string }> };
    }>(`SELECT revision, status, content FROM test_case_revisions WHERE case_id = $1 ORDER BY revision`, [
      draft.caseId,
    ]);
    expect(rows.map((r) => [r.revision, r.status])).toEqual([
      [1, 'DRAFT'],
      [2, 'APPROVED'],
    ]);
    expect(rows[1]!.content.steps[0]!.expected).toBe(
      'The field shows "Bắt buộc nhập." and no lead is created',
    );
    await context.close();
  }, 60_000);
});
