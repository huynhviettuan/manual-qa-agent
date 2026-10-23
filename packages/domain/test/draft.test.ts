import { describe, expect, it } from 'vitest';
import { DraftContent, DraftOutput } from '../src/index.ts';

const v1 = {
  title: 'Lockout',
  priority: 'P1',
  preconditions: [],
  testData: [],
  steps: [{ action: 'Fail login 5 times', expected: 'Locked 15 minutes', sourceRefs: ['AC-LOGIN@v2'] }],
  assumptions: [],
  missingRequirements: [],
};

describe('draft content (ADR-0014)', () => {
  it('reads revisions written before draft-v2 with empty test-design fields', () => {
    expect(DraftContent.parse(v1)).toMatchObject({
      requirementRefs: [],
      techniques: [],
      testTypes: [],
      testConditions: [],
    });
  });

  it('requires the test-design fields from the model', () => {
    expect(DraftOutput.safeParse(v1).success).toBe(false);
    const v2 = {
      ...v1,
      requirementRefs: ['story:AC-1'],
      techniques: ['boundary_value_analysis'],
      testTypes: ['boundary'],
      testConditions: ['5 failed logins'],
    };
    expect(DraftOutput.safeParse(v2).success).toBe(true);
  });

  it('accepts only known techniques and test types', () => {
    expect(DraftContent.safeParse({ ...v1, techniques: ['vibes'] }).success).toBe(false);
    expect(DraftContent.safeParse({ ...v1, testTypes: ['smoke'] }).success).toBe(false);
    // The full lists of the manual-test-design skill are accepted.
    const all = {
      ...v1,
      techniques: [
        'metamorphic',
        'scenario',
        'domain',
        'exploratory',
        'checklist',
        'defect_based',
        'attack_based',
      ],
      testTypes: ['concurrency', 'end_to_end', 'ui', 'accessibility'],
    };
    expect(DraftContent.safeParse(all).success).toBe(true);
  });
});
