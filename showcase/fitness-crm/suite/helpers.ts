// Shared vocabulary for the Gym CRM suite: case and design types, locators and step builders.
// Every locator is scoped through its owning parent (main, a dialog, a form section, a listbox).

export type Technique =
  | 'Equivalence partitioning'
  | 'Boundary value analysis'
  | 'Decision table'
  | 'State transition'
  | 'Use case'
  | 'Permission matrix'
  | 'Error guessing';

export const TECHNIQUES: Technique[] = [
  'Equivalence partitioning',
  'Boundary value analysis',
  'Decision table',
  'State transition',
  'Use case',
  'Permission matrix',
  'Error guessing',
];

type Step = Record<string, unknown>;
type Locator = Record<string, unknown>;

export type SuiteCase = {
  id: string;
  section: string;
  priority: 'P1' | 'P2' | 'P3';
  technique: Technique;
  title: string;
  /** Requirement verified: id as in the Gym CRM docs, and the statement given to the agent. */
  requirement: { id: string; statement: string };
  preconditions: string[];
  steps: Array<{ action: string; expected: string }>;
  spec?: { steps: Step[]; values?: Record<string, unknown> };
  manualReason?: string;
  /** Narrower wording a QA engineer submits if the agent asks for the story to be narrowed. */
  narrowedStatement?: string;
};

/** A test-design artifact (partition table, boundary table, decision table, state model). */
export type Design = { technique: Technique; title: string; columns: string[]; rows: string[][] };
export type Module = { id: string; name: string; designs: Design[]; cases: SuiteCase[] };

/** Why a case stays manual; each is a missing executor capability or a deliberate safety choice. */
export const WHY = {
  date: "Expected values depend on today's date; needs date-relative inputs and assertions in the executor.",
  chain:
    'Needs a record created earlier in the same test, with its new id carried to later steps; the executor cannot do that yet.',
  twoUsers: 'Needs two people acting in sequence (submit, then approve as someone else) inside one test.',
  setup: 'Needs data the demo seed does not have; prepared by hand or by an API fixture first.',
  time: 'Depends on time passing (timers, reminders, expiry); needs a controllable clock.',
  external: 'Involves email, push notifications or devices outside the browser.',
  calc: 'Needs arithmetic across several displayed values; the executor compares text and does not compute.',
  mutate:
    'Changes shared business data (money, merges, deletions); kept manual until a scoped approval and cleanup exist for it.',
  judge: 'Needs human judgement (layout, phone usability, wording).',
  concurrency: 'Needs two simultaneous requests; the executor runs one browser session at a time.',
} as const;

export const main: Locator = { by: 'role', role: 'main' };
export const FORBIDDEN = 'Bạn không có quyền xem trang này';

export const ROLE = {
  admin: 'admin@fitness-crm.test',
  manager: 'demo-manager@fitness-crm.test',
  receptionist: 'demo-receptionist@fitness-crm.test',
  trainer: 'demo-trainer@fitness-crm.test',
  consulting: 'demo-consulting@fitness-crm.test',
  accountant: 'demo-accountant@fitness-crm.test',
} as const;
export type RoleKey = keyof typeof ROLE;
export const ROLE_NAME: Record<RoleKey, string> = {
  admin: 'Admin',
  manager: 'Fitness Manager',
  receptionist: 'Receptionist',
  trainer: 'PT',
  consulting: 'Consulting',
  accountant: 'Kế toán (custom role)',
};

/** Signs in through the real login page; the password is a secret reference, never a literal. */
export const signIn = (who: RoleKey): Step[] => [
  { id: 'open-login', type: 'navigate', path: '/login' },
  { id: 'email', type: 'fill', target: { by: 'label', label: 'Email', within: main }, value: ROLE[who] },
  {
    id: 'password',
    type: 'fill',
    target: { by: 'label', label: 'Password', within: main },
    value: { secret: 'GYM_PASSWORD' },
  },
  { id: 'sign-in', type: 'click', target: { by: 'role', role: 'button', name: 'Sign in', within: main } },
  { id: 'signed-in', type: 'expectUrl', path: '/dashboard' },
];

/** The menu has rendered (every role has Tasks) before asserting that an entry is absent. */
export const menuReady: Step = {
  id: 'menu-ready',
  type: 'expectVisible',
  target: { by: 'role', role: 'link', name: 'Công việc', exact: true },
};

export const forbiddenAt = (path: string): Step[] => [
  { id: 'open-page', type: 'navigate', path },
  { id: 'refused', type: 'expectText', target: main, text: FORBIDDEN },
];
export const headingAt = (path: string, heading: string): Step[] => [
  { id: 'open-page', type: 'navigate', path },
  {
    id: 'page-heading',
    type: 'expectVisible',
    target: { by: 'role', role: 'heading', name: heading, exact: true, within: main },
  },
];

