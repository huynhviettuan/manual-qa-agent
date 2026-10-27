import { describe, expect, it } from 'vitest';
import { buildVocabulary, DraftContent, unobservableExpectation } from '@qa/domain';
import { checkDraftSet } from '../src/grounding.ts';
import type { CallMeta } from '../src/types.ts';

// ADR-0025/0026: the product's own terms make an expected result observable to someone who knows it.

const meta: CallMeta = {
  provider: 'test',
  requestedModel: 'x',
  model: 'x',
  promptVersion: 'draft-v6',
  inputHash: 'h',
  usage: null,
  latencyMs: 0,
};
const story = {
  externalId: 'V-1',
  title: 'Payments',
  description: '',
  acceptanceCriteria: [{ id: 'AC-1', text: 'A partly paid contract shows its payment status' }],
};
const source = {
  sourceId: 'BR-7',
  version: 'v1',
  chunkId: 'c',
  content: 'A contract with debt is PARTIAL; the status "Đã thanh toán" means fully paid.',
  trustTier: 'T1' as const,
  relevance: 1,
};
const aCase = (expected: string) =>
  DraftContent.parse({
    title: 'Payment status',
    priority: 'P2',
    preconditions: [],
    testData: [],
    steps: [
      {
        action: 'Record half the amount',
        expected,
        sourceRefs: ['BR-7@v1'],
        testData: '',
        evidence: 'A contract with debt is PARTIAL',
      },
    ],
    assumptions: [],
    missingRequirements: [],
    requirementRefs: ['story:AC-1'],
    techniques: ['equivalence_partitioning'],
    testTypes: ['positive'],
    module: 'Money',
    level: 'ui',
  });

describe('product vocabulary', () => {
  it('derives terms from quoted strings, codes and capitalised labels', () => {
    const v = buildVocabulary([
      'The status "Đã thanh toán" means paid; a code ACCOUNT_LOCKED; the Fitness Manager approves.',
    ]);
    expect(v).toEqual(expect.arrayContaining(['đã thanh toán', 'account_locked', 'fitness manager']));
    expect(unobservableExpectation('Payment status Paid', [])).not.toBeNull();
    expect(unobservableExpectation('Payment status Paid', ['paid'])).toBeNull();
  });

  it('the draft check uses the cited sources and the project vocabulary', () => {
    const flagsOf = (expected: string, vocabulary?: string[]) => {
      const out = checkDraftSet(
        { story, sources: [source], vocabulary },
        { ok: true, value: { designNotes: [], cases: [aCase(expected)] }, meta },
      );
      return out.ok ? out.value.cases[0]!.reviewFlags.filter((f) => f.includes('no exact')) : ['not ok'];
    };
    expect(flagsOf('The contract shows PARTIAL')).toEqual([]); // a code the source names
    expect(flagsOf('The contract shows Còn nợ')).toHaveLength(1); // nothing names it
    expect(flagsOf('The contract shows Còn nợ', ['Còn nợ'])).toEqual([]); // the VOCABULARY source does
  });
});
