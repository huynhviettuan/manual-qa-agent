import {
  type APIRequestContext,
  type BrowserContext,
  chromium,
  type Locator as PwLocator,
  type Page,
  request as playwrightRequest,
} from 'playwright';
import {
  deriveValue,
  describeLocator,
  type ExecutableSpec,
  type ExecutableStep,
  type InputValue,
  type JsonCheck,
  type Locator,
  readJsonPath,
  redactSecrets,
  referencedSecrets,
  renderTemplate,
  type TenantScope,
} from '@qa/domain';
import { createHmac } from 'node:crypto';
import { evidenceKey, type EvidenceStore, type StoredObject } from '@qa/evidence';

/** Administrator-managed target; never derived from a spec, model output or user-supplied URL. */
export type ExecutionTarget = {
  baseUrl: string;
  allowedHosts: string[];
  /** Path prefixes of the product's test hooks a `testHook` step may call (ADR-0025); default none. */
  hookPaths?: string[];
};

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret; exported so tests share one clock. */
export function totpCode(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

/** Resolves secret references at run time (e.g. from a vault or `QA_SECRET_<NAME>`). */
export type SecretResolver = (name: string) => string | undefined;

/** `null` = could not be evaluated (not the same as a failed assertion). */
export type Assertion = {
  stepId: string;
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean | null;
  /** The data row the assertion belongs to (ADR-0024). */
  row?: number;
};

export type StepLog = {
  id: string;
  phase: 'setup' | 'steps' | 'teardown';
  /** The data row this step ran for (ADR-0024); absent without rows. */
  row?: number;
  type: ExecutableStep['type'];
  description: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  error?: string;
  /** Why optional evidence is missing (e.g. a navigation screenshot taken mid-redirect). */
  note?: string;
  durationMs: number;
  screenshot?: string;
};

export type EvidenceItem = {
  kind: 'screenshot' | 'step-log' | 'network-log' | 'download';
  name: string;
  contentType: string;
} & StoredObject;

export type ExecutionOutcome = {
  /** BLOCKED: a bounded wait timed out (ADR-0024); the signal never came, nothing was proved. */
  verdict: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | 'BLOCKED';
  reason: string;
  assertions: Assertion[];
  steps: StepLog[];
  cleanupFailed: boolean;
  blockedRequests: string[];
  evidence: EvidenceItem[];
};

export type ExecuteInput = {
  runId: string;
  scope: TenantScope;
  spec: ExecutableSpec;
  target: ExecutionTarget;
  secrets: SecretResolver;
  store: EvidenceStore;
};

export interface Executor {
  execute(input: ExecuteInput): Promise<ExecutionOutcome>;
}

export type PlaywrightExecutorOptions = {
  /** e.g. `chrome` / `msedge` to use an installed browser instead of Playwright's bundled build. */
  channel?: string;
  headless?: boolean;
  /** Per-step timeout for auto-waiting actions and assertions. */
  stepTimeoutMs?: number;
  /**
   * Browser locale (default `en-US`). Pinned so a spec gets the same page language, and the same
   * verdict, on every machine; apps that localize from Accept-Language differ otherwise.
   */
  locale?: string;
};

class EvidenceUnavailable extends Error {}
class StepError extends Error {}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hostAllowed(url: URL, allowed: Set<string>): boolean {
  return (
    (url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'ws:' ||
      url.protocol === 'wss:') &&
    allowed.has(url.host)
  );
}

/** Path + host only: query strings and fragments can carry tokens. */
const safeUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable-url]';
  }
};

export class PlaywrightExecutor implements Executor {
  constructor(private readonly opts: PlaywrightExecutorOptions = {}) {}

