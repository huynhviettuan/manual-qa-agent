import { describe, expect, it } from 'vitest';
import {
  createBugTrackerFromEnv,
  createFakeJira,
  JiraCloudTracker,
  toAdf,
  TrackerError,
} from '../src/index.ts';

const config = {
  baseUrl: 'https://example.atlassian.net',
  email: 'qa-bot@example.test',
  apiToken: 'fake-api-token',
  projectKey: 'QA',
};

describe('JiraCloudTracker (mocked Jira Cloud REST v3)', () => {
  it('creates a Bug with ADF description and labels, using Basic auth', async () => {
    const jira = createFakeJira();
    const t = new JiraCloudTracker({ ...config, fetch: jira.fetch });
    const issue = await t.create({
      summary: 'Login leaks account existence',
      description: 'Line 1\nLine 2\n\nPara 2',
      labels: ['qa-agent', 'qa-agent-bug-bug_1'],
    });
    expect(issue).toEqual({ key: 'QA-1', url: 'https://example.atlassian.net/browse/QA-1' });
    const stored = jira.issues.get('QA-1')!;
    expect(stored.fields).toMatchObject({
      summary: 'Login leaks account existence',
      issuetype: { name: 'Bug' },
      labels: ['qa-agent', 'qa-agent-bug-bug_1'],
    });
    expect(stored.fields.description).toEqual(toAdf('Line 1\nLine 2\n\nPara 2'));
    expect(jira.authHeaders[0]).toBe(
      `Basic ${Buffer.from('qa-bot@example.test:fake-api-token').toString('base64')}`,
    );
  });

  it('finds previously created issues by label (idempotent publish)', async () => {
    const jira = createFakeJira();
    const t = new JiraCloudTracker({ ...config, fetch: jira.fetch });
    expect(await t.findByLabel('qa-agent-bug-x')).toBeNull();
    await t.create({ summary: 's', description: 'd', labels: ['qa-agent-bug-x'] });
    expect(await t.findByLabel('qa-agent-bug-x')).toMatchObject({ key: 'QA-1' });
  });

  it('reverts with a label, a comment and an optional transition (never deletes)', async () => {
    const jira = createFakeJira();
    const t = new JiraCloudTracker({ ...config, fetch: jira.fetch, revertTransitionId: '31' });
    await t.create({ summary: 's', description: 'd', labels: ['qa-agent'] });
    await t.revert('QA-1', 'Reverted by QA lead: not reproducible');
    const issue = jira.issues.get('QA-1')!;
    expect(issue.fields.labels).toContain('qa-agent-reverted');
    expect(issue.comments).toEqual([toAdf('Reverted by QA lead: not reproducible')]);
    expect(issue.transitions).toEqual(['31']);
  });

  it('retries 5xx a bounded number of times, then raises TrackerError with the status', async () => {
    const recovering = createFakeJira({ failCreateTimes: 1 });
    await expect(
      new JiraCloudTracker({ ...config, fetch: recovering.fetch }).create({
        summary: 's',
        description: 'd',
        labels: [],
      }),
    ).resolves.toMatchObject({ key: 'QA-1' });
    const down = createFakeJira({ failCreateTimes: 9 });
    const err = await new JiraCloudTracker({ ...config, fetch: down.fetch })
      .create({ summary: 's', description: 'd', labels: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect(err.status).toBe(503);
    expect(down.issues.size).toBe(0);
  });

  it('rejects non-HTTPS base URLs, bad project keys and labels with spaces', () => {
    expect(() => new JiraCloudTracker({ ...config, baseUrl: 'http://example.atlassian.net' })).toThrow(
      /https/,
    );
    expect(() => new JiraCloudTracker({ ...config, projectKey: 'qa project' })).toThrow(/project key/);
    const t = new JiraCloudTracker({ ...config, fetch: createFakeJira().fetch });
    return expect(t.create({ summary: 's', description: 'd', labels: ['has space'] })).rejects.toThrow(
      /label/,
    );
  });

  it('is disabled unless explicitly enabled, and then requires full configuration', () => {
    expect(createBugTrackerFromEnv({})).toBeNull();
    expect(() => createBugTrackerFromEnv({ QA_JIRA_ENABLED: '1', JIRA_BASE_URL: config.baseUrl })).toThrow(
      /JIRA_EMAIL/,
    );
  });
});
