import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDemoApp } from '@qa/demo-sut';
import { deleteAccountSpec, lockoutSpec, loginInvalidSpec, loginValidSpec } from '@qa/demo-sut/specs';
import { deriveValue, ExecutableSpec, newId, type ExecutableSpecInput } from '@qa/domain';
import { LocalEvidenceStore, type EvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor, type ExecuteInput } from '../src/index.ts';

// Real browser against the real demo app. Locally, QA_BROWSER_CHANNEL=chrome|msedge reuses an
// installed browser; CI installs Playwright's chromium.
const executor = new PlaywrightExecutor({
  channel: process.env.QA_BROWSER_CHANNEL || undefined,
  stepTimeoutMs: 3000,
});
const PASSWORD = 'correct-horse-battery-staple';
const scope = { tenantId: 't', projectId: 'p' };

let dir: string;
let store: LocalEvidenceStore;
const apps: Array<{ close: () => Promise<unknown> }> = [];

async function demo(opts: Parameters<typeof startDemoApp>[0] = {}) {
  const { app, baseUrl } = await startDemoApp({
    user: { email: 'qa@example.test', password: PASSWORD, name: 'QA Tester' },
    ...opts,
  });
  apps.push(app);
  return { baseUrl, target: { baseUrl, allowedHosts: [new URL(baseUrl).host] } };
}

function input(
  spec: ExecutableSpecInput,
  target: ExecuteInput['target'],
  extra: Partial<ExecuteInput> = {},
): ExecuteInput {
  return {
    runId: newId('run'),
    scope,
    spec: ExecutableSpec.parse(spec),
    target,
    secrets: (name) => (name === 'DEMO_PASSWORD' ? PASSWORD : undefined),
    store,
    ...extra,
  };
}

const read = async (objectKey: string) => (await store.get(objectKey))!.toString();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-exec-'));
  store = new LocalEvidenceStore(dir);
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await rm(dir, { recursive: true, force: true });
});

