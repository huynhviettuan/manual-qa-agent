import { z } from 'zod';
import { canonicalJson, sha256 } from './ids.ts';

// ADR-0008: approved test cases execute through a constrained, allowlisted step format.
// No arbitrary JavaScript, no absolute URLs (navigation is always relative to the
// administrator-configured environment base URL), and locators are semantic and scoped.

/** Relative path on the environment's base URL. Absolute URLs and schemes are rejected. */
const RelativePath = z
  .string()
  .min(1)
  .max(500)
  .refine((p) => p.startsWith('/') && !p.startsWith('//'), 'must be a path starting with "/"')
  .refine((p) => !/[\s\\]/.test(p), 'must not contain whitespace or backslashes');

const AriaRole = z.enum([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'heading',
  'alert',
  'status',
  'dialog',
  'tab',
  'menuitem',
  'row',
  'cell',
  'listitem',
  'region',
  'navigation',
  'form',
  // Landmark and custom-select roles (Radix/shadcn listboxes) needed to scope real apps' UIs.
  'main',
  'listbox',
  'option',
  'alertdialog',
]);

type LocatorShape =
  | { by: 'role'; role: z.infer<typeof AriaRole>; name?: string; exact?: boolean; within?: LocatorShape }
  | { by: 'testId'; testId: string; within?: LocatorShape }
  | { by: 'label'; label: string; exact?: boolean; within?: LocatorShape }
  | { by: 'text'; text: string; exact?: boolean; within?: LocatorShape };

/** Semantic locator, optionally scoped through its owning parent (`within`). */
export const Locator: z.ZodType<LocatorShape, LocatorShape> = z.lazy(() =>
  z.discriminatedUnion('by', [
    z.object({
      by: z.literal('role'),
      role: AriaRole,
      name: z.string().max(200).optional(),
      exact: z.boolean().optional(),
      within: Locator.optional(),
    }),
    z.object({ by: z.literal('testId'), testId: z.string().min(1).max(200), within: Locator.optional() }),
    z.object({
      by: z.literal('label'),
      label: z.string().min(1).max(200),
      exact: z.boolean().optional(),
      within: Locator.optional(),
    }),
    z.object({
      by: z.literal('text'),
      text: z.string().min(1).max(500),
      exact: z.boolean().optional(),
      within: Locator.optional(),
    }),
  ]),
);
export type Locator = LocatorShape;

/** A literal, or a reference resolved at run time and never stored in specs, prompts or evidence. */
export const InputValue = z.union([
  z.string().max(2000),
  z.object({ secret: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/) }),
]);
export type InputValue = z.infer<typeof InputValue>;

const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  /** Traceability back to the approved case's sources/AC (`sourceId@version` or `story:AC-ID`). */
  sourceRefs: z.array(z.string()).default([]),
};

const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const ExecutableStep = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('navigate'), path: RelativePath }),
  z.object({
    ...base,
    type: z.literal('click'),
    target: Locator,
    /** Irreversible/side-effecting click (delete, pay, invite): requires a scoped approval. */
    destructive: z.boolean().default(false),
  }),
  z.object({ ...base, type: z.literal('fill'), target: Locator, value: InputValue }),
  z.object({ ...base, type: z.literal('select'), target: Locator, option: z.string().max(200) }),
  z.object({
    ...base,
    type: z.literal('expectText'),
    target: Locator,
    text: z.string().max(2000),
    match: z.enum(['exact', 'contains']).default('contains'),
  }),
  z.object({ ...base, type: z.literal('expectVisible'), target: Locator }),
  z.object({ ...base, type: z.literal('expectHidden'), target: Locator }),
  z.object({
    ...base,
    type: z.literal('expectUrl'),
    path: RelativePath,
    match: z.enum(['exact', 'prefix']).default('exact'),
  }),
  z.object({
    ...base,
    type: z.literal('apiRequest'),
    method: HttpMethod,
    path: RelativePath,
    body: z.record(z.string(), InputValue).optional(),
    expectStatus: z.number().int().min(100).max(599).optional(),
    /** DELETE is always treated as destructive; other methods may opt in. */
    destructive: z.boolean().default(false),
  }),
]);
export type ExecutableStep = z.infer<typeof ExecutableStep>;
export type ExecutableStepInput = z.input<typeof ExecutableStep>;

export const ExecutableSpec = z
  .object({
    /** Prepares test data; failures make the run INCONCLUSIVE (behaviour was never observed). */
    setup: z.array(ExecutableStep).max(50).default([]),
    steps: z.array(ExecutableStep).min(1).max(200),
    /** Always runs (even after failures) to clean up test data the spec created. */
    teardown: z.array(ExecutableStep).max(50).default([]),
  })
  .superRefine((spec, ctx) => {
    const ids = [...spec.setup, ...spec.steps, ...spec.teardown].map((s) => s.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length)
      ctx.addIssue({ code: 'custom', message: `duplicate step ids: ${[...new Set(dupes)].join(', ')}` });
    if (!spec.steps.some((s) => s.type.startsWith('expect') || (s.type === 'apiRequest' && s.expectStatus))) {
      ctx.addIssue({ code: 'custom', message: 'steps must contain at least one assertion' });
    }
  });
export type ExecutableSpec = z.infer<typeof ExecutableSpec>;
export type ExecutableSpecInput = z.input<typeof ExecutableSpec>;

export function isDestructive(step: ExecutableStep): boolean {
  if (step.type === 'apiRequest') return step.destructive || step.method === 'DELETE';
  return step.type === 'click' && step.destructive;
}

/** Destructive steps anywhere in the spec (setup and teardown included). */
export function destructiveSteps(spec: ExecutableSpec): string[] {
  return [...spec.setup, ...spec.steps, ...spec.teardown].filter(isDestructive).map((s) => s.id);
}

/** Secret names a spec references (resolved only by the executor at run time). */
export function referencedSecrets(spec: ExecutableSpec): string[] {
  const names = new Set<string>();
  const visit = (v: InputValue) => typeof v === 'object' && names.add(v.secret);
  for (const s of [...spec.setup, ...spec.steps, ...spec.teardown]) {
    if (s.type === 'fill') visit(s.value);
    if (s.type === 'apiRequest' && s.body) Object.values(s.body).forEach(visit);
  }
  return [...names];
}

/** Stable hash binding approvals and runs to the exact spec content. */
export function specHash(spec: ExecutableSpec): string {
  return sha256(canonicalJson(spec));
}

/** Human-readable locator, used in step logs and evidence. */
export function describeLocator(l: Locator): string {
  const self =
    l.by === 'role'
      ? `role=${l.role}${l.name ? `[name="${l.name}"]` : ''}`
      : l.by === 'testId'
        ? `testId=${l.testId}`
        : l.by === 'label'
          ? `label="${l.label}"`
          : `text="${l.text}"`;
  return l.within ? `${describeLocator(l.within)} >> ${self}` : self;
}
