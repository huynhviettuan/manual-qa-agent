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
  // Calendars, data grids and menus (ADR-0022): a booking slot is a gridcell, an action list a menu.
  'grid',
  'gridcell',
  'columnheader',
  'rowheader',
  'table',
  'menu',
  'menubar',
  'menuitemcheckbox',
  'menuitemradio',
  'tabpanel',
  'switch',
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

/** Name of a run-scoped value: declared in `spec.values` or captured by a `capture` step (ADR-0015). */
const VarName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/**
 * A literal, a secret reference resolved at run time and never stored in specs, prompts or
 * evidence, or a run-scoped value (`{ var }`) resolved from the run's value table.
 */
export const InputValue = z.union([
  z.string().max(2000),
  z.object({ secret: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/) }),
  z.object({ var: VarName }),
]);
export type InputValue = z.infer<typeof InputValue>;

export const DATE_FORMATS = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'd/M/yyyy'] as const;

/**
 * A value derived once, when the run starts, so every step sees the same one. Dates are relative
 * to the run's start in the given time zone (default UTC); the executor never reads the clock twice.
 */
export const DerivedValue = z.object({
  date: z.object({
    offsetDays: z.number().int().min(-3660).max(3660),
    format: z.enum(DATE_FORMATS),
    timeZone: z.string().min(1).max(64).optional(),
  }),
});
export type DerivedValue = z.infer<typeof DerivedValue>;

/** `{{name}}` placeholders in paths and expected text, filled from the run's value table. */
const TEMPLATE_TOKEN = /\{\{([a-z][a-z0-9_]{0,63})\}\}/g;
export function templateVars(text: string): string[] {
  return [...text.matchAll(TEMPLATE_TOKEN)].map((m) => m[1]!);
}
/** Fills a template; throws naming the first value that is not in the table. */
export function renderTemplate(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(TEMPLATE_TOKEN, (_, name: string) => {
    const v = values.get(name);
    if (v === undefined) throw new Error(`undefined value {{${name}}}`);
    return v;
  });
}
/** A relative path that may carry `{{name}}` placeholders; validated as if each were filled. */
const PathTemplate = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) => RelativePath.safeParse(p.replace(TEMPLATE_TOKEN, 'x')).success,
    'must be a path starting with "/" (placeholders allowed), without whitespace or backslashes',
  );

/** A regular expression with exactly one capturing group, used to pick a value out of text or a URL. */
const CapturePattern = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => {
    try {
      return new RegExp(`${p}|`).exec('')!.length === 2;
    } catch {
      return false;
    }
  }, 'must be a valid regular expression with exactly one capturing group');

const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  /** Traceability back to the approved case's sources/AC (`sourceId@version` or `story:AC-ID`). */
  sourceRefs: z.array(z.string()).default([]),
};

