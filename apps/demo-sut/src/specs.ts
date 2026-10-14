import type { ExecutableSpecInput } from '@qa/domain';

// Executable specs for the demo app (ADR-0008). Every spec owns its test-data cleanup in
// `teardown`, which the executor always runs.

const reset = [
  { id: 'reset', type: 'apiRequest', method: 'POST', path: '/__test__/reset', expectStatus: 200 },
] as const satisfies ExecutableSpecInput['teardown'];

const form = { by: 'testId', testId: 'login-form' } as const;
const email = (value: string) =>
  ({ id: 'email', type: 'fill', target: { by: 'label', label: 'Email', within: form }, value }) as const;
const submit = {
  id: 'submit',
  type: 'click',
  target: { by: 'role', role: 'button', name: 'Sign in', within: form },
} as const;

export const loginValidSpec = {
  steps: [
    { id: 'open', type: 'navigate', path: '/login', sourceRefs: ['AC-LOGIN@v1'] },
    email('qa@example.test'),
    {
      id: 'password',
      type: 'fill',
      target: { by: 'label', label: 'Password', within: form },
      value: { secret: 'DEMO_PASSWORD' },
    },
    submit,
    { id: 'on-dashboard', type: 'expectUrl', path: '/dashboard', sourceRefs: ['AC-LOGIN@v1'] },
    {
      id: 'welcome',
      type: 'expectText',
      target: { by: 'testId', testId: 'welcome' },
      text: 'Welcome back',
      sourceRefs: ['AC-LOGIN@v1'],
    },
  ],
  teardown: [...reset],
} satisfies ExecutableSpecInput;

/** AC-LOGIN-02: unknown account and wrong password share one message (BUG-1042 regression). */
export const loginInvalidSpec = {
  steps: [
    { id: 'open', type: 'navigate', path: '/login' },
    email('nobody@example.test'),
    {
      id: 'password',
      type: 'fill',
      target: { by: 'label', label: 'Password', within: form },
      value: 'wrong-password',
    },
    submit,
    {
      id: 'message',
      type: 'expectText',
      target: { by: 'testId', testId: 'login-message' },
      text: 'Invalid email or password',
      match: 'exact',
      sourceRefs: ['AC-LOGIN@v1'],
    },
    { id: 'stays-on-login', type: 'expectUrl', path: '/login' },
  ],
  teardown: [...reset],
} satisfies ExecutableSpecInput;

/** AC-LOGIN-04 as clarified: lock after 5 consecutive failures, for 15 minutes. */
export const lockoutSpec = {
  setup: [...reset].map((s) => ({ ...s, id: 'reset-before' })),
  steps: [
    ...[1, 2, 3, 4].map((n) => ({
      id: `api-fail-${n}`,
      type: 'apiRequest' as const,
      method: 'POST' as const,
      path: '/api/login',
      body: { email: 'qa@example.test', password: 'wrong' },
      expectStatus: 401,
    })),
    { id: 'open', type: 'navigate', path: '/login' },
    email('qa@example.test'),
    {
      id: 'password',
      type: 'fill',
      target: { by: 'label', label: 'Password', within: form },
      value: 'wrong',
    },
    submit,
    {
      id: 'locked',
      type: 'expectText',
      target: { by: 'testId', testId: 'login-message' },
      text: 'Account locked. Try again in 15 minutes.',
      match: 'exact',
      sourceRefs: ['CLAR-LOGIN-LOCKOUT@v1'],
    },
  ],
  teardown: [...reset],
} satisfies ExecutableSpecInput;

/** Destructive: requires a scoped approval before it may run. */
export const deleteAccountSpec = {
  steps: [
    ...loginValidSpec.steps.slice(0, 5),
    {
      id: 'delete',
      type: 'click',
      target: {
        by: 'role',
        role: 'button',
        name: 'Delete account',
        within: { by: 'testId', testId: 'danger-zone' },
      },
      destructive: true,
    },
    { id: 'deleted', type: 'expectText', target: { by: 'role', role: 'heading' }, text: 'Account deleted' },
  ],
  teardown: [...reset],
} satisfies ExecutableSpecInput;
