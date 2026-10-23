import { describe, expect, it } from 'vitest';
import {
  deriveValue,
  describeLocator,
  destructiveSteps,
  ExecutableSpec,
  referencedSecrets,
  renderTemplate,
  specHash,
  stepVars,
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
    const confirm = {
      by: 'role',
      role: 'button',
      name: 'Merge',
      within: { by: 'role', role: 'alertdialog' },
    };
    const spec = {
      steps: [
        { id: 'pick', type: 'click', target: option },
        { id: 'see', type: 'expectVisible', target: field },
        { id: 'confirm', type: 'expectVisible', target: confirm },
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

describe('run-scoped values (ADR-0015)', () => {
  const main = { by: 'role', role: 'main' } as const;

  it('accepts declared values and values captured before use, in paths, text and inputs', () => {
    const spec = ExecutableSpec.parse({
      values: { due: { date: { offsetDays: 30, format: 'dd/MM/yyyy', timeZone: 'Asia/Ho_Chi_Minh' } } },
      steps: [
        { id: 'open', type: 'navigate', path: '/customers/new' },
        {
          id: 'due',
          type: 'fill',
          target: { by: 'label', label: 'Due', within: main },
          value: { var: 'due' },
        },
        {
          id: 'id',
          type: 'capture',
          as: 'customer_id',
          from: { kind: 'url' },
          pattern: '/customers/([a-z0-9-]+)$',
        },
        {
          id: 'code',
          type: 'capture',
          as: 'code',
          from: { kind: 'text', target: { by: 'testId', testId: 'code' } },
        },
        { id: 'reopen', type: 'navigate', path: '/customers/{{customer_id}}' },
        { id: 'shown', type: 'expectText', target: main, text: 'Mã {{code}}, hạn {{due}}' },
        {
          id: 'api',
          type: 'apiRequest',
          method: 'GET',
          path: '/api/customers/{{customer_id}}',
          expectStatus: 200,
        },
      ],
    });
    expect(stepVars(spec.steps[5]!)).toEqual(['code', 'due']);
    expect(stepVars(spec.steps[1]!)).toEqual(['due']);
    expect(referencedSecrets(spec)).toEqual([]);
  });

  it('rejects a value that is neither declared nor captured earlier, and a capture that shadows a declared value', () => {
    const undefinedUse = ExecutableSpec.safeParse({
      steps: [
        { id: 'open', type: 'navigate', path: '/customers/{{customer_id}}' },
        { id: 'id', type: 'capture', as: 'customer_id', from: { kind: 'url' } },
        { id: 'ok', type: 'expectVisible', target: main },
      ],
    });
    expect(undefinedUse.success).toBe(false);
    expect(JSON.stringify(undefinedUse.error?.issues)).toContain(
      'step open uses undefined value {{customer_id}}',
    );
    const shadow = ExecutableSpec.safeParse({
      values: { today: { date: { offsetDays: 0, format: 'yyyy-MM-dd' } } },
      steps: [
        { id: 'open', type: 'navigate', path: '/' },
        { id: 'cap', type: 'capture', as: 'today', from: { kind: 'url' } },
        { id: 'ok', type: 'expectVisible', target: main },
      ],
    });
    expect(JSON.stringify(shadow.error?.issues)).toContain('captures today, which is a declared value');
  });

  it('rejects capture patterns without exactly one group, bad names, and templates that break the path rules', () => {
    const bad = (step: Record<string, unknown>) =>
      ExecutableSpec.safeParse({
        steps: [
          { id: 'open', type: 'navigate', path: '/' },
          step,
          { id: 'ok', type: 'expectVisible', target: main },
        ],
      }).success;
    expect(bad({ id: 'c', type: 'capture', as: 'x', from: { kind: 'url' }, pattern: 'no-group' })).toBe(
      false,
    );
    expect(bad({ id: 'c', type: 'capture', as: 'x', from: { kind: 'url' }, pattern: '(a)(b)' })).toBe(false);
    expect(bad({ id: 'c', type: 'capture', as: 'x', from: { kind: 'url' }, pattern: '([' })).toBe(false);
    expect(bad({ id: 'c', type: 'capture', as: 'Bad-Name', from: { kind: 'url' } })).toBe(false);
    expect(bad({ id: 'c', type: 'capture', as: 'x', from: { kind: 'url' }, pattern: '(.+)' })).toBe(true);
    expect(
      ExecutableSpec.safeParse({
        ...valid,
        steps: [{ id: 'n', type: 'navigate', path: '{{x}}/a' }, ...valid.steps],
      }).success,
    ).toBe(false);
    expect(
      ExecutableSpec.safeParse({
        ...valid,
        steps: [{ id: 'n', type: 'navigate', path: '/a/{{x}} b' }, ...valid.steps],
      }).success,
    ).toBe(false);
  });

  it('derives dates in the zone, shifting calendar days, in each format', () => {
    // 2026-03-29T23:30Z is already 30 March in Ho Chi Minh City (UTC+7) and still 29 March in UTC.
    const now = new Date('2026-03-29T23:30:00Z');
    const hcm = (offsetDays: number, format: 'yyyy-MM-dd' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'd/M/yyyy') =>
      deriveValue({ date: { offsetDays, format, timeZone: 'Asia/Ho_Chi_Minh' } }, now);
    expect(hcm(0, 'yyyy-MM-dd')).toBe('2026-03-30');
    expect(deriveValue({ date: { offsetDays: 0, format: 'yyyy-MM-dd' } }, now)).toBe('2026-03-29');
    expect(hcm(2, 'dd/MM/yyyy')).toBe('01/04/2026');
    expect(hcm(-30, 'MM/dd/yyyy')).toBe('02/28/2026');
    expect(hcm(5, 'd/M/yyyy')).toBe('4/4/2026');
    // Across a DST change in Europe the calendar day still shifts by exactly one.
    expect(
      deriveValue(
        { date: { offsetDays: 1, format: 'yyyy-MM-dd', timeZone: 'Europe/Berlin' } },
        new Date('2026-03-28T12:00:00Z'),
      ),
    ).toBe('2026-03-29');
  });

  it('fills templates from the table and names the first missing value', () => {
    const table = new Map([
      ['id', 'c_42'],
      ['code', 'KH-7'],
    ]);
    expect(renderTemplate('/customers/{{id}}?c={{code}}', table)).toBe('/customers/c_42?c=KH-7');
    expect(() => renderTemplate('{{id}}/{{missing}}', table)).toThrow('undefined value {{missing}}');
  });
});
