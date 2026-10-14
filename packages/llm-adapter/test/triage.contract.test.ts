import { describe, expect, it } from 'vitest';
import {
  choiceAnswer,
  ClaudeProvider,
  createAnthropicClient,
  createFakeAnthropicFetch,
  createFakeJevFetch,
  createFakeOpenAIFetch,
  createJevClient,
  createOpenAIClient,
  createProvidersFromEnv,
  decisionReply,
  JevClassifier,
  jevChoice,
  jevReply,
  messageReply,
  OpenAIDecisionsClassifier,
  predicateAnswer,
  refusalAnswer,
  type TriageFacts,
} from '../src/index.ts';

const productDefect: TriageFacts = {
  verdict: 'FAILED',
  reason: 'ASSERTION_FAILED:message',
  environmentKind: 'staging',
  failingStep: {
    id: 'message',
    description: 'expect testId=login-message to have text "Invalid email or password"',
    expected: 'Invalid email or password',
    actual: 'User not found',
  },
  stepErrors: [],
  httpErrors: [],
  failedRequests: 0,
  blockedRequests: 1,
  consoleErrors: [],
};
const environment: TriageFacts = {
  ...productDefect,
  verdict: 'INCONCLUSIVE',
  reason: 'STEP_ERROR:open',
  failingStep: { id: 'open', description: 'navigate /reports', expected: null, actual: null },
  stepErrors: ['page.goto: net::ERR_CONNECTION_REFUSED'],
  httpErrors: [{ method: 'GET', path: '/reports', status: 503 }],
};
const testIssue: TriageFacts = {
  ...productDefect,
  verdict: 'INCONCLUSIVE',
  reason: 'STEP_ERROR:submit',
  failingStep: { id: 'submit', description: 'click role=textbox', expected: null, actual: null },
  stepErrors: ['locator.click: Error: strict mode violation: resolved to 2 elements'],
};

describe.each([
  { name: 'anthropic', env: {} },
  { name: 'openai', env: { QA_LLM_PROVIDER: 'openai' } },
  { name: 'jev', env: { QA_READINESS_PROVIDER: 'jev' } },
] as const)('triage conformance: $name', ({ name, env }) => {
  const { triager } = createProvidersFromEnv(env);

  it('an observed wrong value on a login message -> PRODUCT_DEFECT, security-sensitive', async () => {
    const out = await triager.triage(productDefect);
    expect(out).toMatchObject({
      ok: true,
      value: { suspectedCause: 'PRODUCT_DEFECT', securitySensitive: true },
    });
    expect(out.meta).toMatchObject({
      provider: `${name}-mock`,
      promptVersion: expect.stringMatching(/^triage-/),
    });
  });

  it('server errors -> ENVIRONMENT; strict-mode step errors -> TEST_ISSUE', async () => {
    expect((await triager.triage(environment)).ok && (await triager.triage(environment))).toMatchObject({
      value: { suspectedCause: 'ENVIRONMENT' },
    });
    expect(await triager.triage(testIssue)).toMatchObject({ value: { suspectedCause: 'TEST_ISSUE' } });
  });
});

describe('triage failure mapping', () => {
  it('Claude: refusal -> REFUSED; invalid cause -> MALFORMED; secrets redacted from facts', async () => {
    const refusing = createFakeAnthropicFetch(() =>
      messageReply(null, { stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'cyber' } }),
    );
    const c1 = new ClaudeProvider({ client: createAnthropicClient({ apiKey: 'k', fetch: refusing }) });
    expect(await c1.triage(productDefect)).toMatchObject({ ok: false, failure: 'REFUSED' });

    const invalid = createFakeAnthropicFetch(() =>
      messageReply({ suspectedCause: 'COSMIC_RAYS', securitySensitive: false, rationale: 'x' }),
    );
    const c2 = new ClaudeProvider({ client: createAnthropicClient({ apiKey: 'k', fetch: invalid }) });
    expect(await c2.triage(productDefect)).toMatchObject({ ok: false, failure: 'MALFORMED' });

    const capture = createFakeAnthropicFetch(() =>
      messageReply({ suspectedCause: 'UNKNOWN', securitySensitive: true, rationale: 'x' }),
    );
    const c3 = new ClaudeProvider({ client: createAnthropicClient({ apiKey: 'k', fetch: capture }) });
    await c3.triage({ ...productDefect, consoleErrors: ['Authorization: Bearer leaked.token.value'] });
    const sent = (capture.calls[0]!.body.messages as Array<{ content: string }>)[0]!.content;
    expect(sent).not.toContain('leaked.token.value');
  });

  it('OpenAI Decisions: refused cause -> REFUSED; a missing security answer escalates (fail safe)', async () => {
    const refused = createFakeOpenAIFetch(() =>
      decisionReply([refusalAnswer('cause'), predicateAnswer('security', 0.1)]),
    );
    const o1 = new OpenAIDecisionsClassifier({ client: createOpenAIClient({ apiKey: 'k', fetch: refused }) });
    expect(await o1.triage(productDefect)).toMatchObject({ ok: false, failure: 'REFUSED' });

    const noSecurity = createFakeOpenAIFetch(() => decisionReply([choiceAnswer('cause', 'TEST_ISSUE')]));
    const o2 = new OpenAIDecisionsClassifier({
      client: createOpenAIClient({ apiKey: 'k', fetch: noSecurity }),
    });
    expect(await o2.triage(testIssue)).toMatchObject({
      ok: true,
      value: { suspectedCause: 'TEST_ISSUE', securitySensitive: true, securityProbability: null },
    });
  });

  it('Jev: security probability at the 0.3 threshold escalates; below does not', async () => {
    const at = (p: number) =>
      new JevClassifier({
        client: createJevClient({
          apiKey: 'k',
          fetch: createFakeJevFetch(() =>
            jevReply({ cause: jevChoice('ENVIRONMENT'), security: { type: 'noul', noul: p } }),
          ),
        }),
      });
    expect((await at(0.3).triage(environment)).ok && (await at(0.3).triage(environment))).toMatchObject({
      value: { securitySensitive: true },
    });
    expect(await at(0.29).triage(environment)).toMatchObject({ value: { securitySensitive: false } });
  });
});
