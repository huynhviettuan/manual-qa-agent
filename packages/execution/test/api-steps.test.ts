import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecutableSpec, type ExecutableSpecInput } from '@qa/domain';
import { LocalEvidenceStore } from '@qa/evidence';
import { PlaywrightExecutor, totpCode, type ExecutionTarget } from '../src/index.ts';

// ADR-0024: testing through the API (sessions, JSON checks, response captures), data rows,
// bounded waits, keys, uploads and downloads, against a small fake product.

const scope = { tenantId: 't', projectId: 'p' };
let dir: string;
let store: LocalEvidenceStore;
let target: ExecutionTarget;
let close: () => Promise<unknown>;
let n = 0;
const executor = new PlaywrightExecutor({
  channel: process.env.QA_BROWSER_CHANNEL || undefined,
  stepTimeoutMs: 3000,
});
const run = (spec: ExecutableSpecInput, secrets: Record<string, string> = {}) =>
  executor.execute({
    runId: `run_api_${++n}`,
    scope,
    spec: ExecutableSpec.parse(spec),
    target,
    secrets: (name) => secrets[name],
    store,
  });

// A fake product: cookie sessions per role, a counter that becomes ready after a few polls, a
// bearer-token sign-in, a form with a file input and a download.
const state = { sessions: new Map<string, string>(), polls: 0, uploaded: '' };
const page = `<main>
  <h1>Fake product</h1>
  <input type="text" id="q" aria-label="Search">
  <p role="status" id="out"></p>
  <input type="file" aria-label="Attachment" onchange="document.getElementById('out').textContent='picked ' + this.files[0].name">
  <a role="link" href="/export.csv" download="customers.csv">Export</a>
  <script>document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('out').textContent = 'searched ' + e.target.value; });
  setTimeout(() => { document.getElementById('out').textContent = 'ready after a while'; }, 800);</script>
</main>`;
function handle(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const cookie = /sid=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const role = cookie ? state.sessions.get(cookie) : undefined;
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/api/login' && req.method === 'POST') {
      if (body.password !== 'pw-secret-1') return json(401, { code: 'INVALID_EMAIL_OR_PASSWORD' });
      const sid = `s${state.sessions.size + 1}x`;
      state.sessions.set(sid, body.email === 'admin@x.test' ? 'admin' : 'receptionist');
      return json(
        200,
        { user: { email: body.email, role: state.sessions.get(sid) } },
        { 'set-cookie': `sid=${sid}; Path=/` },
      );
    }
    if (req.url === '/api/token' && req.method === 'POST') return json(200, { token: 'tok-123' });
    if (req.url === '/api/me') {
      if (bearer === 'tok-123') return json(200, { role: 'api-client' });
      return role
        ? json(200, { role, debt: 0, items: [{ id: 'c-7' }] })
        : json(401, { code: 'UNAUTHENTICATED' });
    }
    if (req.url === '/api/admin/users')
      return role === 'admin' ? json(200, { count: 3 }) : json(403, { code: 'FORBIDDEN' });
    if (req.url === '/api/job') return json(200, { status: ++state.polls >= 3 ? 'done' : 'running' });
    if (req.url === '/api/never') return json(200, { status: 'running' });
    if (req.url === '/export.csv') {
      res.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="customers.csv"',
      });
      return res.end('id,name\r\n1,A\r\n');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-api-'));
  store = new LocalEvidenceStore(dir);
  const server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => new Promise((r) => server.close(r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  target = { baseUrl, allowedHosts: [new URL(baseUrl).host] };
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const signIn = (name: string, email: string) =>
  ({
    id: `login-${name}`,
    type: 'session',
    name,
    method: 'POST',
    path: '/api/login',
    body: { email, password: { secret: 'PW' } },
  }) as const;

describe('API steps (ADR-0024)', () => {
  it('signs in as two roles, checks JSON values, captures from a response and keeps the secret out of evidence', async () => {
    const out = await run(
      {
        steps: [
          signIn('reception', 'r@x.test'),
          signIn('admin', 'admin@x.test'),
          {
            id: 'me',
            type: 'apiRequest',
            method: 'GET',
            path: '/api/me',
            session: 'reception',
            expectStatus: 200,
            expectJson: [
              { path: 'role', equals: 'receptionist' },
              { path: 'debt', equals: '0' },
              { path: 'items[0].id', matches: '^c-' },
              { path: 'missing', exists: false },
            ],
          },
          {
            id: 'cap',
            type: 'capture',
            as: 'first',
            from: { kind: 'response', step: 'me', path: 'items[0].id' },
          },
          {
            id: 'refused',
            type: 'apiRequest',
            method: 'GET',
            path: '/api/admin/users',
            session: 'reception',
            expectStatus: 403,
            expectJson: [{ path: 'code', equals: 'FORBIDDEN' }],
          },
          {
            id: 'allowed',
            type: 'apiRequest',
            method: 'GET',
            path: '/api/admin/users',
            session: 'admin',
            expectStatus: 200,
            expectJson: [{ path: 'count', equals: '3' }],
          },
          { id: 'anon', type: 'apiRequest', method: 'GET', path: '/api/me', expectStatus: 401 },
          { id: 'open', type: 'navigate', path: '/' },
          { id: 'shown', type: 'expectText', target: { by: 'role', role: 'heading' }, text: 'Fake product' },
          {
            id: 'used',
            type: 'expectText',
            target: { by: 'role', role: 'heading' },
            text: 'Fake {{first}}',
            match: 'contains',
          },
        ],
      },
      { PW: 'pw-secret-1' },
    );
    expect(out.verdict, JSON.stringify(out.steps.filter((s) => s.error))).toBe('FAILED'); // the last step: "Fake c-7" is not on the page
    expect(out.reason).toBe('ASSERTION_FAILED:used');
    expect(out.assertions.filter((a) => a.stepId === 'me').map((a) => a.passed)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(out.assertions.filter((a) => a.stepId === 'refused').every((a) => a.passed)).toBe(true);
    expect(out.assertions.filter((a) => a.stepId === 'allowed').every((a) => a.passed)).toBe(true);
    expect(out.assertions.find((a) => a.stepId === 'anon')?.passed).toBe(true);
    expect(out.assertions.find((a) => a.stepId === 'used')?.expected).toBe('Fake c-7');
    expect(JSON.stringify(out)).not.toContain('pw-secret-1');
  });

  it('a bearer token read from the sign-in response is sent on the session', async () => {
    const out = await run({
      steps: [
        {
          id: 'tok',
          type: 'session',
          name: 'api',
          method: 'POST',
          path: '/api/token',
          token: { path: 'token' },
        },
        {
          id: 'me',
          type: 'apiRequest',
          method: 'GET',
          path: '/api/me',
          session: 'api',
          expectJson: [{ path: 'role', equals: 'api-client' }],
        },
      ],
    });
    expect(out.verdict).toBe('PASSED');
  });

  it('a failed sign-in is a step error, never a pass', async () => {
    const out = await run(
      {
        steps: [
          signIn('x', 'r@x.test'),
          { id: 'me', type: 'apiRequest', method: 'GET', path: '/api/me', session: 'x', expectStatus: 200 },
        ],
      },
      { PW: 'wrong' },
    );
    expect(out).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'STEP_ERROR:login-x' });
  });

  it('a JSON check compared to a secret shows only the secret name in evidence', async () => {
    const out = await run(
      {
        steps: [
          {
            id: 'tok',
            type: 'apiRequest',
            method: 'POST',
            path: '/api/token',
            expectJson: [{ path: 'token', equals: { secret: 'TOKEN' } }],
          },
        ],
      },
      { TOKEN: 'tok-123' },
    );
    expect(out.verdict).toBe('PASSED');
    expect(JSON.stringify(out.assertions)).not.toContain('tok-123');
    expect(JSON.stringify(out.assertions)).toContain('[secret:TOKEN]');
  });
});

describe('data rows (ADR-0024)', () => {
  it('runs the spec once per row with the row as values, one verdict per row in the assertions', async () => {
    const out = await run(
      {
        rows: [
          { who: 'r@x.test', status: '403' },
          { who: 'admin@x.test', status: '200' },
          { who: 'r@x.test', status: '200' }, // wrong expectation: this row fails
        ],
        steps: [
          {
            id: 'login',
            type: 'session',
            name: 'me',
            method: 'POST',
            path: '/api/login',
            body: { email: { var: 'who' }, password: { secret: 'PW' } },
          },
          {
            id: 'users',
            type: 'apiRequest',
            method: 'GET',
            path: '/api/admin/users',
            session: 'me',
            expectJson: [{ path: 'code', exists: false }],
          },
        ],
      },
      { PW: 'pw-secret-1' },
    );
    expect(out.verdict).toBe('FAILED');
    expect(out.assertions.map((a) => [a.row, a.passed])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(out.steps.filter((s) => s.id === 'login').map((s) => s.row)).toEqual([0, 1, 2]);
  });

  it('rows must share their columns and may not shadow declared values', () => {
    expect(() =>
      ExecutableSpec.parse({
        rows: [{ a: '1' }, { b: '2' }],
        steps: [
          { id: 'x', type: 'navigate', path: '/' },
          { id: 'y', type: 'expectVisible', target: { by: 'role', role: 'main' } },
        ],
      }),
    ).toThrow(/different columns/);
    expect(() =>
      ExecutableSpec.parse({
        values: { a: { date: { offsetDays: 0, format: 'yyyy-MM-dd' } } },
        rows: [{ a: '1' }],
        steps: [
          { id: 'x', type: 'navigate', path: '/' },
          { id: 'y', type: 'expectVisible', target: { by: 'role', role: 'main' } },
        ],
      }),
    ).toThrow(/also a declared value/);
  });
});

describe('bounded waits, keys, uploads and downloads (ADR-0024)', () => {
  it('waits on a request until its JSON says done, and on a text that appears later', async () => {
    state.polls = 0;
    const out = await run({
      steps: [
        {
          id: 'job',
          type: 'waitFor',
          timeoutMs: 5000,
          intervalMs: 250,
          until: {
            kind: 'request',
            method: 'GET',
            path: '/api/job',
            expectStatus: 200,
            expectJson: [{ path: 'status', equals: 'done' }],
          },
        },
        { id: 'open', type: 'navigate', path: '/' },
        {
          id: 'later',
          type: 'waitFor',
          timeoutMs: 5000,
          until: { kind: 'text', target: { by: 'role', role: 'status' }, text: 'ready after a while' },
        },
        {
          id: 'shown',
          type: 'expectText',
          target: { by: 'role', role: 'status' },
          text: 'ready after a while',
          match: 'exact',
        },
      ],
    });
    expect(out.verdict, JSON.stringify(out.steps.filter((s) => s.error))).toBe('PASSED');
    expect(state.polls).toBeGreaterThanOrEqual(3);
  });

  it('a wait that runs out blocks the run; it never passes', async () => {
    const out = await run({
      steps: [
        {
          id: 'never',
          type: 'waitFor',
          timeoutMs: 1000,
          intervalMs: 250,
          until: {
            kind: 'request',
            method: 'GET',
            path: '/api/never',
            expectJson: [{ path: 'status', equals: 'done' }],
          },
        },
        { id: 'open', type: 'navigate', path: '/' },
        { id: 'shown', type: 'expectVisible', target: { by: 'role', role: 'heading' } },
      ],
    });
    expect(out).toMatchObject({ verdict: 'BLOCKED', reason: 'WAIT_TIMEOUT:never' });
    expect(out.steps.map((s) => s.status)).toEqual(['error', 'skipped', 'skipped']);
  });

  it('presses a key, uploads a file carried by the spec, and keeps a download as evidence', async () => {
    const out = await run({
      steps: [
        { id: 'open', type: 'navigate', path: '/' },
        { id: 'type', type: 'fill', target: { by: 'label', label: 'Search' }, value: 'Ngân' },
        { id: 'enter', type: 'press', key: 'Enter', target: { by: 'label', label: 'Search' } },
        {
          id: 'searched',
          type: 'expectText',
          target: { by: 'role', role: 'status' },
          text: 'searched Ngân',
          match: 'exact',
        },
        {
          id: 'file',
          type: 'upload',
          target: { by: 'label', label: 'Attachment' },
          file: {
            name: 'id-card.png',
            contentType: 'image/png',
            dataBase64: Buffer.from('png').toString('base64'),
          },
        },
        {
          id: 'picked',
          type: 'expectText',
          target: { by: 'role', role: 'status' },
          text: 'picked id-card.png',
          match: 'exact',
        },
        {
          id: 'export',
          type: 'expectDownload',
          trigger: { by: 'role', role: 'link', name: 'Export' },
          nameMatches: '\\.csv$',
        },
      ],
    });
    expect(out.verdict, JSON.stringify(out.steps.filter((s) => s.error))).toBe('PASSED');
    expect(out.evidence.some((e) => e.kind === 'download' && e.name.includes('customers.csv'))).toBe(true);
  });
});

describe('raw bodies, headers, one-time codes and test hooks (ADR-0025)', () => {
  // A fake product that echoes what it received, with a TOTP-protected endpoint and a test hook.
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 6238 test secret, base32
  let hookTarget: ExecutionTarget;
  beforeAll(async () => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        const json = (status: number, data: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        if (req.url === '/echo')
          return json(200, {
            contentType: req.headers['content-type'] ?? null,
            origin: req.headers.origin ?? null,
            raw,
          });
        if (req.url === '/totp') {
          let body: { code?: string } = {};
          try {
            body = JSON.parse(raw);
          } catch {
            /* not json */
          }
          return json(body.code === totpCode(SECRET) ? 200 : 401, { ok: body.code === totpCode(SECRET) });
        }
        if (req.url?.startsWith('/__test__/')) return json(200, { reset: true });
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    close2 = () => new Promise((r) => server.close(r));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    hookTarget = { baseUrl, allowedHosts: [new URL(baseUrl).host], hookPaths: ['/__test__/reset'] };
  });
  let close2: () => Promise<unknown> = async () => undefined;
  afterAll(() => close2());
  const runOn = (spec: ExecutableSpecInput, target: ExecutionTarget, secrets: Record<string, string> = {}) =>
    executor.execute({
      runId: `run_hook_${++n}`,
      scope,
      spec: ExecutableSpec.parse(spec),
      target,
      secrets: (name) => secrets[name],
      store,
    });

  it('computes RFC 6238 codes', () => {
    expect(totpCode(SECRET, 59_000)).toBe('287082');
    expect(totpCode(SECRET, 1_111_111_109_000)).toBe('081804');
  });

  it('sends a raw body with its content type and an allowlisted header; a TOTP code is computed at send time', async () => {
    const out = await runOn(
      {
        steps: [
          {
            id: 'malformed',
            type: 'apiRequest',
            method: 'POST',
            path: '/echo',
            rawBody: { contentType: 'application/json', text: '{"fullName": "x", "phone": ' },
            headers: { Origin: 'https://evil.example' },
            expectJson: [
              { path: 'contentType', equals: 'application/json' },
              { path: 'origin', equals: 'https://evil.example' },
              { path: 'raw', equals: '{"fullName": "x", "phone": ' },
            ],
          },
          {
            id: 'plain',
            type: 'apiRequest',
            method: 'POST',
            path: '/echo',
            rawBody: { contentType: 'text/plain', text: 'hello' },
            expectJson: [{ path: 'contentType', equals: 'text/plain' }],
          },
          {
            id: 'code',
            type: 'apiRequest',
            method: 'POST',
            path: '/totp',
            body: { code: { totp: 'ADMIN_TOTP' } },
            expectStatus: 200,
          },
        ],
      },
      hookTarget,
      { ADMIN_TOTP: SECRET },
    );
    expect(out.verdict, JSON.stringify(out.assertions.filter((a) => a.passed !== true))).toBe('PASSED');
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.assertions.find((a) => a.stepId === 'code')?.passed).toBe(true);
  });

  it('a header outside the allowlist, or both body and rawBody, is refused by the schema', () => {
    expect(() =>
      ExecutableSpec.parse({
        steps: [
          {
            id: 'x',
            type: 'apiRequest',
            method: 'GET',
            path: '/echo',
            headers: { Authorization: 'Bearer x' },
            expectStatus: 200,
          },
        ],
      }),
    ).toThrow(/must be one of/);
    expect(() =>
      ExecutableSpec.parse({
        steps: [
          {
            id: 'x',
            type: 'apiRequest',
            method: 'POST',
            path: '/echo',
            body: { a: '1' },
            rawBody: { contentType: 'text/plain', text: 'a' },
            expectStatus: 200,
          },
        ],
      }),
    ).toThrow(/both body and rawBody/);
  });

  it('a test hook runs only on a listed path; elsewhere the step is an error', async () => {
    const ok = await runOn(
      {
        steps: [
          { id: 'reset', type: 'testHook', method: 'POST', path: '/__test__/reset' },
          { id: 'echo', type: 'apiRequest', method: 'GET', path: '/echo', expectStatus: 200 },
        ],
      },
      hookTarget,
    );
    expect(ok.verdict).toBe('PASSED');
    const refused = await runOn(
      {
        steps: [
          { id: 'other', type: 'testHook', method: 'POST', path: '/__test__/drop' },
          { id: 'echo', type: 'apiRequest', method: 'GET', path: '/echo', expectStatus: 200 },
        ],
      },
      hookTarget,
    );
    expect(refused).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'STEP_ERROR:other' });
    const none = await runOn(
      {
        steps: [
          { id: 'reset', type: 'testHook', method: 'POST', path: '/__test__/reset' },
          { id: 'echo', type: 'apiRequest', method: 'GET', path: '/echo', expectStatus: 200 },
        ],
      },
      { ...hookTarget, hookPaths: [] },
    );
    expect(none.reason).toBe('STEP_ERROR:reset');
  });
});
