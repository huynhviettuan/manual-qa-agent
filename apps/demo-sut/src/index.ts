import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';

/**
 * Minimal system under test for the Phase 2 pilot: sign-in with lockout (AC-LOGIN-01/02/04 as
 * clarified in eval fixtures), a dashboard with a destructive "Delete account" action and a
 * third-party tracking pixel (exercises egress allowlisting). Server-rendered, no client JS.
 * Test-only: never deploy this app anywhere but a local or CI sandbox.
 */
export type DemoOptions = {
  user?: { email: string; password: string; name: string };
  /** Reintroduces BUG-1042: wrong-password message reveals account existence. */
  bugUserNotFoundMessage?: boolean;
  lockoutThreshold?: number;
  lockoutMinutes?: number;
};

type State = {
  failures: number;
  lockedUntil: number | null;
  deleted: boolean;
  sessions: Set<string>;
};

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><main>${body}</main></body></html>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createDemoApp(opts: DemoOptions = {}): FastifyInstance {
  const user = opts.user ?? {
    email: 'qa@example.test',
    password: 'demo-password-not-secret',
    name: 'QA Tester',
  };
  const threshold = opts.lockoutThreshold ?? 5;
  const lockoutMs = (opts.lockoutMinutes ?? 15) * 60_000;
  const fresh = (): State => ({ failures: 0, lockedUntil: null, deleted: false, sessions: new Set() });
  let state = fresh();

  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  const loginPage = (message = '', email = '') =>
    page(
      'Sign in',
      `<h1>Sign in</h1>
<form method="post" action="/login" data-testid="login-form" aria-label="Sign in">
  <label for="email">Email</label><input id="email" name="email" type="email" value="${esc(email)}">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>
<p role="status" data-testid="login-message">${esc(message)}</p>`,
    );

  type Outcome = { status: 200 | 401 | 423; message: string };
  function attempt(email: string, password: string): Outcome {
    const now = Date.now();
    if (state.lockedUntil && state.lockedUntil > now) {
      return { status: 423, message: `Account locked. Try again in ${opts.lockoutMinutes ?? 15} minutes.` };
    }
    const known = !state.deleted && email === user.email;
    if (known && password === user.password) {
      state.failures = 0;
      return { status: 200, message: `Welcome back, ${user.name}` };
    }
    if (known && ++state.failures >= threshold) {
      state.lockedUntil = now + lockoutMs;
      return { status: 423, message: `Account locked. Try again in ${opts.lockoutMinutes ?? 15} minutes.` };
    }
    const message = !known && opts.bugUserNotFoundMessage ? 'User not found' : 'Invalid email or password';
    return { status: 401, message };
  }

  const session = (cookie: string | undefined) => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(cookie ?? '')?.[1];
    return sid && state.sessions.has(sid) ? sid : null;
  };
  const startSession = (reply: FastifyReply) => {
    const sid = randomBytes(16).toString('hex');
    state.sessions.add(sid);
    reply.header('set-cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/`);
  };

  app.get('/', async (_req, reply) => reply.redirect('/login'));
  // Echoes a query value, so executor tests can prove a derived or captured value reached the page.
  app.get('/echo', async (req, reply) => {
    const q = String((req.query as Record<string, unknown>).q ?? '');
    return reply.type('text/html').send(page('Echo', `<h1>Echo</h1><p data-testid="echo">${esc(q)}</p>`));
  });
  app.get('/login', async (_req, reply) => reply.type('text/html').send(loginPage()));

  app.post('/login', async (req, reply) => {
    const { email = '', password = '' } = (req.body ?? {}) as Record<string, string>;
    const out = attempt(email, password);
    if (out.status === 200) {
      startSession(reply);
      return reply.redirect('/dashboard', 303);
    }
    return reply.code(out.status).type('text/html').send(loginPage(out.message, email));
  });

  app.get('/dashboard', async (req, reply) => {
    if (!session(req.headers.cookie)) return reply.redirect('/login');
    return reply.type('text/html').send(
      page(
        'Dashboard',
        `<h1>Dashboard</h1>
<p role="status" data-testid="welcome">Welcome back, ${esc(user.name)}</p>
<section aria-label="Danger zone" data-testid="danger-zone">
  <form method="post" action="/account/delete"><button type="submit">Delete account</button></form>
</section>
<img alt="" src="https://tracker.example.invalid/pixel.gif" width="1" height="1">`,
      ),
    );
  });

  app.post('/account/delete', async (req, reply) => {
    if (!session(req.headers.cookie)) return reply.redirect('/login');
    state.deleted = true;
    state.sessions.clear();
    return reply.type('text/html').send(page('Deleted', '<h1>Account deleted</h1>'));
  });

  app.post('/api/login', async (req, reply) => {
    const { email = '', password = '' } = (req.body ?? {}) as Record<string, string>;
    const out = attempt(email, password);
    return reply.code(out.status).send({ message: out.message });
  });

  // Test-data hook used by spec teardown steps.
  app.post('/__test__/reset', async () => {
    state = fresh();
    return { reset: true };
  });

  return app;
}

/** Starts the app on an ephemeral localhost port; returns its base URL. */
export async function startDemoApp(
  opts: DemoOptions = {},
): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = createDemoApp(opts);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, baseUrl: address };
}