  async execute(input: ExecuteInput): Promise<ExecutionOutcome> {
    const { spec, target, scope, runId, store } = input;
    const timeout = this.opts.stepTimeoutMs ?? 10_000;
    const allowed = new Set(target.allowedHosts);
    const base = new URL(target.baseUrl);
    const out: ExecutionOutcome = {
      verdict: 'PASSED',
      reason: 'ALL_ASSERTIONS_PASSED',
      assertions: [],
      steps: [],
      cleanupFailed: false,
      blockedRequests: [],
      evidence: [],
    };
    const conclude = (verdict: ExecutionOutcome['verdict'], reason: string) => {
      // First terminal problem wins; FAILED/INCONCLUSIVE are never downgraded to PASSED.
      if (out.verdict === 'PASSED') Object.assign(out, { verdict, reason });
    };

    if (!allowed.has(base.host)) {
      conclude('INCONCLUSIVE', 'BASE_URL_NOT_ALLOWLISTED');
      return out;
    }

    // Resolve secrets up front; their values are redacted from every log and masked in screenshots.
    const secretValues: string[] = [];
    const resolved = new Map<string, string>();
    for (const name of referencedSecrets(spec)) {
      const value = input.secrets(name);
      if (!value) {
        conclude('INCONCLUSIVE', `MISSING_SECRET:${name}`);
        return out;
      }
      resolved.set(name, value);
      secretValues.push(value);
    }
    const redact = (text: string) => {
      let t = text;
      for (const v of secretValues) t = t.split(v).join('[REDACTED_SECRET]');
      return redactSecrets(t).text;
    };
    // The run's value table (ADR-0015): declared values are derived once, from one clock reading, so
    // every step sees the same date; capture steps add to it as the run goes.
    const startedAt = new Date();
    const declared = new Map<string, string>();
    for (const [name, def] of Object.entries(spec.values)) declared.set(name, deriveValue(def, startedAt));
    const vars = new Map<string, string>(declared);
    // ADR-0024: API sessions (a cookie jar and headers per signed-in role) and the JSON responses of
    // API steps, for later checks and captures. Both start afresh for every data row.
    const sessions = new Map<string, { ctx: APIRequestContext; headers: Record<string, string> }>();
    const responses = new Map<string, { status: number; json: unknown }>();
    let currentRow: number | undefined;
    const valueOf = (v: InputValue) => {
      if (typeof v === 'string') return v;
      if ('secret' in v) return resolved.get(v.secret)!;
      // A one-time code from a TOTP secret, computed now; the secret itself never leaves the resolver.
      if ('totp' in v) return totpCode(resolved.get(v.totp)!);
      const value = vars.get(v.var);
      if (value === undefined) throw new StepError(`undefined value {{${v.var}}}`);
      return value;
    };
    const show = (v: InputValue) =>
      typeof v === 'string'
        ? JSON.stringify(redact(v))
        : 'secret' in v
          ? `[secret:${v.secret}]`
          : 'totp' in v
            ? `[totp:${v.totp}]`
            : `{{${v.var}}}`;
    const render = (template: string) => {
      try {
        return renderTemplate(template, vars);
      } catch (err) {
        throw new StepError(err instanceof Error ? err.message : String(err));
      }
    };
    // A filled path must still be relative: a captured value can never redirect the run off the target.
    const relative = (path: string) => {
      if (!path.startsWith('/') || path.startsWith('//') || /[\s\\]/.test(path)) {
        throw new StepError(`filled path is not a relative path: ${redact(path).slice(0, 100)}`);
      }
      return path;
    };

    const network: Array<Record<string, unknown>> = [];
    let shotIndex = 0;
    const save = async (
      kind: EvidenceItem['kind'],
      name: string,
      contentType: string,
      data: Uint8Array | string,
    ) => {
      try {
        const stored = await store.put(evidenceKey(scope, runId, name), data);
        out.evidence.push({ kind, name, contentType, ...stored });
      } catch (err) {
        throw new EvidenceUnavailable(err instanceof Error ? err.message : String(err));
      }
    };

    const browser = await chromium.launch({
      headless: this.opts.headless ?? true,
      channel: this.opts.channel,
    });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        acceptDownloads: [...spec.setup, ...spec.steps, ...spec.teardown].some(
          (x) => x.type === 'expectDownload',
        ),
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 800 },
        locale: this.opts.locale ?? 'en-US',
      });
      context.setDefaultTimeout(timeout);
      context.setDefaultNavigationTimeout(timeout);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (hostAllowed(url, allowed)) return route.continue();
        out.blockedRequests.push(safeUrl(url.toString()));
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket(/.*/, (ws) => {
        const url = new URL(ws.url());
        if (hostAllowed(url, allowed)) return ws.connectToServer();
        out.blockedRequests.push(safeUrl(url.toString()));
        return ws.close();
      });

      const page = await context.newPage();
      page.on('response', (r) =>
        network.push({
          method: r.request().method(),
          url: safeUrl(r.url()),
          status: r.status(),
          type: r.request().resourceType(),
        }),
      );
      page.on('requestfailed', (r) =>
        network.push({
          method: r.method(),
          url: safeUrl(r.url()),
          failure: r.failure()?.errorText ?? 'failed',
        }),
      );
      page.on('console', (m) => {
        if (m.type() === 'error') network.push({ console: 'error', text: redact(m.text()).slice(0, 500) });
      });
      const masked: PwLocator[] = [page.locator('input[type="password"]')];

      const screenshot = async (stepId: string) => {
        const name = `${String(++shotIndex).padStart(3, '0')}-${stepId}.png`;
        const png = await page.screenshot({ fullPage: true, animations: 'disabled', mask: masked });
        await save('screenshot', name, 'image/png', png);
        return name;
      };

      const runPhase = async (phase: StepLog['phase'], steps: ExecutableStep[], stopOnProblem: boolean) => {
        let stopped = false;
        for (const step of steps) {
          const log: StepLog = {
            id: step.id,
            phase,
            ...(currentRow === undefined ? {} : { row: currentRow }),
            type: step.type,
            description: describe(step, show),
            status: 'passed',
            durationMs: 0,
          };
          out.steps.push(log);
          if (stopped) {
            log.status = 'skipped';
            continue;
          }
          const started = performance.now();
          try {
            const made = await this.runStep(page, context!, step, base, {
              valueOf,
              show,
              render,
              relative,
              vars,
              masked,
              timeout,
              sessions,
              responses,
              row: currentRow,
              hookPaths: input.target.hookPaths,
              saveFile: (name, contentType, data) => save('download', name, contentType, data),
              note: (text) => (log.note = redact(text).slice(0, 200)),
            });
            // One step may make several assertions (a status and JSON checks); the first problem decides.
            const assertion = made.find((a) => a.passed !== true) ?? made[0] ?? null;
            for (const a of made) {
              out.assertions.push(a);
              if (a.passed !== true) log.status = 'failed';
            }
            if (assertion) log.screenshot = await screenshot(step.id);
            else if (step.type === 'navigate') {
              // Supporting evidence only. An app may redirect on the client at any moment after load
              // (Gym CRM: /finance -> /finance/payments), so the capture can fail; the next assertion
              // waits on its real signal and its screenshot (always mandatory) shows the settled page.
              log.screenshot = await screenshot(step.id).catch((err: unknown) => {
                if (err instanceof EvidenceUnavailable) throw err;
                log.note = `screenshot skipped: ${redact(err instanceof Error ? err.message.split('\n')[0]! : String(err)).slice(0, 200)}`;
                return undefined;
              });
            }
            if (assertion?.passed === false && phase === 'steps')
              conclude('FAILED', `ASSERTION_FAILED:${step.id}`);
            if (assertion?.passed === null) conclude('INCONCLUSIVE', `ASSERTION_NOT_EVALUATED:${step.id}`);
            if (assertion && assertion.passed !== true && stopOnProblem) stopped = true;
          } catch (err) {
            if (err instanceof EvidenceUnavailable) throw err;
            log.status = 'error';
            log.error = redact(err instanceof Error ? err.message.split('\n')[0]! : String(err)).slice(
              0,
              500,
            );
            if (phase === 'teardown') out.cleanupFailed = true;
            // A wait that timed out blocks the run: the signal never came (ADR-0024).
            else if (err instanceof WaitTimeout) conclude('BLOCKED', `WAIT_TIMEOUT:${step.id}`);
            else conclude('INCONCLUSIVE', `${phase === 'setup' ? 'SETUP' : 'STEP'}_ERROR:${step.id}`);
            try {
              log.screenshot = await screenshot(`${step.id}-error`);
            } catch (shotErr) {
              if (shotErr instanceof EvidenceUnavailable) throw shotErr;
            }
            if (stopOnProblem) stopped = true;
          } finally {
            log.durationMs = Math.round(performance.now() - started);
          }
        }
        return stopped;
      };

      // ADR-0024: with data rows the whole spec runs once per row, each row with its own values,
      // sessions and responses; without rows, once.
      const rows: Array<Record<string, string> | null> = spec.rows.length ? spec.rows : [null];
      for (const [rowIndex, row] of rows.entries()) {
        currentRow = row ? rowIndex : undefined;
        vars.clear();
        for (const [k, v] of declared) vars.set(k, v);
        if (row) for (const [k, v] of Object.entries(row)) vars.set(k, v);
        for (const sess of sessions.values()) await sess.ctx.dispose().catch(() => undefined);
        sessions.clear();
        responses.clear();
        try {
          const setupFailed = await runPhase('setup', spec.setup, true);
          if (setupFailed) {
            for (const s of spec.steps) {
              out.steps.push({
                id: s.id,
                phase: 'steps',
                ...(currentRow === undefined ? {} : { row: currentRow }),
                type: s.type,
                description: describe(s, show),
                status: 'skipped',
                durationMs: 0,
              });
            }
          } else {
            await runPhase('steps', spec.steps, true);
          }
        } finally {
          // Teardown always runs; the spec that created test data owns its cleanup.
          await runPhase('teardown', spec.teardown, false).catch((err) => {
            if (!(err instanceof EvidenceUnavailable)) throw err;
            out.cleanupFailed = true;
          });
        }
      }
    } catch (err) {
      if (err instanceof EvidenceUnavailable) {
        Object.assign(out, { verdict: 'INCONCLUSIVE', reason: 'EVIDENCE_UNAVAILABLE' });
        return out;
      }
      conclude(
        'INCONCLUSIVE',
        `EXECUTOR_ERROR:${redact(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      );
    } finally {
      for (const sess of sessions.values()) await sess.ctx.dispose().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }

    try {
      await save(
        'step-log',
        'steps.json',
        'application/json',
        JSON.stringify({ steps: out.steps, assertions: out.assertions }, null, 2),
      );
      await save(
        'network-log',
        'network.json',
        'application/json',
        JSON.stringify({ requests: network, blocked: out.blockedRequests }, null, 2),
      );
    } catch {
      Object.assign(out, { verdict: 'INCONCLUSIVE', reason: 'EVIDENCE_UNAVAILABLE' });
    }
    return out;
  }

  private locate(page: Page, l: Locator): PwLocator {
    const parent: Page | PwLocator = l.within ? this.locate(page, l.within) : page;
    switch (l.by) {
      case 'role':
        return parent.getByRole(l.role, { name: l.name, exact: l.exact });
      case 'testId':
        return parent.getByTestId(l.testId);
      case 'label':
        return parent.getByLabel(l.label, { exact: l.exact });
      case 'text':
        return parent.getByText(l.text, { exact: l.exact });
    }
  }

  /** Executes one step. Returns its assertions (none for actions; several for an API step with JSON checks). */
  private async runStep(
    page: Page,
    context: BrowserContext,
    step: ExecutableStep,
    base: URL,
    run: {
      valueOf: (v: InputValue) => string;
      show: (v: InputValue) => string;
      render: (template: string) => string;
      relative: (path: string) => string;
      vars: Map<string, string>;
      masked: PwLocator[];
      timeout: number;
      sessions: Map<string, { ctx: APIRequestContext; headers: Record<string, string> }>;
      responses: Map<string, { status: number; json: unknown }>;
      row: number | undefined;
      hookPaths: string[] | undefined;
      saveFile: (name: string, contentType: string, data: Uint8Array) => Promise<void>;
      note: (text: string) => void;
    },
  ): Promise<Assertion[]> {
    const { valueOf, show, render, relative, vars, masked, timeout, sessions, responses } = run;
    const assertion = (
      expected: unknown,
      actual: unknown,
      passed: boolean | null,
      name: string = step.type,
    ): Assertion => ({
      stepId: step.id,
      name,
      expected,
      actual,
      passed,
      ...(run.row === undefined ? {} : { row: run.row }),
    });
    const timedOut = (err: unknown) => err instanceof Error && err.name === 'TimeoutError';
    const bodyOf = (body: Record<string, InputValue> | undefined) =>
      body ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, valueOf(v)])) : undefined;
    const parseJson = async (res: { text: () => Promise<string> }): Promise<unknown> => {
      const text = await res.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return undefined;
      }
    };
    // JSON checks (ADR-0024): a secret compared to never reaches the evidence, only its name.
    const jsonAssertions = (json: unknown, checks: JsonCheck[] | undefined): Assertion[] =>
      (checks ?? []).map((c) => {
        const actual = readJsonPath(json, c.path);
        const shown =
          actual === undefined ? undefined : typeof actual === 'string' ? actual : JSON.stringify(actual);
        if (c.exists !== undefined)
          return assertion(
            `${c.path} ${c.exists ? 'exists' : 'absent'}`,
            shown,
            (actual !== undefined) === c.exists,
            'expectJson',
          );
        if (c.matches !== undefined)
          return assertion(
            `${c.path} matches /${c.matches}/`,
            shown,
            shown !== undefined && new RegExp(c.matches).test(shown),
            'expectJson',
          );
        const expected = valueOf(c.equals!);
        const label = typeof c.equals === 'object' && 'secret' in c.equals ? show(c.equals) : expected;
        return assertion(
          `${c.path} = ${label}`,
          typeof c.equals === 'object' && 'secret' in c.equals
            ? shown === expected
              ? label
              : '[other]'
            : shown,
          shown === expected,
          'expectJson',
        );
      });
    const send = async (
      method: string,
      path: string,
      body: Record<string, InputValue> | undefined,
      sessionName: string | undefined,
      maxTimeout = timeout,
      extra: { raw?: { contentType: string; text: string }; headers?: Record<string, InputValue> } = {},
    ) => {
      const url = new URL(relative(render(path)), base).toString();
      const data = bodyOf(body);
      const sess = sessionName ? sessions.get(sessionName) : undefined;
      if (sessionName && !sess) throw new StepError(`session ${sessionName} is not open`);
      const headers: Record<string, string> = { ...(sess?.headers ?? {}) };
      for (const [k, v] of Object.entries(extra.headers ?? {})) headers[k] = valueOf(v);
      if (extra.raw) headers['content-type'] = extra.raw.contentType;
      const res = await (sess?.ctx ?? context.request).fetch(url, {
        method,
        // A raw body goes as bytes, so a JSON content type never re-serialises the text.
        ...(extra.raw ? { data: Buffer.from(render(extra.raw.text)) } : data ? { data } : {}),
        headers,
        maxRedirects: 0,
        timeout: maxTimeout,
      });
      return { status: res.status(), json: await parseJson(res) };
    };

    switch (step.type) {
      case 'navigate': {
        const path = relative(render(step.path));
        const res = await page.goto(new URL(path, base).toString(), { waitUntil: 'load' });
        if (!res) throw new StepError('navigation produced no response');
        return [];
      }
      case 'click':
        await this.locate(page, step.target).click();
        return [];
      case 'fill': {
        const target = this.locate(page, step.target);
        await target.fill(valueOf(step.value));
        if (typeof step.value !== 'string') masked.push(target);
        return [];
      }
      case 'select':
        await this.locate(page, step.target).selectOption(step.option);
        return [];
      case 'press':
        if (step.target) await this.locate(page, step.target).press(step.key);
        else await page.keyboard.press(step.key);
        return [];
      case 'upload':
        await this.locate(page, step.target).setInputFiles({
          name: step.file.name,
          mimeType: step.file.contentType,
          buffer: Buffer.from(step.file.dataBase64, 'base64'),
        });
        return [];
      case 'expectDownload': {
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout }),
            this.locate(page, step.trigger).click(),
          ]);
          const name = download.suggestedFilename();
          const file = await download.path();
          if (file) {
            const { readFile } = await import('node:fs/promises');
            await run.saveFile(
              `download-${step.id}-${name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}`,
              'application/octet-stream',
              await readFile(file),
            );
          }
          const ok = step.nameMatches === undefined || new RegExp(step.nameMatches).test(name);
          return [
            assertion(step.nameMatches ? `a download named /${step.nameMatches}/` : 'a download', name, ok),
          ];
        } catch (err) {
          if (!timedOut(err)) throw err;
          return [assertion('a download', 'no download', false)];
        }
      }
      case 'expectText': {
        const target = this.locate(page, step.target);
        const text = render(step.text);
        const re =
          step.match === 'exact' ? new RegExp(`^\\s*${escapeRe(text)}\\s*$`) : new RegExp(escapeRe(text));
        try {
          // Waits on the real signal (the target containing the text), never a fixed sleep.
          await target.filter({ hasText: re }).waitFor({ state: 'visible', timeout });
          return [assertion(text, text, true)];
        } catch (err) {
          if (!timedOut(err)) throw err;
          const actual = await target.innerText({ timeout: 1000 }).catch(() => null);
          return [assertion(text, actual?.trim() ?? null, actual === null ? null : false)];
        }
      }
      case 'capture': {
        // Reads a value for later steps. Strict locator: two matches are an error, never a guess.
        let source: string;
        if (step.from.kind === 'url') source = page.url();
        else if (step.from.kind === 'text')
          source = (await this.locate(page, step.from.target).innerText({ timeout })).trim();
        else {
          const res = responses.get(step.from.step);
          if (!res) throw new StepError(`no response recorded for step ${step.from.step}`);
          const v = readJsonPath(res.json, step.from.path);
          if (v === undefined)
            throw new StepError(`${step.from.path} is not in the response of ${step.from.step}`);
          source = typeof v === 'string' ? v : JSON.stringify(v);
        }
        let value = source;
        if (step.pattern) {
          const m = new RegExp(step.pattern).exec(source);
          if (!m || m[1] === undefined) {
            throw new StepError(`pattern /${step.pattern}/ did not match ${step.from.kind}`);
          }
          value = m[1];
        }
        vars.set(step.as, value);
        run.note(`${step.as} = ${JSON.stringify(value)}`);
        return [];
      }
      case 'expectVisible':
      case 'expectHidden': {
        const state = step.type === 'expectVisible' ? 'visible' : 'hidden';
        try {
          await this.locate(page, step.target).waitFor({ state, timeout });
          return [assertion(state, state, true)];
        } catch (err) {
          if (!timedOut(err)) throw err;
          return [assertion(state, state === 'visible' ? 'not visible' : 'visible', false)];
        }
      }
      case 'expectUrl': {
        const path = relative(render(step.path));
        const matches = (u: URL) =>
          u.host === base.host &&
          (step.match === 'exact' ? u.pathname === path : u.pathname.startsWith(path));
        try {
          await page.waitForURL(matches, { timeout, waitUntil: 'commit' });
          return [assertion(path, path, true)];
        } catch (err) {
          if (!timedOut(err)) throw err;
          return [assertion(path, new URL(page.url()).pathname, false)];
        }
      }
      case 'testHook': {
        // Only a path the administrator listed as a hook, and policy already keeps production out.
        const path = relative(render(step.path));
        const allowedHook = (run.hookPaths ?? []).some(
          (p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`),
        );
        if (!allowedHook) throw new StepError(`${path} is not a test hook of this environment`);
        const res = await send(step.method, step.path, step.body, undefined);
        responses.set(step.id, res);
        if (res.status < 200 || res.status >= 300)
          throw new StepError(`test hook ${path} answered ${res.status}`);
        return [];
      }
      case 'apiRequest': {
        const res = await send(step.method, step.path, step.body, step.session, timeout, {
          raw: step.rawBody,
          headers: step.headers,
        });
        responses.set(step.id, res);
        return [
          ...(step.expectStatus === undefined
            ? []
            : [assertion(step.expectStatus, res.status, res.status === step.expectStatus)]),
          ...jsonAssertions(res.json, step.expectJson),
        ];
      }
      case 'session': {
        // Its own cookie jar; requests stay relative to the target, so the host rule holds.
        const ctx = await playwrightRequest.newContext({ baseURL: base.origin });
        const headers: Record<string, string> = {};
        sessions.set(step.name, { ctx, headers });
        const res = await send(step.method, step.path, step.body, step.name, timeout, {
          headers: step.headers,
        });
        responses.set(step.id, res);
        if (res.status < 200 || res.status >= 300)
          throw new StepError(`sign-in for session ${step.name} answered ${res.status}`);
        if (step.token) {
          const token = readJsonPath(res.json, step.token.path);
          if (typeof token !== 'string' || !token)
            throw new StepError(`no token at ${step.token.path} for session ${step.name}`);
          headers[step.token.header] = `${step.token.prefix}${token}`;
        }
        run.note(`session ${step.name} open`);
        return [];
      }
      case 'waitFor': {
        const deadline = Date.now() + step.timeoutMs;
        if (step.until.kind === 'text') {
          const target = this.locate(page, step.until.target);
          const text = render(step.until.text);
          try {
            await target
              .filter({ hasText: new RegExp(escapeRe(text)) })
              .waitFor({ state: 'visible', timeout: step.timeoutMs });
            return [];
          } catch (err) {
            if (timedOut(err)) throw new WaitTimeout(step.id);
            throw err;
          }
        }
        const until = step.until;
        for (;;) {
          const res = await send(
            until.method,
            until.path,
            undefined,
            until.session,
            Math.max(1000, deadline - Date.now()),
          );
          const statusOk = until.expectStatus === undefined || res.status === until.expectStatus;
          const checks = jsonAssertions(res.json, until.expectJson);
          if (statusOk && checks.every((a) => a.passed === true)) {
            responses.set(step.id, res);
            return [];
          }
          if (Date.now() + step.intervalMs > deadline) throw new WaitTimeout(step.id);
          await new Promise((r) => setTimeout(r, step.intervalMs));
        }
      }
    }
  }
}

