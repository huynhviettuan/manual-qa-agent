import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  CASE_TRANSITIONS,
  DomainError,
  REVIEW_STATUSES,
  REVIEW_TRANSITIONS,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  transitionCase,
  transitionReview,
  transitionRun,
} from '../src/index.ts';

function allPairs<S extends string>(statuses: readonly S[]) {
  return statuses.flatMap((from) => statuses.map((to) => [from, to] as const));
}

describe('test case state machine', () => {
  it.each([
    ['DRAFT', 'NEEDS_CLARIFICATION'],
    ['NEEDS_CLARIFICATION', 'DRAFT'],
    ['DRAFT', 'IN_REVIEW'],
    ['IN_REVIEW', 'APPROVED'],
    ['APPROVED', 'RETIRED'],
    ['IN_REVIEW', 'REJECTED'],
    ['REJECTED', 'DRAFT'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(transitionCase(from, to)).toBe(to);
  });

  it('rejects every transition not in the table', () => {
    for (const [from, to] of allPairs(CASE_STATUSES)) {
      if (CASE_TRANSITIONS[from].includes(to)) continue;
      expect(() => transitionCase(from, to)).toThrow(DomainError);
    }
  });

  it('cannot approve a draft without review', () => {
    expect(() => transitionCase('DRAFT', 'APPROVED')).toThrow(/DRAFT -> APPROVED/);
  });
});

describe('run state machine', () => {
  it('policy check can block before running', () => {
    expect(transitionRun('POLICY_CHECK', 'BLOCKED')).toBe('BLOCKED');
  });

  it('terminal states have no exits', () => {
    for (const s of ['PASSED', 'FAILED', 'BLOCKED', 'INCONCLUSIVE', 'CANCELLED'] as const) {
      expect(RUN_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('rejects every transition not in the table', () => {
    for (const [from, to] of allPairs(RUN_STATUSES)) {
      if (RUN_TRANSITIONS[from].includes(to)) continue;
      expect(() => transitionRun(from, to)).toThrow(DomainError);
    }
  });
});

describe('review state machine', () => {
  it('NEEDS_INFO returns to ASSIGNED', () => {
    expect(transitionReview('NEEDS_INFO', 'ASSIGNED')).toBe('ASSIGNED');
  });

  it('resolved reviews cannot be reopened', () => {
    expect(() => transitionReview('APPROVED', 'OPEN')).toThrow(DomainError);
    expect(() => transitionReview('REJECTED', 'APPROVED')).toThrow(DomainError);
  });

  it('rejects every transition not in the table', () => {
    for (const [from, to] of allPairs(REVIEW_STATUSES)) {
      if (REVIEW_TRANSITIONS[from].includes(to)) continue;
      expect(() => transitionReview(from, to)).toThrow(DomainError);
    }
  });
});