describe('PlaywrightExecutor against the demo app', () => {
  it('PASSED: valid login, with screenshots, step and network logs; tracker blocked; secret never stored', async () => {
    const { target } = await demo();
    const out = await executor.execute(input(loginValidSpec, target));
    expect(out).toMatchObject({ verdict: 'PASSED', reason: 'ALL_ASSERTIONS_PASSED', cleanupFailed: false });
    expect(out.assertions.map((a) => [a.stepId, a.passed])).toEqual([
      ['on-dashboard', true],
      ['welcome', true],
      ['reset', true],
    ]);
    expect(out.blockedRequests).toEqual(['https://tracker.example.invalid/pixel.gif']);
    expect(out.evidence.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['screenshot', 'step-log', 'network-log']),
    );
    const logs = await Promise.all(
      out.evidence.filter((e) => e.kind !== 'screenshot').map((e) => read(e.objectKey)),
    );
    for (const log of logs) expect(log).not.toContain(PASSWORD);
    expect(logs.join()).toContain('[secret:DEMO_PASSWORD]');
    const shot = out.evidence.find((e) => e.kind === 'screenshot')!;
    expect((await readFile(join(dir, shot.objectKey))).subarray(1, 4).toString()).toBe('PNG');
  });

  it('FAILED: BUG-1042 regression is observed with expected vs actual', async () => {
    const { target } = await demo({ bugUserNotFoundMessage: true });
    const out = await executor.execute(input(loginInvalidSpec, target));
    expect(out).toMatchObject({ verdict: 'FAILED', reason: 'ASSERTION_FAILED:message' });
    expect(out.assertions[0]).toEqual({
      stepId: 'message',
      name: 'expectText',
      expected: 'Invalid email or password',
      actual: 'User not found',
      passed: false,
    });
    // Stops at the first failure, then still cleans up.
    expect(out.steps.find((s) => s.id === 'stays-on-login')?.status).toBe('skipped');
    expect(out.steps.find((s) => s.id === 'reset')?.status).toBe('passed');
  });

  it('PASSED: mixed API + UI lockout after 5 consecutive failures', async () => {
    const { target } = await demo();
    const out = await executor.execute(input(lockoutSpec, target));
    expect(out.verdict).toBe('PASSED');
    expect(
      out.assertions
        .filter((a) => a.name === 'apiRequest')
        .every((a) => a.actual === 401 || a.actual === 200),
    ).toBe(true);
  });

  it('INCONCLUSIVE: an element that cannot be found is "not evaluated", not a product failure', async () => {
    const { target } = await demo();
    const spec = {
      steps: [
        { id: 'open', type: 'navigate', path: '/login' },
        { id: 'ghost', type: 'expectText', target: { by: 'testId', testId: 'does-not-exist' }, text: 'x' },
      ],
      teardown: loginValidSpec.teardown,
    } satisfies ExecutableSpecInput;
    const out = await executor.execute(input(spec, target));
    expect(out).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'ASSERTION_NOT_EVALUATED:ghost' });
    expect(out.assertions[0]).toMatchObject({ actual: null, passed: null });
  });

  it('INCONCLUSIVE: ambiguous locators are never guessed (strict mode)', async () => {
    const { target } = await demo();
    const spec = {
      steps: [
        { id: 'open', type: 'navigate', path: '/login' },
        { id: 'ambiguous', type: 'click', target: { by: 'role', role: 'textbox' } },
        { id: 'check', type: 'expectUrl', path: '/login' },
      ],
    } satisfies ExecutableSpecInput;
    const out = await executor.execute(input(spec, target));
    expect(out).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'STEP_ERROR:ambiguous' });
    expect(out.steps.find((s) => s.id === 'ambiguous')?.error).toMatch(/strict mode/);
  });

  it('INCONCLUSIVE before launching a browser when a secret is missing or the base URL is not allowlisted', async () => {
    const { target } = await demo();
    expect(await executor.execute(input(loginValidSpec, target, { secrets: () => undefined }))).toMatchObject(
      {
        verdict: 'INCONCLUSIVE',
        reason: 'MISSING_SECRET:DEMO_PASSWORD',
        steps: [],
      },
    );
    expect(
      await executor.execute(input(loginValidSpec, { ...target, allowedHosts: ['other.test'] })),
    ).toMatchObject({
      reason: 'BASE_URL_NOT_ALLOWLISTED',
    });
  });

  it('INCONCLUSIVE when mandatory evidence cannot be stored', async () => {
    const { target } = await demo();
    const broken: EvidenceStore = {
      put: async () => {
        throw new Error('disk full');
      },
      get: async () => null,
      delete: async () => undefined,
    };
    const out = await executor.execute(input(loginValidSpec, target, { store: broken }));
    expect(out).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'EVIDENCE_UNAVAILABLE' });
  });

  it('a failing teardown is reported without changing the observed verdict', async () => {
    const { target } = await demo();
    const spec = {
      ...loginValidSpec,
      teardown: [
        { id: 'bad-cleanup', type: 'navigate', path: '/login' },
        { id: 'cleanup-click', type: 'click', target: { by: 'testId', testId: 'nope' } },
      ],
    } as ExecutableSpecInput;
    const out = await executor.execute(input(spec, target));
    expect(out).toMatchObject({ verdict: 'PASSED', cleanupFailed: true });
  });

  it('executes destructive steps only as written (approval is enforced by policy before execution)', async () => {
    const { target } = await demo();
    const out = await executor.execute(input(deleteAccountSpec, target));
    expect(out.verdict).toBe('PASSED');
  });
});

describe('PlaywrightExecutor locale', () => {
  // Apps that localize from Accept-Language must see the same language on every machine.
  it('pins the browser locale (en-US by default, overridable)', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<main><p>${String(req.headers['accept-language'] ?? '').split(',')[0]}</p></main>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apps.push({ close: () => new Promise((r) => server.close(r)) });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const target = { baseUrl, allowedHosts: [new URL(baseUrl).host] };
    const languageIs = (lang: string): ExecutableSpecInput => ({
      steps: [
        { id: 'open', type: 'navigate', path: '/' },
        { id: 'lang', type: 'expectText', target: { by: 'role', role: 'main' }, text: lang, match: 'exact' },
      ],
    });
    expect((await executor.execute(input(languageIs('en-US'), target))).verdict).toBe('PASSED');
    const vietnamese = new PlaywrightExecutor({
      channel: process.env.QA_BROWSER_CHANNEL || undefined,
      stepTimeoutMs: 3000,
      locale: 'vi-VN',
    });
    expect((await vietnamese.execute(input(languageIs('vi-VN'), target))).verdict).toBe('PASSED');
  });
});

