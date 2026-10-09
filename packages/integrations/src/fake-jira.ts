/**
 * In-memory stand-in for the Jira Cloud REST API v3 subset used by JiraCloudTracker, injected via
 * its `fetch` option. Tests assert on the resulting issues (observable state), not on call counts.
 */
export type FakeIssue = {
  key: string;
  fields: { summary: string; labels: string[]; description: unknown; issuetype: { name: string } };
  comments: unknown[];
  transitions: string[];
};

export function createFakeJira(
  opts: { projectKey?: string; failCreateTimes?: number; status?: number } = {},
) {
  const issues = new Map<string, FakeIssue>();
  let seq = 0;
  let failCreate = opts.failCreateTimes ?? 0;
  const authHeaders: string[] = [];
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    authHeaders.push(String((init?.headers as Record<string, string>)?.authorization ?? ''));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;

    if (method === 'GET' && path === '/rest/api/3/search/jql') {
      const label = /labels = "([^"]+)"/.exec(url.searchParams.get('jql') ?? '')?.[1];
      const hits = [...issues.values()].filter((i) => label && i.fields.labels.includes(label));
      return json(200, { issues: hits.slice(0, 1).map((i) => ({ id: i.key, key: i.key })), isLast: true });
    }
    if (method === 'POST' && path === '/rest/api/3/issue') {
      if (failCreate > 0) {
        failCreate--;
        return json(
          opts.status ?? 503,
          { errorMessages: ['temporarily unavailable'] },
          { 'retry-after': '0' },
        );
      }
      const key = `${opts.projectKey ?? 'QA'}-${++seq}`;
      issues.set(key, { key, fields: body.fields, comments: [], transitions: [] });
      return json(201, {
        id: String(10000 + seq),
        key,
        self: `${url.origin}/rest/api/3/issue/${10000 + seq}`,
      });
    }
    const m = /^\/rest\/api\/3\/issue\/([^/]+)(\/comment|\/transitions)?$/.exec(path);
    const issue = m ? issues.get(decodeURIComponent(m[1]!)) : undefined;
    if (m && !issue) return json(404, { errorMessages: ['Issue does not exist'] });
    if (issue && method === 'PUT' && !m![2]) {
      for (const op of body.update?.labels ?? []) if (op.add) issue.fields.labels.push(op.add);
      return json(204, undefined);
    }
    if (issue && method === 'POST' && m![2] === '/comment') {
      issue.comments.push(body.body);
      return json(201, { id: String(issue.comments.length) });
    }
    if (issue && method === 'POST' && m![2] === '/transitions') {
      issue.transitions.push(body.transition.id);
      return json(204, undefined);
    }
    return json(404, { errorMessages: [`no fake route for ${method} ${path}`] });
  }) as typeof fetch;

  return { fetch: fakeFetch, issues, authHeaders };
}
