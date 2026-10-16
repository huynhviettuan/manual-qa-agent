// Thin HTTP client for the QA API, used by the agent tool server (ADR-0011). The server's own auth, roles and
// policy stay authoritative: this client adds nothing but transport, typed errors and bounded polling.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Me = { actorId: string; tenantId: string; projectId: string; roles: string[] };

export type CaseRevision = {
  revision: number;
  status: string;
  content: unknown;
  sourceRefs: string[];
};

export type RunReport = {
  id: string;
  status: string;
  reason?: string | null;
  [key: string]: unknown;
};

export const TERMINAL_RUN_STATUSES = new Set(['PASSED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED', 'CANCELLED']);

export type QaApiOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
};

export class QaApiClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: QaApiOptions) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('QA_API_URL must be http(s)');
    this.base = url.toString().replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; data: T }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        'x-api-key': this.opts.apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    const data = (isJson && text ? JSON.parse(text) : text) as T;
    if (res.status >= 400) {
      const err = (isJson ? data : {}) as { error?: string; message?: string };
      throw new ApiError(
        res.status,
        err.error ?? `HTTP_${res.status}`,
        err.message ?? (text.slice(0, 300) || res.statusText),
      );
    }
    return { status: res.status, data };
  }

  me() {
    return this.request<Me>('GET', '/api/me').then((r) => r.data);
  }

  getTestCase(caseId: string) {
    return this.request<{ caseId: string; storyId: string; revisions: CaseRevision[] }>(
      'GET',
      `/api/test-cases/${encodeURIComponent(caseId)}`,
    ).then((r) => r.data);
  }

  proposeExecutable(caseId: string, spec: unknown) {
    return this.request<Record<string, unknown>>(
      'POST',
      `/api/test-cases/${encodeURIComponent(caseId)}/executables`,
      { spec },
    ).then((r) => r.data);
  }

  requestRun(input: { caseId: string; environmentId: string; approvalId?: string }, idempotencyKey?: string) {
    return this.request<RunReport>(
      'POST',
      '/api/test-runs',
      input,
      idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    ).then((r) => r.data);
  }

  getRun(runId: string) {
    return this.request<RunReport>('GET', `/api/test-runs/${encodeURIComponent(runId)}`).then((r) => r.data);
  }

  /** Polls until the run is terminal or `waitMs` elapses; returns the last report either way. */
  async waitForRun(runId: string, waitMs: number, intervalMs = 2000): Promise<RunReport> {
    const deadline = Date.now() + waitMs;
    let report = await this.getRun(runId);
    while (!TERMINAL_RUN_STATUSES.has(report.status) && Date.now() < deadline) {
      // Bounded poll of an external worker's progress; the API offers no push notification.
      await new Promise((r) => setTimeout(r, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
      report = await this.getRun(runId);
    }
    return report;
  }

  async getTriage(runId: string): Promise<Record<string, unknown> | null> {
    try {
      return (
        await this.request<Record<string, unknown>>(
          'GET',
          `/api/test-runs/${encodeURIComponent(runId)}/triage`,
        )
      ).data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  getReproduction(runId: string) {
    return this.request<string>('GET', `/api/test-runs/${encodeURIComponent(runId)}/reproduction`).then(
      (r) => r.data,
    );
  }
}