describe('PlaywrightExecutor redirects', () => {
  // A route that redirects after loading (like Gym CRM's /finance -> /finance/payments) must still
  // pass. This does not reliably reproduce the screenshot-vs-redirect race fixed in the executor (the
  // window is too narrow to hit on demand); the showcase's /finance run is the regression check.
  it('a navigation that redirects after load still passes', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        req.url === '/start'
          ? `<main>start</main><script>addEventListener('load', () => setTimeout(() => location.replace('/done'), 0))</script>`
          : `<main><p>arrived</p></main>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apps.push({ close: () => new Promise((r) => server.close(r)) });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const target = { baseUrl, allowedHosts: [new URL(baseUrl).host] };
    const spec: ExecutableSpecInput = {
      steps: [
        { id: 'open', type: 'navigate', path: '/start' },
        { id: 'arrived', type: 'expectText', target: { by: 'role', role: 'main' }, text: 'arrived' },
      ],
    };
    const out = await executor.execute(input(spec, target));
    expect(out, JSON.stringify(out.steps.map((s) => s.error).filter(Boolean))).toMatchObject({
      verdict: 'PASSED',
    });
  });
});

describe('PlaywrightExecutor run-scoped values (ADR-0015)', () => {
  it('derives a date once, captures from text and URL, and fills templates with both', async () => {
    const { target } = await demo();
    const errors = (out: Awaited<ReturnType<typeof executor.execute>>) =>
      JSON.stringify(out.steps.map((s) => s.error ?? s.note).filter(Boolean));
    const spec: ExecutableSpecInput = {
      values: { in_30: { date: { offsetDays: 30, format: 'dd/MM/yyyy', timeZone: 'Asia/Ho_Chi_Minh' } } },
      steps: [
        { id: 'open-login', type: 'navigate', path: '/login' },
        { id: 'email', type: 'fill', target: { by: 'label', label: 'Email' }, value: 'qa@example.test' },
        {
          id: 'password',
          type: 'fill',
          target: { by: 'label', label: 'Password' },
          value: { secret: 'DEMO_PASSWORD' },
        },
        { id: 'sign-in', type: 'click', target: { by: 'role', role: 'button', name: 'Sign in' } },
        { id: 'page', type: 'capture', as: 'page', from: { kind: 'url' }, pattern: '/([a-z]+)$' },
        {
          id: 'who',
          type: 'capture',
          as: 'who',
          from: { kind: 'text', target: { by: 'testId', testId: 'welcome' } },
          pattern: 'Welcome back, (.+)',
        },
        { id: 'back', type: 'navigate', path: '/{{page}}' },
        {
          id: 'greets',
          type: 'expectText',
          target: { by: 'testId', testId: 'welcome' },
          text: 'back, {{who}}',
        },
        { id: 'echo-date', type: 'navigate', path: '/echo?q={{in_30}}' },
        {
          id: 'date-shown',
          type: 'expectText',
          target: { by: 'testId', testId: 'echo' },
          text: '{{in_30}}',
          match: 'exact',
        },
      ],
    };
    const out = await executor.execute(input(spec, target));
    expect(out, errors(out)).toMatchObject({ verdict: 'PASSED' });
    const expected = deriveValue(
      { date: { offsetDays: 30, format: 'dd/MM/yyyy', timeZone: 'Asia/Ho_Chi_Minh' } },
      new Date(),
    );
    expect(out.assertions.find((a) => a.stepId === 'date-shown')).toMatchObject({
      expected,
      actual: expected,
      passed: true,
    });
    expect(out.steps.find((s) => s.id === 'who')?.note).toBe('who = "QA Tester"');
    expect(out.steps.find((s) => s.id === 'page')?.note).toBe('page = "dashboard"');
  });

  it('a capture whose pattern does not match is a step error (INCONCLUSIVE), not a failure', async () => {
    const { target } = await demo();
    const spec: ExecutableSpecInput = {
      steps: [
        { id: 'open-login', type: 'navigate', path: '/login' },
        { id: 'id', type: 'capture', as: 'id', from: { kind: 'url' }, pattern: '/customers/(\\d+)' },
        { id: 'reopen', type: 'navigate', path: '/customers/{{id}}' },
        { id: 'ok', type: 'expectVisible', target: { by: 'role', role: 'heading', name: 'Sign in' } },
      ],
    };
    const out = await executor.execute(input(spec, target));
    expect(out).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'STEP_ERROR:id' });
    expect(out.steps.find((s) => s.id === 'id')?.error).toContain('did not match url');
    expect(out.steps.find((s) => s.id === 'reopen')?.status).toBe('skipped');
  });
});