/** A bounded wait that ran out: the run is BLOCKED, never passed or failed (ADR-0024). */
class WaitTimeout extends Error {
  constructor(stepId: string) {
    super(`waited the full bound at step ${stepId}; the signal never came`);
    this.name = 'WaitTimeout';
  }
}

function describe(step: ExecutableStep, show: (v: InputValue) => string): string {
  switch (step.type) {
    case 'navigate':
      return `navigate ${step.path}`;
    case 'click':
      return `click ${describeLocator(step.target)}${step.destructive ? ' (destructive)' : ''}`;
    case 'fill':
      return `fill ${describeLocator(step.target)} with ${show(step.value)}`;
    case 'select':
      return `select "${step.option}" in ${describeLocator(step.target)}`;
    case 'expectText':
      return `expect ${describeLocator(step.target)} ${step.match === 'exact' ? 'to have text' : 'to contain'} "${step.text}"`;
    case 'expectVisible':
      return `expect ${describeLocator(step.target)} visible`;
    case 'expectHidden':
      return `expect ${describeLocator(step.target)} hidden`;
    case 'expectUrl':
      return `expect URL ${step.match} ${step.path}`;
    case 'apiRequest':
      return `${step.method} ${step.path}${step.session ? ` as ${step.session}` : ''}${step.expectStatus ? ` expect ${step.expectStatus}` : ''}${step.expectJson?.length ? ` and ${step.expectJson.length} JSON check(s)` : ''}`;
    case 'session':
      return `open session ${step.name} via ${step.method} ${step.path}`;
    case 'testHook':
      return `test hook ${step.method} ${step.path}`;
    case 'waitFor':
      return step.until.kind === 'text'
        ? `wait up to ${step.timeoutMs} ms for ${describeLocator(step.until.target)} to show "${step.until.text}"`
        : `wait up to ${step.timeoutMs} ms for ${step.until.method} ${step.until.path}${step.until.expectStatus ? ` to answer ${step.until.expectStatus}` : ''}`;
    case 'press':
      return `press ${step.key}${step.target ? ` on ${describeLocator(step.target)}` : ''}`;
    case 'upload':
      return `upload ${step.file.name} to ${describeLocator(step.target)}`;
    case 'expectDownload':
      return `click ${describeLocator(step.trigger)} and expect a download${step.nameMatches ? ` named /${step.nameMatches}/` : ''}`;
    case 'capture':
      return `capture ${step.as} from ${step.from.kind === 'url' ? 'the URL' : step.from.kind === 'response' ? `${step.from.path} of ${step.from.step}` : `text of ${describeLocator(step.from.target)}`}${step.pattern ? ` matching /${step.pattern}/` : ''}`;
  }
}
