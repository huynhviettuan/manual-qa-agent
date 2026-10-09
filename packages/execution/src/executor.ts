import { type BrowserContext, chromium, type Locator as PwLocator, type Page } from 'playwright';
import {
  describeLocator,
  type ExecutableSpec,
  type ExecutableStep,
  type InputValue,
  type Locator,
  redactSecrets,
  referencedSecrets,
  type TenantScope,
} from '@qa/domain';
import { evidenceKey, type EvidenceStore, type StoredObject } from '@qa/evidence';

/** Administrator-managed target; never derived from a spec, model output or user-supplied URL. */
export type ExecutionTarget = { baseUrl: string; allowedHosts: string[] };

/** Resolves secret references at run time (e.g. from a vault or `QA_SECRET_<NAME>`). */
export type SecretResolver = (name: string) => string | undefined;

/** `null` = could not be evaluated (not the same as a failed assertion). */
export type Assertion = {
  stepId: string;
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean | null;
};

export type StepLog = {
  id: string;
  phase: 'setup' | 'steps' | 'teardown';
  type: ExecutableStep['type'];
  description: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  error?: string;
  durationMs: number;
  screenshot?: string;
};

export type EvidenceItem = {
  kind: 'screenshot' | 'step-log' | 'network-log';
  name: string;
  contentType: string;
} & StoredObject;

export type ExecutionOutcome = {
  verdict: 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
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
    const valueOf = (v: InputValue) => (typeof v === 'string' ? v : resolved.get(v.secret)!);
    const show = (v: InputValue) =>
      typeof v === 'string' ? JSON.stringify(redact(v)) : `[secret:${v.secret}]`;

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
        acceptDownloads: false,
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 800 },
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
            const assertion = await this.runStep(page, context!, step, base, valueOf, masked, timeout);
            if (assertion) {
              out.assertions.push(assertion);
              if (assertion.passed !== true) log.status = 'failed';
            }
            if (assertion || step.type === 'navigate') log.screenshot = await screenshot(step.id);
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

      try {
        const setupFailed = await runPhase('setup', spec.setup, true);
        if (setupFailed) {
          for (const s of spec.steps) {
            out.steps.push({
              id: s.id,
              phase: 'steps',
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

  /** Executes one step. Returns an assertion for expect* steps (and API steps with expectStatus). */
  private async runStep(
    page: Page,
    context: BrowserContext,
    step: ExecutableStep,
    base: URL,
    valueOf: (v: InputValue) => string,
    masked: PwLocator[],
    timeout: number,
  ): Promise<Assertion | null> {
    const assertion = (expected: unknown, actual: unknown, passed: boolean | null): Assertion => ({
      stepId: step.id,
      name: step.type,
      expected,
      actual,
      passed,
    });
    const timedOut = (err: unknown) => err instanceof Error && err.name === 'TimeoutError';

    switch (step.type) {
      case 'navigate': {
        const res = await page.goto(new URL(step.path, base).toString(), { waitUntil: 'load' });
        if (!res) throw new StepError('navigation produced no response');
        return null;
      }
      case 'click':
        await this.locate(page, step.target).click();
        return null;
      case 'fill': {
        const target = this.locate(page, step.target);
        await target.fill(valueOf(step.value));
        if (typeof step.value !== 'string') masked.push(target);
        return null;
      }
      case 'select':
        await this.locate(page, step.target).selectOption(step.option);
        return null;
      case 'expectText': {
        const target = this.locate(page, step.target);
        const re =
          step.match === 'exact'
            ? new RegExp(`^\\s*${escapeRe(step.text)}\\s*$`)
            : new RegExp(escapeRe(step.text));
        try {
          // Waits on the real signal (the target containing the text), never a fixed sleep.
          await target.filter({ hasText: re }).waitFor({ state: 'visible', timeout });
          return assertion(step.text, step.text, true);
        } catch (err) {
          if (!timedOut(err)) throw err;
          const actual = await target.innerText({ timeout: 1000 }).catch(() => null);
          return assertion(step.text, actual?.trim() ?? null, actual === null ? null : false);
        }
      }
      case 'expectVisible':
      case 'expectHidden': {
        const state = step.type === 'expectVisible' ? 'visible' : 'hidden';
        try {
          await this.locate(page, step.target).waitFor({ state, timeout });
          return assertion(state, state, true);
        } catch (err) {
          if (!timedOut(err)) throw err;
          return assertion(state, state === 'visible' ? 'not visible' : 'visible', false);
        }
      }
      case 'expectUrl': {
        const matches = (u: URL) =>
          u.host === base.host &&
          (step.match === 'exact' ? u.pathname === step.path : u.pathname.startsWith(step.path));
        try {
          await page.waitForURL(matches, { timeout, waitUntil: 'commit' });
          return assertion(step.path, step.path, true);
        } catch (err) {
          if (!timedOut(err)) throw err;
          return assertion(step.path, new URL(page.url()).pathname, false);
        }
      }
      case 'apiRequest': {
        const data = step.body
          ? Object.fromEntries(Object.entries(step.body).map(([k, v]) => [k, valueOf(v)]))
          : undefined;
        const res = await context.request.fetch(new URL(step.path, base).toString(), {
          method: step.method,
          ...(data ? { data } : {}),
          maxRedirects: 0,
          timeout,
        });
        return step.expectStatus === undefined
          ? null
          : assertion(step.expectStatus, res.status(), res.status() === step.expectStatus);
      }
    }
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
      return `${step.method} ${step.path}${step.expectStatus ? ` expect ${step.expectStatus}` : ''}`;
  }
}