const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const ExecutableStep = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('navigate'), path: PathTemplate }),
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
    path: PathTemplate,
    match: z.enum(['exact', 'prefix']).default('exact'),
  }),
  z.object({
    ...base,
    type: z.literal('apiRequest'),
    method: HttpMethod,
    path: PathTemplate,
    body: z.record(z.string(), InputValue).optional(),
    expectStatus: z.number().int().min(100).max(599).optional(),
    /** DELETE is always treated as destructive; other methods may opt in. */
    destructive: z.boolean().default(false),
  }),
  /**
   * Reads a value from the page (the text of a strict locator, or the current URL) into the run's
   * value table, for later steps: a new record's id in the URL, a generated code in a cell. Not an
   * assertion: a pattern that does not match is a step error (INCONCLUSIVE), never a failure.
   */
  z.object({
    ...base,
    type: z.literal('capture'),
    as: VarName,
    from: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), target: Locator }),
      z.object({ kind: z.literal('url') }),
    ]),
    pattern: CapturePattern.optional(),
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
    /** Values derived once at run start (today + n days, formatted), referenced as `{ var }` or `{{name}}`. */
    values: z.record(VarName, DerivedValue).default({}),
    /**
     * Runs alone on its environment (ADR-0021): a case that changes global settings or needs a
     * machine-wide throttle to itself. The worker never runs it beside another run of the same
     * environment, nor any other run beside it.
     */
    exclusive: z.boolean().default(false),
  })
  .superRefine((spec, ctx) => {
    // Every value a step uses is declared, or captured by an earlier step of the same or an earlier phase.
    const known = new Set(Object.keys(spec.values));
    for (const step of [...spec.setup, ...spec.steps, ...spec.teardown]) {
      for (const name of stepVars(step)) {
        if (!known.has(name))
          ctx.addIssue({ code: 'custom', message: `step ${step.id} uses undefined value {{${name}}}` });
      }
      if (step.type === 'capture') {
        if (step.as in spec.values)
          ctx.addIssue({
            code: 'custom',
            message: `step ${step.id} captures ${step.as}, which is a declared value`,
          });
        known.add(step.as);
      }
    }
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
  const visit = (v: InputValue) => typeof v === 'object' && 'secret' in v && names.add(v.secret);
  for (const s of [...spec.setup, ...spec.steps, ...spec.teardown]) {
    if (s.type === 'fill') visit(s.value);
    if (s.type === 'apiRequest' && s.body) Object.values(s.body).forEach(visit);
  }
  return [...names];
}

/** Run-scoped value names one step reads (`{ var }` inputs and `{{name}}` placeholders). */
export function stepVars(step: ExecutableStep): string[] {
  const names = new Set<string>();
  const input = (v: InputValue) => typeof v === 'object' && 'var' in v && names.add(v.var);
  const text = (t: string) => templateVars(t).forEach((n) => names.add(n));
  switch (step.type) {
    case 'navigate':
    case 'expectUrl':
      text(step.path);
      break;
    case 'fill':
      input(step.value);
      break;
    case 'expectText':
      text(step.text);
      break;
    case 'apiRequest':
      text(step.path);
      if (step.body) Object.values(step.body).forEach(input);
      break;
  }
  return [...names];
}

/**
 * Formats an instant as a calendar date in a time zone, after adding whole days in that zone.
 * Pure, so the executor and the tests agree on every value.
 */
export function deriveValue(def: DerivedValue, now: Date): string {
  const { offsetDays, format, timeZone = 'UTC' } = def.date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // Shift in calendar days of the zone's local date, so a DST change never moves the day.
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offsetDays));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (format) {
    case 'yyyy-MM-dd':
      return `${y}-${pad(m)}-${pad(d)}`;
    case 'dd/MM/yyyy':
      return `${pad(d)}/${pad(m)}/${y}`;
    case 'MM/dd/yyyy':
      return `${pad(m)}/${pad(d)}/${y}`;
    case 'd/M/yyyy':
      return `${d}/${m}/${y}`;
  }
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

/**
 * ADR-0023: assertions that pass without claiming much, for the executable's reviewer. A short
 * `contains` text, an API step that checks only its status, or an action after the last assertion
 * (what it did is never checked). Flags, never rejections: the reviewer decides.
 */
export function weakAssertions(spec: ExecutableSpec): string[] {
  const flags: string[] = [];
  const steps = spec.steps;
  for (const s of steps) {
    if (s.type === 'expectText' && s.match === 'contains' && s.text.trim().length < 8)
      flags.push(`step ${s.id}: "contains" on the short text "${s.text}" passes on almost any page`);
    if (
      s.type === 'apiRequest' &&
      s.expectStatus !== undefined &&
      !steps.some((t) => t.type.startsWith('expect'))
    )
      flags.push(
        `step ${s.id}: only the status ${s.expectStatus} is checked; nothing reads what the request did`,
      );
  }
  const lastAssertion = steps
    .map((s) => s.type.startsWith('expect') || (s.type === 'apiRequest' && s.expectStatus !== undefined))
    .lastIndexOf(true);
  const trailing = steps
    .slice(lastAssertion + 1)
    .filter((s) => ['click', 'fill', 'navigate', 'apiRequest'].includes(s.type));
  if (trailing.length)
    flags.push(
      `steps ${trailing.map((s) => s.id).join(', ')} act after the last assertion; their effect is never checked`,
    );
  return flags;
}
