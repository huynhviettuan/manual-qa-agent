import { describe, expect, it } from 'vitest';
import type { EvidenceChunk } from '@qa/domain';
import { createProvidersFromEnv } from '../src/index.ts';

const lockout: EvidenceChunk = {
  sourceId: 'AC-LOGIN',
  version: 'v2',
  chunkId: 'c1',
  content: 'AC-LOGIN-04\nAfter 5 failed logins the account is locked for 15 minutes.',
  trustTier: 'T1',
  relevance: 1,
};
const vague = { ...lockout, content: 'AC-LOGIN-04\nAccounts are locked after failed logins.' };
const story = {
  externalId: 'LOGIN-1',
  title: 'Account lockout',
  description: 'Lock accounts after failed logins',
  acceptanceCriteria: [{ id: 'AC-LOGIN-04', text: 'After multiple failed logins the user is locked out.' }],
};

describe('provider factory', () => {
  it('defaults to Claude for both steps in keyless mock mode', () => {
    expect(createProvidersFromEnv({})).toMatchObject({
      providers: { readiness: 'anthropic', draft: 'anthropic' },
      live: false,
      models: { readiness: 'claude-opus-5-5', draft: 'claude-opus-5-5' },
    });
  });

  it('openai: Decisions API for readiness, Responses API for drafts', () => {
    expect(createProvidersFromEnv({ QA_LLM_PROVIDER: 'openai' })).toMatchObject({
      providers: { readiness: 'openai', draft: 'openai' },
      models: { readiness: 'gpt-6-luna', draft: 'gpt-mock-draft' },
    });
  });

  it('jev answers readiness (pinned model) while drafts stay with the draft provider', () => {
    expect(createProvidersFromEnv({ QA_READINESS_PROVIDER: 'jev' })).toMatchObject({
      providers: { readiness: 'jev', draft: 'anthropic' },
      models: { readiness: 'jev-1.13.0', draft: 'claude-opus-5-5' },
    });
    expect(createProvidersFromEnv({ QA_READINESS_PROVIDER: 'jev', QA_LLM_PROVIDER: 'openai' })).toMatchObject(
      {
        providers: { readiness: 'jev', draft: 'openai' },
      },
    );
  });

  it('QA_DECISIONS_MODEL overrides the decision model', () => {
    const p = createProvidersFromEnv({ QA_READINESS_PROVIDER: 'jev', QA_DECISIONS_MODEL: 'jev-latest' });
    expect(p.models.readiness).toBe('jev-latest');
  });

  it('rejects invalid combinations with actionable messages', () => {
    expect(() => createProvidersFromEnv({ QA_LLM_PROVIDER: 'jev' })).toThrow(/readiness only/);
    expect(() => createProvidersFromEnv({ QA_LLM_PROVIDER: 'llama' })).toThrow(/anthropic, openai/);
    expect(() => createProvidersFromEnv({ QA_READINESS_PROVIDER: 'anthropic' })).toThrow(/openai, jev/);
  });

  it('live OpenAI drafts require an explicit model (none is assumed)', () => {
    expect(() => createProvidersFromEnv({ QA_LLM_PROVIDER: 'openai', QA_LIVE_LLM: '1' })).toThrow(
      /QA_LLM_MODEL/,
    );
  });
});

// Conformance: the same evidence must produce the same routing-relevant decisions whichever
// provider is configured (all in heuristic mode, through each provider's real SDK path).
const CONFIGS = [
  { name: 'anthropic', env: {} },
  { name: 'openai', env: { QA_LLM_PROVIDER: 'openai' } },
  { name: 'jev', env: { QA_READINESS_PROVIDER: 'jev' } },
] as const;

describe.each(CONFIGS)('readiness conformance: $name', ({ name, env }) => {
  const { classifier } = createProvidersFromEnv(env);

  it('measurable, sourced AC -> ready, citing the source', async () => {
    const out = await classifier.classify({ story, sources: [lockout] });
    expect(out).toMatchObject({ ok: true, value: { readiness: 'ready', citedSourceIds: ['AC-LOGIN@v2'] } });
  });

  it('vague AC -> clarification with a question naming the AC', async () => {
    const out = await classifier.classify({ story, sources: [vague] });
    expect(out.ok && out.value.readiness).toBe('clarification');
    expect(out.ok && out.value.clarificationQuestion).toContain('AC-LOGIN-04');
  });

  it('no sources -> blocked', async () => {
    const out = await classifier.classify({ story, sources: [] });
    expect(out.ok && out.value.readiness).toBe('blocked');
  });

  it('records the provider label and prompt version for audit', async () => {
    const out = await classifier.classify({ story, sources: [lockout] });
    expect(out.meta.provider).toBe(`${name}-mock`);
    expect(out.meta.promptVersion).toMatch(/^readiness-/);
  });
});

describe.each(['anthropic', 'openai'] as const)('draft conformance: %s', (draft) => {
  const { generator } = createProvidersFromEnv({ QA_LLM_PROVIDER: draft });

  it('draft steps cite only supplied sources', async () => {
    const out = await generator.generate({ story, sources: [lockout] });
    expect(out.ok && out.value.cases.flatMap((c) => c.steps.flatMap((s) => s.sourceRefs))).toEqual([
      'AC-LOGIN@v2',
    ]);
  });
});