// --- Leads
export const leadDialog: Locator = { by: 'role', role: 'dialog', name: 'Thêm lead' };
export const duplicateDialog: Locator = {
  by: 'role',
  role: 'alertdialog',
  name: 'Số điện thoại đã có hồ sơ',
};
export const leadForm = (o: { name?: string; phone?: string; channel?: string }): Step[] => [
  { id: 'open-leads', type: 'navigate', path: '/leads' },
  { id: 'add-lead', type: 'click', target: { by: 'role', role: 'button', name: 'Thêm lead', within: main } },
  ...(o.name !== undefined
    ? [
        {
          id: 'name',
          type: 'fill',
          target: { by: 'label', label: 'Họ và tên', within: leadDialog },
          value: o.name,
        },
      ]
    : []),
  ...(o.phone !== undefined
    ? [
        {
          id: 'phone',
          type: 'fill',
          target: { by: 'label', label: 'Số điện thoại', within: leadDialog },
          value: o.phone,
        },
      ]
    : []),
  ...(o.channel
    ? [
        {
          id: 'open-channel',
          type: 'click',
          target: { by: 'label', label: 'Kênh liên hệ', within: leadDialog },
        },
        {
          id: 'channel',
          type: 'click',
          target: {
            by: 'role',
            role: 'option',
            name: o.channel,
            exact: true,
            within: { by: 'role', role: 'listbox' },
          },
        },
      ]
    : []),
];
export const saveLead: Step = {
  id: 'save',
  type: 'click',
  target: { by: 'role', role: 'button', name: 'Lưu', exact: true, within: leadDialog },
};
export const inDialog = (id: string, text: string): Step => ({
  id,
  type: 'expectText',
  target: leadDialog,
  text,
});
export const notInDialog = (id: string, text: string): Step => ({
  id,
  type: 'expectHidden',
  target: { by: 'text', text, within: leadDialog },
});

// --- Customers and contracts
export const customerRow = (name: string): Locator => ({ by: 'role', role: 'row', name, within: main });
export const openContract = (code: string): Step[] => [
  { id: 'open-contracts', type: 'navigate', path: '/contracts' },
  {
    id: 'open-contract',
    type: 'click',
    target: { by: 'role', role: 'link', name: code, exact: true, within: main },
  },
  { id: 'on-contract', type: 'expectUrl', path: '/contracts/', match: 'prefix' },
];
export const openCustomer = (name: string): Step[] => [
  { id: 'open-customers', type: 'navigate', path: '/customers' },
  {
    id: 'open-customer',
    type: 'click',
    target: { by: 'role', role: 'link', name, exact: true, within: main },
  },
  { id: 'on-customer', type: 'expectUrl', path: '/customers/', match: 'prefix' },
];
export const serviceSection: Locator = {
  by: 'role',
  role: 'region',
  name: 'Dịch vụ và thời hạn',
  within: main,
};
export const priceSection: Locator = { by: 'role', role: 'region', name: 'Giá hợp đồng', within: main };
/** Opens the new-contract form for a customer without contracts and picks service PT; nothing is saved. */
export const newContractForm = (sessions: string): Step[] => [
  ...openCustomer('Phan Thị Kim Ngân'),
  {
    id: 'contracts-tab',
    type: 'click',
    target: { by: 'role', role: 'tab', name: 'Hợp đồng', exact: true, within: main },
  },
  {
    id: 'add-contract',
    type: 'click',
    target: { by: 'role', role: 'link', name: 'Thêm hợp đồng', exact: true, within: main },
  },
  { id: 'on-form', type: 'expectUrl', path: '/customers/', match: 'prefix' },
  {
    id: 'open-service',
    type: 'click',
    target: { by: 'role', role: 'combobox', name: 'Dịch vụ', exact: true, within: serviceSection },
  },
  {
    id: 'service',
    type: 'click',
    target: { by: 'role', role: 'option', name: 'PT', exact: true, within: { by: 'role', role: 'listbox' } },
  },
  {
    id: 'sessions',
    type: 'fill',
    target: { by: 'label', label: 'Số buổi', exact: true, within: serviceSection },
    value: sessions,
  },
  {
    id: 'leave-field',
    type: 'click',
    target: { by: 'role', role: 'heading', name: 'Giá hợp đồng', exact: true, within: main },
  },
];
export const submitContract: Step = {
  id: 'submit',
  type: 'click',
  target: { by: 'role', role: 'button', name: 'Tạo hợp đồng', exact: true, within: main },
};

/** Compact builders keep 240 cases readable. */
export function manual(
  base: Omit<SuiteCase, 'spec' | 'manualReason' | 'steps' | 'preconditions'> & {
    pre?: string[];
    steps: Array<[string, string]>;
    why: string;
  },
): SuiteCase {
  const { pre, steps, why, ...rest } = base;
  return {
    ...rest,
    preconditions: pre ?? [],
    steps: steps.map(([action, expected]) => ({ action, expected })),
    manualReason: why,
  };
}
export function auto(
  base: Omit<SuiteCase, 'spec' | 'manualReason' | 'steps' | 'preconditions'> & {
    pre?: string[];
    steps: Array<[string, string]>;
    spec: Step[];
    /** Values derived once per run (today ± n days), referenced as `{ var }` or `{{name}}` (ADR-0015). */
    values?: Record<string, unknown>;
  },
): SuiteCase {
  const { pre, steps, spec, values, ...rest } = base;
  return {
    ...rest,
    preconditions: pre ?? [],
    steps: steps.map(([action, expected]) => ({ action, expected })),
    spec: values ? { steps: spec, values } : { steps: spec },
  };
}

/** A calendar date relative to the run day, as Gym CRM shows and accepts dates. */
export const gymDate = (offsetDays: number) => ({
  date: { offsetDays, format: 'dd/MM/yyyy', timeZone: 'Asia/Ho_Chi_Minh' },
});
