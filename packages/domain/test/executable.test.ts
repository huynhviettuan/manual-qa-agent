import { describe, expect, it } from 'vitest';
import {
  describeLocator,
  destructiveSteps,
  ExecutableSpec,
  referencedSecrets,
  specHash,
  type ExecutableSpecInput,
} from '../src/index.ts';

const valid: ExecutableSpecInput = {
  steps: [
    { id: 'open', type: 'navigate', path: '/login' },
    {
      id: 'email',
      type: 'fill',
      target: { by: 'label', label: 'Email', within: { by: 'testId', testId: 'login-form' } },
      value: 'qa@example.test',
    },
    {
      id: 'pw',
      type: 'fill',
      target: { by: 'label', label: 'Password' },
      value: { secret: 'DEMO_PASSWORD' },
    },
    { id: 'submit', type: 'click', target: { by: 'role', role: 'button', name: 'Sign in' } },
    { id: 'welcome', type: 'expectText', target: { by: 'role', role: 'status' }, text: 'Welcome back' },
  ],
};

describe('ExecutableSpec', () => {
  it('accepts a well-formed spec and applies defaults', () => {
    const spec = ExecutableSpec.parse(valid);
    expect(spec.setup).toEqual([]);
    expect(spec.steps[4]).toMatchObject({ match: 'contains', sourceRefs: [] });
  });

  it.each([
    ['absolute URL', 'https://evil.example/steal'],
    ['protocol-relative URL', '//evil.example/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative without slash', 'login'],
  ])('rejects navigation to an %s', (_name, path) => {
    const spec = { steps: [{ id: 'n', type: 'navigate', path }, valid.steps[4]] };
    expect(ExecutableSpec.safeParse(spec).success).toBe(false);
  });

  it('scopes custom-select options through their listbox and fields through the main landmark', () => {
    const option = { by: 'role', role: 'option', name: 'Zalo', within: { by: 'role', role: 'listbox' } };
    const field = { by: 'label', label: 'Email', within: { by: 'role', role: 'main' } };
    const spec = {
      steps: [
        { id: 'pick', type: 'click', target: option },
        { id: 'see', type: 'expectVisible', target: field },
      ],
    };
    expect(ExecutableSpec.safeParse(spec).success).toBe(true);
    const unknownRole = {
      steps: [{ id: 'see', type: 'expectVisible', target: { by: 'role', role: 'iframe' } }],
    };
    expect(ExecutableSpec.safeParse(unknownRole).success).toBe(false);
  });

  it('rejects unknown step types (no arbitrary script)', () => {
    const spec = { steps: [{ id: 'x', type: 'evaluate', script: 'document.cookie' }, valid.steps[4]] };
    expect(ExecutableSpec.safeParse(spec).success).toBe(false);
  });

  it('requires at least one assertion', () => {
    expect(ExecutableSpec.safeParse({ steps: [valid.steps[0]] }).error?.message).toMatch(/assertion/);
  });

  it('rejects duplicate step ids', () => {
    expect(ExecutableSpec.safeParse({ steps: [valid.steps[4], valid.steps[4]] }).error?.message).toMatch(
      /duplicate/,
    );
  });

  it('only accepts secrets by reference name', () => {
    const bad = { steps: [{ ...valid.steps[2], value: { secret: 'lowercase-name' } }, valid.steps[4]] };
    expect(ExecutableSpec.safeParse(bad).success).toBe(false);
    expect(referencedSecrets(ExecutableSpec.parse(valid))).toEqual(['DEMO_PASSWORD']);
  });

  it('detects destructive steps, including any DELETE request', () => {
    const spec = ExecutableSpec.parse({
      ...valid,
      steps: [
        ...valid.steps,
        {
          id: 'del',
          type: 'click',
          target: { by: 'role', role: 'button', name: 'Delete account' },
          destructive: true,
        },
      ],
      teardown: [{ id: 'cleanup', type: 'apiRequest', method: 'DELETE', path: '/api/users/qa' }],
    });
    expect(destructiveSteps(spec)).toEqual(['del', 'cleanup']);
    expect(destructiveSteps(ExecutableSpec.parse(valid))).toEqual([]);
  });

  it('hashes specs canonically so approvals bind to exact content', () => {
    const a = ExecutableSpec.parse(valid);
    const b = ExecutableSpec.parse(JSON.parse(JSON.stringify(valid)));
    expect(specHash(a)).toBe(specHash(b));
    const changed = ExecutableSpec.parse({
      ...valid,
      steps: [...valid.steps.slice(0, 4), { ...valid.steps[4], text: 'Hi' }],
    });
    expect(specHash(changed)).not.toBe(specHash(a));
  });

  it('describes scoped locators', () => {
    expect(
      describeLocator({ by: 'label', label: 'Email', within: { by: 'testId', testId: 'login-form' } }),
    ).toBe('testId=login-form >> label="Email"');
  });
});
