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
  /** A one-time code computed at send time from a base32 TOTP secret (RFC 6238, 30 s, 6 digits), ADR-0025. */
  z.object({ totp: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/) }),
]);

/** Request headers a step may set (ADR-0025): the ones security and locale cases need, nothing that forges identity. */
export const ALLOWED_HEADERS = [
  'origin',
  'referer',
  'accept',
  'accept-language',
  'idempotency-key',
  'x-requested-with',
  'user-agent',
] as const;
const HeaderName = z
  .string()
  .max(64)
  .refine(
    (h) => (ALLOWED_HEADERS as readonly string[]).includes(h.toLowerCase()),
    `must be one of ${ALLOWED_HEADERS.join(', ')}`,
  );
const Headers = z.record(HeaderName, InputValue);
/** A raw request body (not JSON, or deliberately malformed JSON) with its content type. */
const RawBody = z.object({ contentType: z.string().min(1).max(100), text: z.string().max(20_000) });
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

/** `data.items[0].id`: a dotted path with integer indexes into a JSON response (ADR-0024). */
export const JsonPath = z
  .string()
  .max(200)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])*)*$/);

/** Reads a JSON path; `undefined` when any segment is missing. */
export function readJsonPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const seg of path.match(/[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? []) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const key = seg.startsWith('[') ? Number(seg.slice(1, -1)) : seg;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/** One check on a JSON response: a value equal to an input, matching a pattern, or present at all. */
export const JsonCheck = z
  .object({
    path: JsonPath,
    equals: InputValue.optional(),
    matches: z
      .string()
      .min(1)
      .max(200)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'must be a valid regular expression')
      .optional(),
    exists: z.boolean().optional(),
  })
  .refine((c) => c.equals !== undefined || c.matches !== undefined || c.exists !== undefined, {
    message: 'a JSON check needs equals, matches or exists',
  });
export type JsonCheck = z.infer<typeof JsonCheck>;

