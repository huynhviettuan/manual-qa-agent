import { z } from 'zod';
import { DomainError } from '@qa/domain';

/** External bug tracker port. Implementations never decide *whether* to write; policy does. */
export type TrackerIssue = { key: string; url: string };

export interface BugTracker {
  readonly name: string;
  /** Destination (e.g. Jira project key); part of the approved action hash. */
  readonly target: string;
  /** Idempotency: find an issue previously created for this label (crash/retry safety). */
  findByLabel(label: string): Promise<TrackerIssue | null>;
  create(input: { summary: string; description: string; labels: string[] }): Promise<TrackerIssue>;
  /** Reversal: label + comment (+ optional transition); never deletes data. */
  revert(key: string, comment: string): Promise<void>;
}

export class TrackerError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

export type JiraConfig = {
  /** e.g. https://your-site.atlassian.net (HTTPS only). */
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType?: string;
  /** Optional workflow transition applied on revert (IDs are workflow-specific). */
  revertTransitionId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
};

const CreatedIssue = z.object({ id: z.string(), key: z.string(), self: z.string() });
const SearchResult = z.object({ issues: z.array(z.object({ id: z.string(), key: z.string() })) });
const LABEL = /^[A-Za-z0-9_.-]{1,255}$/;

/** Plain text -> Atlassian Document Format (paragraphs; single newlines become hard breaks). */
export function toAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .map((p) => ({
        type: 'paragraph',
        content: p
          .split('\n')
          .flatMap((line, i) => [
            ...(i > 0 ? [{ type: 'hardBreak' }] : []),
            ...(line ? [{ type: 'text', text: line }] : []),
          ]),
      })),
  };
}

/**
 * Jira Cloud REST API v3 (checked against Atlassian's published OpenAPI spec on 2026-10-09):
 * POST /rest/api/3/issue, GET /rest/api/3/search/jql (the old /search is deprecated),
 * PUT /rest/api/3/issue/{key} (update.labels add), POST .../comment, POST .../transitions.
 * Auth: Basic with account email + API token.
 */
export class JiraCloudTracker implements BugTracker {
  readonly name = 'jira';
  readonly target: string;
  private readonly base: URL;
  private readonly auth: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: JiraConfig) {
    this.base = new URL(config.baseUrl);
    if (this.base.protocol !== 'https:') throw new DomainError('VALIDATION', 'Jira base URL must be https');
    if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(config.projectKey))
      throw new DomainError('VALIDATION', 'invalid Jira project key');
    this.target = config.projectKey;
    this.auth = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
    this.doFetch = config.fetch ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T> | null,
    body?: unknown,
  ): Promise<T> {
    const retries = this.config.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(new URL(path, this.base).toString(), {
          method,
          headers: {
            authorization: this.auth,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
        });
      } catch (err) {
        if (attempt < retries) continue;
        throw new TrackerError(null, `Jira unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        // Honour Retry-After (seconds), bounded so a misbehaving server cannot stall a request.
        const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), 10) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        // Error bodies may echo request data; keep only the status and a short, bounded message.
        const text = (await res.text().catch(() => '')).slice(0, 300);
        throw new TrackerError(
          res.status,
          `Jira ${method} ${path.split('?')[0]} failed: ${res.status} ${text}`,
        );
      }
      if (!schema) return undefined as T;
      const parsed = schema.safeParse(await res.json().catch(() => null));
      if (!parsed.success)
        throw new TrackerError(res.status, `unexpected Jira response for ${method} ${path.split('?')[0]}`);
      return parsed.data;
    }
  }

  private url(key: string) {
    return new URL(`/browse/${encodeURIComponent(key)}`, this.base).toString();
  }

  async findByLabel(label: string): Promise<TrackerIssue | null> {
    if (!LABEL.test(label)) throw new DomainError('VALIDATION', `invalid Jira label "${label}"`);
    const jql = `project = "${this.target}" AND labels = "${label}"`;
    const q = new URLSearchParams({ jql, fields: 'key', maxResults: '1' });
    const res = await this.request('GET', `/rest/api/3/search/jql?${q}`, SearchResult);
    const hit = res.issues[0];
    return hit ? { key: hit.key, url: this.url(hit.key) } : null;
  }

  async create(input: { summary: string; description: string; labels: string[] }): Promise<TrackerIssue> {
    for (const l of input.labels)
      if (!LABEL.test(l)) throw new DomainError('VALIDATION', `invalid Jira label "${l}"`);
    const created = await this.request('POST', '/rest/api/3/issue', CreatedIssue, {
      fields: {
        project: { key: this.target },
        issuetype: { name: this.config.issueType ?? 'Bug' },
        summary: input.summary.slice(0, 250),
        description: toAdf(input.description),
        labels: input.labels,
      },
    });
    return { key: created.key, url: this.url(created.key) };
  }

  async revert(key: string, comment: string): Promise<void> {
    const issue = encodeURIComponent(key);
    await this.request('PUT', `/rest/api/3/issue/${issue}`, null, {
      update: { labels: [{ add: 'qa-agent-reverted' }] },
    });
    await this.request('POST', `/rest/api/3/issue/${issue}/comment`, null, { body: toAdf(comment) });
    if (this.config.revertTransitionId) {
      await this.request('POST', `/rest/api/3/issue/${issue}/transitions`, null, {
        transition: { id: this.config.revertTransitionId },
      });
    }
  }
}

/**
 * Off unless `QA_JIRA_ENABLED=1`. Then requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and
 * JIRA_PROJECT_KEY; optional JIRA_ISSUE_TYPE (default Bug) and JIRA_REVERT_TRANSITION_ID.
 */
export function createBugTrackerFromEnv(env: NodeJS.ProcessEnv = process.env): BugTracker | null {
  if (env.QA_JIRA_ENABLED !== '1') return null;
  const missing = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'].filter(
    (k) => !env[k],
  );
  if (missing.length) throw new DomainError('VALIDATION', `QA_JIRA_ENABLED=1 requires ${missing.join(', ')}`);
  return new JiraCloudTracker({
    baseUrl: env.JIRA_BASE_URL!,
    email: env.JIRA_EMAIL!,
    apiToken: env.JIRA_API_TOKEN!,
    projectKey: env.JIRA_PROJECT_KEY!,
    issueType: env.JIRA_ISSUE_TYPE || undefined,
    revertTransitionId: env.JIRA_REVERT_TRANSITION_ID || undefined,
  });
}