/** A named API session (a signed-in role) that later API steps send their requests through. */
const SessionName = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);

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
    /** Instead of `body`: the bytes as given, with their content type (ADR-0025). */
    rawBody: RawBody.optional(),
    headers: Headers.optional(),
    expectStatus: z.number().int().min(100).max(599).optional(),
    /** Checks on the JSON response body (ADR-0024); each is an assertion. */
    expectJson: z.array(JsonCheck).max(50).optional(),
    /** Send through a session opened by an earlier `session` step; default: the browser's own. */
    session: SessionName.optional(),
    /** DELETE is always treated as destructive; other methods may opt in. */
    destructive: z.boolean().default(false),
  }),
  /**
   * Opens a named API session (ADR-0024): its own cookie jar, signed in by one request (the
   * product's own sign-in endpoint, credentials as secrets). An optional bearer token is read from
   * the response and sent on that session's later requests. A failed sign-in is a step error.
   */
  z.object({
    ...base,
    type: z.literal('session'),
    name: SessionName,
    method: HttpMethod,
    path: PathTemplate,
    body: z.record(z.string(), InputValue).optional(),
    headers: Headers.optional(),
    token: z
      .object({
        path: JsonPath,
        header: z.string().min(1).max(64).default('Authorization'),
        prefix: z.string().max(32).default('Bearer '),
      })
      .optional(),
  }),
  /**
   * Waits on a real signal with a bound (ADR-0024): a text to appear, or a request to answer with
   * a status and JSON values. Never a fixed sleep. Timing out BLOCKS the run (the signal never
   * came; nothing was proved either way), it never passes.
   */
  z.object({
    ...base,
    type: z.literal('waitFor'),
    timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
    intervalMs: z.number().int().min(250).max(10_000).default(1000),
    until: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), target: Locator, text: z.string().min(1).max(2000) }),
      z.object({
        kind: z.literal('request'),
        method: HttpMethod,
        path: PathTemplate,
        session: SessionName.optional(),
        expectStatus: z.number().int().min(100).max(599).optional(),
        expectJson: z.array(JsonCheck).max(20).optional(),
      }),
    ]),
  }),
  /**
   * A call to one of the product's own test hooks (ADR-0025): a disposable account, a throttle
   * reset, a job run. Only paths the environment's administrator listed as hooks may be called,
   * and never in production (policy). Not an assertion.
   */
  z.object({
    ...base,
    type: z.literal('testHook'),
    method: HttpMethod,
    path: PathTemplate,
    body: z.record(z.string(), InputValue).optional(),
  }),
  /** A keyboard key (`Enter`, `Escape`, `Control+a`), on a target or the focused element. */
  z.object({ ...base, type: z.literal('press'), key: z.string().min(1).max(40), target: Locator.optional() }),
  /** Sets a file on a file input; the file travels with the spec (1 MB), never from the executor's disk. */
  z.object({
    ...base,
    type: z.literal('upload'),
    target: Locator,
    file: z.object({
      name: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[A-Za-z0-9._-]+$/),
      contentType: z.string().min(1).max(100),
      dataBase64: z.string().max(1_400_000),
    }),
  }),
  /** Clicks `trigger` and expects a download, whose name may be checked; the file is kept as evidence. */
  z.object({
    ...base,
    type: z.literal('expectDownload'),
    trigger: Locator,
    nameMatches: z
      .string()
      .min(1)
      .max(200)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'must be a valid regular expression')
      .optional(),
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
      /** A value of an earlier API or session step's JSON response (ADR-0024). */
      z.object({ kind: z.literal('response'), step: z.string().min(1).max(64), path: JsonPath }),
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
    /**
     * Data rows (ADR-0024): the whole spec (setup, steps, teardown) runs once per row, with the
     * row's columns as run-scoped values (`{{url}}`, `{ var: 'role' }`). One run, one verdict per
     * row in the assertions; a permission matrix or a boundary table is one spec.
     */
    rows: z
      .array(z.record(VarName, z.string().max(2000)))
      .max(200)
      .default([]),
  })
  .superRefine((spec, ctx) => {
    const columns = spec.rows[0] ? Object.keys(spec.rows[0]).sort() : [];
    for (const [i, row] of spec.rows.entries()) {
      if (Object.keys(row).sort().join() !== columns.join())
        ctx.addIssue({ code: 'custom', message: `row ${i + 1} has different columns from row 1` });
      for (const c of Object.keys(row))
        if (c in spec.values)
          ctx.addIssue({ code: 'custom', message: `row column ${c} is also a declared value` });
    }
    // Every value a step uses is declared, a row column, or captured by an earlier step.
    const known = new Set([...Object.keys(spec.values), ...columns]);
    const sessions = new Set<string>();
    const responders = new Set<string>();
    for (const step of [...spec.setup, ...spec.steps, ...spec.teardown]) {
      if (step.type === 'session') sessions.add(step.name);
      if (step.type === 'apiRequest' && step.session && !sessions.has(step.session))
        ctx.addIssue({
          code: 'custom',
          message: `step ${step.id} uses session ${step.session} before it is opened`,
        });
      if (
        step.type === 'waitFor' &&
        step.until.kind === 'request' &&
        step.until.session &&
        !sessions.has(step.until.session)
      )
        ctx.addIssue({
          code: 'custom',
          message: `step ${step.id} uses session ${step.until.session} before it is opened`,
        });
      if (step.type === 'capture' && step.from.kind === 'response' && !responders.has(step.from.step))
        ctx.addIssue({
          code: 'custom',
          message: `step ${step.id} reads the response of ${step.from.step}, which is not an earlier API step`,
        });
      if (step.type === 'apiRequest' || step.type === 'session') responders.add(step.id);
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
    for (const step of [...spec.setup, ...spec.steps, ...spec.teardown]) {
      if (step.type === 'apiRequest' && step.body && step.rawBody)
        ctx.addIssue({ code: 'custom', message: `step ${step.id} has both body and rawBody` });
    }
    const ids = [...spec.setup, ...spec.steps, ...spec.teardown].map((s) => s.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length)
      ctx.addIssue({ code: 'custom', message: `duplicate step ids: ${[...new Set(dupes)].join(', ')}` });
    if (
      !spec.steps.some(
        (s) =>
          s.type.startsWith('expect') ||
          (s.type === 'apiRequest' && (s.expectStatus || s.expectJson?.length)),
      )
    ) {
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
  const visit = (v: InputValue) => {
    if (typeof v !== 'object') return;
    if ('secret' in v) names.add(v.secret);
    if ('totp' in v) names.add(v.totp);
  };
  for (const s of [...spec.setup, ...spec.steps, ...spec.teardown]) {
    if (s.type === 'fill') visit(s.value);
    if ((s.type === 'apiRequest' || s.type === 'session' || s.type === 'testHook') && s.body)
      Object.values(s.body).forEach(visit);
    if ((s.type === 'apiRequest' || s.type === 'session') && s.headers)
      Object.values(s.headers).forEach(visit);
    if (s.type === 'apiRequest') s.expectJson?.forEach((c) => c.equals !== undefined && visit(c.equals));
    if (s.type === 'waitFor' && s.until.kind === 'request')
      s.until.expectJson?.forEach((c) => c.equals !== undefined && visit(c.equals));
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
    case 'session':
    case 'testHook':
      text(step.path);
      if (step.body) Object.values(step.body).forEach(input);
      if (step.type !== 'testHook' && step.headers) Object.values(step.headers).forEach(input);
      if (step.type === 'apiRequest' && step.rawBody) text(step.rawBody.text);
      if (step.type === 'apiRequest')
        step.expectJson?.forEach((c) => c.equals !== undefined && input(c.equals));
      break;
    case 'waitFor':
      if (step.until.kind === 'text') text(step.until.text);
      else {
        text(step.until.path);
        step.until.expectJson?.forEach((c) => c.equals !== undefined && input(c.equals));
      }
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
      !s.expectJson?.length &&
      !steps.some((t) => t.type.startsWith('expect'))
    )
      flags.push(
        `step ${s.id}: only the status ${s.expectStatus} is checked; nothing reads what the request did`,
      );
  }
  const lastAssertion = steps
    .map(
      (s) =>
        s.type.startsWith('expect') ||
        (s.type === 'apiRequest' && (s.expectStatus !== undefined || !!s.expectJson?.length)),
    )
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
