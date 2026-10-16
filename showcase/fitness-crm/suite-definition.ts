// The Gym CRM regression suite: 30 cases, each traced to a requirement in the Gym CRM docs.
// Human-readable steps are what a tester follows; `spec` (when present) is the executable version,
// written against the real UI and approved by a second person before it runs (ADR-0008).
// Cases without a spec stay manual, with the reason recorded.

type Locator = Record<string, unknown>;
type Step = Record<string, unknown>;

export type SuiteCase = {
  id: string;
  section: string;
  priority: 'P1' | 'P2' | 'P3';
  title: string;
  /** Requirement the case verifies: id (as in the Gym CRM docs) and the statement given to the agent. */
  requirement: { id: string; statement: string };
  /** Narrower wording a QA engineer submits if the agent asks for the story to be narrowed. */
  narrowedStatement?: string;
  preconditions: string[];
  steps: Array<{ action: string; expected: string }>;
  spec?: { steps: Step[] };
  manualReason?: string;
};

const main: Locator = { by: 'role', role: 'main' };
const FORBIDDEN = 'Bạn không có quyền xem trang này';
const ROLE = {
  manager: 'demo-manager@fitness-crm.test',
  receptionist: 'demo-receptionist@fitness-crm.test',
  trainer: 'demo-trainer@fitness-crm.test',
} as const;

/** Signs in through the real login page; the password is a secret reference, never a literal. */
const signIn = (who: keyof typeof ROLE): Step[] => [
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

const leadDialog: Locator = { by: 'role', role: 'dialog', name: 'Thêm lead' };
/** Opens the add-lead dialog and fills it, without saving. */
const leadForm = (name: string | null, channel: string | null, phone?: string): Step[] => [
  { id: 'open-leads', type: 'navigate', path: '/leads' },
  { id: 'add-lead', type: 'click', target: { by: 'role', role: 'button', name: 'Thêm lead', within: main } },
  ...(name
    ? [
        {
          id: 'name',
          type: 'fill',
          target: { by: 'label', label: 'Họ và tên', within: leadDialog },
          value: name,
        },
      ]
    : []),
  ...(phone
    ? [
        {
          id: 'phone',
          type: 'fill',
          target: { by: 'label', label: 'Số điện thoại', within: leadDialog },
          value: phone,
        },
      ]
    : []),
  ...(channel
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
            name: channel,
            exact: true,
            within: { by: 'role', role: 'listbox' },
          },
        },
      ]
    : []),
];
/** Shown over the lead dialog when the phone number belongs to an existing record (BR-202). */
const duplicateDialog: Locator = { by: 'role', role: 'alertdialog', name: 'Số điện thoại đã có hồ sơ' };
const saveLead: Step = {
  id: 'save',
  type: 'click',
  target: { by: 'role', role: 'button', name: 'Lưu', exact: true, within: leadDialog },
};

/** Opens a demo contract from the list by its code (contract URLs are random ids). */
const openContract = (code: string): Step[] => [
  { id: 'open-contracts', type: 'navigate', path: '/contracts' },
  {
    id: 'open-contract',
    type: 'click',
    target: { by: 'role', role: 'link', name: code, exact: true, within: main },
  },
  { id: 'on-contract', type: 'expectUrl', path: '/contracts/', match: 'prefix' },
];

const forbiddenAt = (path: string, refs: string[]): Step[] => [
  { id: 'open-directly', type: 'navigate', path },
  { id: 'refused', type: 'expectText', target: main, text: FORBIDDEN, sourceRefs: refs },
];

export const SUITE_NAME = 'Gym CRM regression';

export const CASES: SuiteCase[] = [
  // --- Sign-in and access
  {
    id: 'TC-01',
    section: 'Sign-in and access',
    priority: 'P1',
    title: 'A manager signs in with email and password and reaches the dashboard',
    requirement: {
      id: 'BR-107',
      statement:
        'A user with valid credentials signs in with email and password and lands on the dashboard "Tổng quan".',
    },
    preconditions: ['Demo manager account exists'],
    steps: [
      { action: 'Open /login and sign in as demo-manager@fitness-crm.test', expected: 'The dashboard opens' },
      { action: 'Look at the page heading', expected: 'It reads "Tổng quan"' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        {
          id: 'dashboard-heading',
          type: 'expectVisible',
          target: { by: 'role', role: 'heading', name: 'Tổng quan', exact: true, within: main },
        },
      ],
    },
  },
  {
    id: 'TC-02',
    section: 'Sign-in and access',
    priority: 'P1',
    title: 'A wrong password shows one generic message and stays on the login page',
    requirement: {
      id: 'BR-107',
      statement:
        'A wrong password is refused with the message "The email or password is wrong, or the account is disabled." and the user stays on /login.',
    },
    preconditions: ['Demo manager account exists'],
    steps: [
      {
        action: 'Sign in as the manager with a wrong password',
        expected: 'The message "The email or password is wrong, or the account is disabled." appears',
      },
      { action: 'Check the address', expected: 'Still /login' },
    ],
    spec: {
      steps: [
        { id: 'open-login', type: 'navigate', path: '/login' },
        {
          id: 'email',
          type: 'fill',
          target: { by: 'label', label: 'Email', within: main },
          value: ROLE.manager,
        },
        {
          id: 'password',
          type: 'fill',
          target: { by: 'label', label: 'Password', within: main },
          value: 'not-the-right-password-1',
        },
        {
          id: 'sign-in',
          type: 'click',
          target: { by: 'role', role: 'button', name: 'Sign in', within: main },
        },
        {
          id: 'generic-error',
          type: 'expectText',
          target: main,
          text: 'The email or password is wrong, or the account is disabled.',
        },
        { id: 'stays-on-login', type: 'expectUrl', path: '/login' },
      ],
    },
  },
  {
    id: 'TC-03',
    section: 'Sign-in and access',
    priority: 'P1',
    title: 'A signed-out visitor who opens the dashboard is sent to the login page',
    requirement: {
      id: 'AC-01',
      statement: 'A visitor who is not signed in and opens /dashboard by direct URL is sent to /login.',
    },
    preconditions: ['Not signed in'],
    steps: [{ action: 'Open /dashboard without signing in', expected: 'The login page opens (/login)' }],
    spec: {
      steps: [
        { id: 'open-dashboard', type: 'navigate', path: '/dashboard' },
        { id: 'sent-to-login', type: 'expectUrl', path: '/login' },
      ],
    },
  },
  {
    id: 'TC-04',
    section: 'Sign-in and access',
    priority: 'P1',
    title: 'A trainer has no Finance menu and cannot open /finance directly',
    requirement: {
      id: 'AC-01',
      statement:
        'An account without permission for a module does not see its menu and cannot reach it by direct URL.',
    },
    preconditions: ['Demo trainer account (PT role, no finance permission)'],
    steps: [
      { action: 'Sign in as demo-trainer@fitness-crm.test', expected: 'The menu has no "Tài chính" entry' },
      { action: 'Open /finance directly', expected: '"Bạn không có quyền xem trang này" is shown' },
    ],
    spec: {
      steps: [
        ...signIn('trainer'),
        {
          id: 'no-finance-menu',
          type: 'expectHidden',
          target: { by: 'role', role: 'link', name: 'Tài chính', exact: true },
        },
        ...forbiddenAt('/finance', []),
      ],
    },
  },
  {
    id: 'TC-05',
    section: 'Sign-in and access',
    priority: 'P2',
    title: 'A trainer cannot open the leads list',
    requirement: {
      id: 'AC-01',
      statement:
        'A trainer (PT role, no lead permissions) who opens /leads by direct URL sees "Bạn không có quyền xem trang này".',
    },
    preconditions: ['Demo trainer account'],
    steps: [
      {
        action: 'Sign in as the trainer and open /leads',
        expected: '"Bạn không có quyền xem trang này" is shown',
      },
    ],
    spec: { steps: [...signIn('trainer'), ...forbiddenAt('/leads', [])] },
  },
  {
    id: 'TC-06',
    section: 'Sign-in and access',
    priority: 'P2',
    title: 'A receptionist cannot open income and expenses',
    requirement: {
      id: 'AC-01',
      statement:
        'A receptionist, who has payments and debt but not income and expenses, sees "Bạn không có quyền xem trang này" at /finance/cash.',
    },
    preconditions: ['Demo receptionist account'],
    steps: [
      {
        action: 'Sign in as the receptionist and open /finance/cash',
        expected: '"Bạn không có quyền xem trang này" is shown',
      },
    ],
    spec: { steps: [...signIn('receptionist'), ...forbiddenAt('/finance/cash', [])] },
  },
  {
    id: 'TC-07',
    section: 'Sign-in and access',
    priority: 'P2',
    title: 'A receptionist can open payments',
    requirement: {
      id: 'AC-01',
      statement:
        'A receptionist opens /finance/payments and sees "Thanh toán" but no "Thu / Chi" (income and expenses).',
    },
    preconditions: ['Demo receptionist account'],
    steps: [
      {
        action: 'Sign in as the receptionist and open /finance/payments',
        expected: 'Finance opens on "Thanh toán"; there is no "Thu / Chi" tab',
      },
    ],
    spec: {
      steps: [
        ...signIn('receptionist'),
        { id: 'open-payments', type: 'navigate', path: '/finance/payments' },
        {
          id: 'finance-heading',
          type: 'expectVisible',
          target: { by: 'role', role: 'heading', name: 'Tài chính', exact: true, within: main },
        },
        {
          id: 'payments-tab',
          type: 'expectVisible',
          target: { by: 'text', text: 'Thanh toán', exact: true, within: main },
        },
        {
          id: 'no-income-expenses',
          type: 'expectHidden',
          target: { by: 'text', text: 'Thu / Chi', exact: true, within: main },
        },
      ],
    },
  },
  {
    id: 'TC-08',
    section: 'Sign-in and access',
    priority: 'P2',
    title: 'Only management can open the trash',
    requirement: {
      id: 'AC-13',
      statement:
        'Deleted data in the trash is viewable only by management: a receptionist at /admin/trash sees "Bạn không có quyền xem trang này".',
    },
    narrowedStatement: 'Opening /admin/trash as a receptionist shows "Bạn không có quyền xem trang này".',
    preconditions: ['Demo receptionist account'],
    steps: [
      {
        action: 'Sign in as the receptionist and open /admin/trash',
        expected: '"Bạn không có quyền xem trang này" is shown',
      },
    ],
    spec: { steps: [...signIn('receptionist'), ...forbiddenAt('/admin/trash', [])] },
  },
  {
    id: 'TC-09',
    section: 'Sign-in and access',
    priority: 'P3',
    title: 'A manager sees the Finance menu (positive control for TC-04)',
    requirement: {
      id: 'AC-01',
      statement: 'An account with finance permission, the Fitness Manager, sees the menu entry "Tài chính".',
    },
    narrowedStatement: 'The Fitness Manager sees the menu entry "Tài chính".',
    preconditions: ['Demo manager account'],
    steps: [{ action: 'Sign in as the manager', expected: 'The menu has a "Tài chính" entry' }],
    spec: {
      steps: [
        ...signIn('manager'),
        {
          id: 'finance-menu',
          type: 'expectVisible',
          target: { by: 'role', role: 'link', name: 'Tài chính', exact: true },
        },
      ],
    },
  },

  // --- Leads
  {
    id: 'TC-10',
    section: 'Leads',
    priority: 'P1',
    title: 'A lead is saved with only a name and a channel',
    requirement: {
      id: 'AC-25',
      statement:
        'A lead needs only a name and a channel: saving with name "QA TC-10" and channel "Zalo" opens the new lead.',
    },
    preconditions: ['Signed in as a role that can create leads (manager)'],
    steps: [
      {
        action: 'Leads > "Thêm lead"; enter only the name and channel Zalo; save',
        expected: 'The new lead page opens with an LD code',
      },
      { action: 'Check the heading', expected: 'It shows the lead name' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...leadForm('QA TC-10', 'Zalo'),
        saveLead,
        { id: 'on-lead-page', type: 'expectUrl', path: '/leads/', match: 'prefix' },
        {
          id: 'lead-heading',
          type: 'expectVisible',
          target: { by: 'role', role: 'heading', name: 'QA TC-10', exact: true, within: main },
        },
      ],
    },
  },
  {
    id: 'TC-11',
    section: 'Leads',
    priority: 'P1',
    title: 'Choosing "Khác" without a note cannot be saved',
    requirement: {
      id: 'AC-04',
      statement: 'Choosing "Khác" in any drop-down cannot be saved without a note.',
    },
    preconditions: ['Signed in as the manager'],
    steps: [
      {
        action: 'Add a lead with channel "Khác" and leave "Ghi rõ" empty; save',
        expected: '"Đã chọn "Khác" thì phải ghi rõ." is shown',
      },
      { action: 'Look at the dialog', expected: 'It stays open; nothing is saved' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...leadForm('QA TC-11', 'Khác'),
        saveLead,
        {
          id: 'note-required',
          type: 'expectText',
          target: leadDialog,
          text: 'Đã chọn "Khác" thì phải ghi rõ',
        },
        { id: 'still-open', type: 'expectVisible', target: leadDialog },
      ],
    },
  },
  {
    id: 'TC-12',
    section: 'Leads',
    priority: 'P2',
    title: 'Choosing "Khác" with a note is saved',
    requirement: { id: 'AC-04', statement: 'Choosing "Khác" with a note in "Ghi rõ" saves the lead.' },
    preconditions: ['Signed in as the manager'],
    steps: [
      { action: 'Add a lead with channel "Khác" and a note; save', expected: 'The new lead page opens' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...leadForm('QA TC-12', 'Khác'),
        {
          id: 'note',
          type: 'fill',
          target: { by: 'label', label: 'Ghi rõ', within: leadDialog },
          value: 'Fanpage cũ',
        },
        saveLead,
        { id: 'on-lead-page', type: 'expectUrl', path: '/leads/', match: 'prefix' },
        {
          id: 'lead-heading',
          type: 'expectVisible',
          target: { by: 'role', role: 'heading', name: 'QA TC-12', exact: true, within: main },
        },
      ],
    },
  },
  {
    id: 'TC-13',
    section: 'Leads',
    priority: 'P2',
    title: 'A lead without a name is refused',
    requirement: {
      id: 'AC-25',
      statement:
        'A lead needs a name: saving with a channel but no name shows "Bắt buộc nhập." and saves nothing.',
    },
    preconditions: ['Signed in as the manager'],
    steps: [
      {
        action: 'Add a lead with channel Zalo and no name; save',
        expected: '"Bắt buộc nhập." is shown and the dialog stays open',
      },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...leadForm(null, 'Zalo'),
        saveLead,
        { id: 'name-required', type: 'expectText', target: leadDialog, text: 'Bắt buộc nhập' },
        { id: 'still-open', type: 'expectVisible', target: leadDialog },
      ],
    },
  },
  {
    id: 'TC-14',
    section: 'Leads',
    priority: 'P1',
    title: 'A phone number already in use warns and offers a merge instead of a second record',
    requirement: {
      id: 'BR-202',
      statement:
        'A new lead with a phone number already in use triggers the duplicate warning "Số điện thoại đã có hồ sơ" naming the existing record and offers "Gộp vào hồ sơ này"; no second record is created.',
    },
    preconditions: ['Customer Nguyễn Văn An has phone 0909123456 (demo data)'],
    steps: [
      {
        action: 'Add a lead named "QA TC-14" with phone 0909123456 and channel Zalo; save',
        expected: 'A "Số điện thoại đã có hồ sơ" dialog names KH000001 · Nguyễn Văn An',
      },
      {
        action: 'Look at the dialog',
        expected: 'It offers "Gộp vào hồ sơ này" and "Quay lại sửa"; no new lead is created',
      },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...leadForm('QA TC-14', 'Zalo', '0909123456'),
        saveLead,
        {
          id: 'duplicate-warning',
          type: 'expectText',
          target: duplicateDialog,
          text: 'KH000001 · Nguyễn Văn An',
        },
        {
          id: 'merge-offered',
          type: 'expectVisible',
          target: {
            by: 'role',
            role: 'button',
            name: 'Gộp vào hồ sơ này',
            exact: true,
            within: duplicateDialog,
          },
        },
      ],
    },
  },
  {
    id: 'TC-15',
    section: 'Leads',
    priority: 'P3',
    title: 'Searching leads by phone finds the matching lead only',
    requirement: {
      id: 'BR-202',
      statement:
        'Searching the lead list for phone 0901234508 lists lead "Tạ Thu Uyên" and not "Kiều Quốc Việt".',
    },
    preconditions: ['Demo leads Tạ Thu Uyên (0901234508) and Kiều Quốc Việt (0901234507)'],
    steps: [{ action: 'Leads: search for 0901234508', expected: 'Only Tạ Thu Uyên is listed' }],
    spec: {
      steps: [
        ...signIn('manager'),
        { id: 'search', type: 'navigate', path: '/leads?q=0901234508' },
        {
          id: 'match-listed',
          type: 'expectVisible',
          target: { by: 'role', role: 'link', name: 'Xem lead Tạ Thu Uyên', within: main },
        },
        {
          id: 'other-not-listed',
          type: 'expectHidden',
          target: { by: 'role', role: 'link', name: 'Xem lead Kiều Quốc Việt', within: main },
        },
      ],
    },
  },
  {
    id: 'TC-16',
    section: 'Leads',
    priority: 'P2',
    title: 'Marking a lead Refused requires a reason and puts it in the re-care queue',
    requirement: {
      id: 'BR-204',
      statement:
        'Setting a lead to "Từ chối" requires a reason; the lead enters the re-care queue with a contact-again date 15 days later.',
    },
    preconditions: ['A lead in status "Đang tư vấn"'],
    steps: [
      {
        action: 'Open the lead > "Đổi trạng thái" > "Từ chối" without a reason; save',
        expected: 'A reason is required',
      },
      {
        action: 'Choose a reason; save',
        expected: 'The lead is "Từ chối" and appears in Re-care with a date 15 days later',
      },
    ],
    manualReason:
      "The 15-day contact-again date depends on today's date and the status dialog needs a chosen reason from a configurable list; checked by a person until date-relative assertions exist.",
  },
  {
    id: 'TC-17',
    section: 'Leads',
    priority: 'P3',
    title: 'The Kanban board shows one column per lead status',
    requirement: {
      id: 'AC-03',
      statement: 'The lead Kanban board shows the status columns "Mới", "Đang tư vấn" and "Từ chối".',
    },
    preconditions: ['Signed in as the manager'],
    steps: [
      { action: 'Leads > Kanban', expected: 'Columns for Mới, Đang tư vấn, Từ chối and the other statuses' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        { id: 'open-board', type: 'navigate', path: '/leads?view=board' },
        {
          id: 'column-new',
          type: 'expectVisible',
          target: { by: 'role', role: 'region', name: 'Cột Mới', exact: true, within: main },
        },
        {
          id: 'column-consulting',
          type: 'expectVisible',
          target: { by: 'role', role: 'region', name: 'Cột Đang tư vấn', exact: true, within: main },
        },
        {
          id: 'column-refused',
          type: 'expectVisible',
          target: { by: 'role', role: 'region', name: 'Cột Từ chối', exact: true, within: main },
        },
      ],
    },
  },
  {
    id: 'TC-18',
    section: 'Leads',
    priority: 'P2',
    title: 'New leads are shared round-robin among active consultants',
    requirement: {
      id: 'BR-203',
      statement: 'Leads are assigned round-robin to active consultants of the branch.',
    },
    preconditions: ['At least two active consultants receiving leads'],
    steps: [
      { action: 'Add three leads in a row', expected: 'Each goes to the next consultant in turn order' },
    ],
    manualReason:
      'The expected consultant depends on the current turn order and weights, which earlier runs change; needs a reset hook or an API read of the turn state.',
  },

  // --- Customers and contracts
  {
    id: 'TC-19',
    section: 'Customers and contracts',
    priority: 'P1',
    title: 'An approved contract has no Edit action',
    requirement: {
      id: 'BR-305',
      statement:
        'An approved contract "Đang hiệu lực" is never edited, even by admin: its page has no "Sửa hợp đồng" action.',
    },
    preconditions: ['Contract HD000007 (Lê Minh Tuấn) is approved and active (demo data)'],
    steps: [
      { action: 'Contracts > open HD000007', expected: 'Status "Đang hiệu lực"' },
      { action: 'Look for an edit action', expected: 'There is no "Sửa hợp đồng"' },
    ],
    spec: {
      steps: [
        ...signIn('manager'),
        ...openContract('HD000007'),
        { id: 'active', type: 'expectText', target: main, text: 'Đang hiệu lực' },
        { id: 'no-edit', type: 'expectHidden', target: { by: 'text', text: 'Sửa hợp đồng', within: main } },
      ],
    },
  },
  {
    id: 'TC-20',
    section: 'Customers and contracts',
    priority: 'P2',
    title: 'Sessions left and debt are derived, not typed',
    requirement: {
      id: 'BR-602',
      statement:
        'Contract HD000007 (24 sessions, 3 completed, no receipts) shows "Còn lại" 21 and "Còn nợ" 12.000.000 ₫.',
    },
    preconditions: ['Contract HD000007: PT 24 sessions at 500,000, 3 completed, nothing paid (demo data)'],
    steps: [{ action: 'Open HD000007', expected: 'Sessions left 21; debt 12.000.000 ₫' }],
    spec: {
      steps: [
        ...signIn('manager'),
        ...openContract('HD000007'),
        { id: 'sessions-left', type: 'expectText', target: main, text: 'Còn lại21' },
        { id: 'debt', type: 'expectText', target: main, text: 'Còn nợ12.000.000' },
      ],
    },
  },
  {
    id: 'TC-21',
    section: 'Customers and contracts',
    priority: 'P2',
    title: 'An expired contract is shown as expired',
    requirement: {
      id: 'BR-402',
      statement:
        'Contract HD000009 (Ngô Gia Bảo) ended 10 days ago and shows status "Hết hạn"; an expired contract cannot be booked.',
    },
    preconditions: ['Contract HD000009 ended 10 days ago with sessions unused (demo data)'],
    steps: [{ action: 'Open HD000009', expected: 'Status "Hết hạn"' }],
    spec: {
      steps: [
        ...signIn('manager'),
        ...openContract('HD000009'),
        { id: 'expired', type: 'expectText', target: main, text: 'Hết hạn' },
      ],
    },
  },
  {
    id: 'TC-22',
    section: 'Customers and contracts',
    priority: 'P2',
    title: 'A receptionist sees a contract but cannot cancel it',
    requirement: {
      id: 'AC-01',
      statement:
        'A receptionist sees contracts but cannot add, edit, activate or cancel them: contract HD000007 shows no "Hủy hợp đồng".',
    },
    preconditions: ['Demo receptionist account; contract HD000007'],
    steps: [
      {
        action: 'Sign in as the receptionist; open HD000007',
        expected: 'The contract shows; there is no "Hủy hợp đồng"',
      },
    ],
    spec: {
      steps: [
        ...signIn('receptionist'),
        ...openContract('HD000007'),
        { id: 'visible', type: 'expectText', target: main, text: 'Đang hiệu lực' },
        { id: 'no-cancel', type: 'expectHidden', target: { by: 'text', text: 'Hủy hợp đồng', within: main } },
      ],
    },
  },
  {
    id: 'TC-23',
    section: 'Customers and contracts',
    priority: 'P1',
    title: 'A new contract takes its price and end date from the tier',
    requirement: {
      id: 'AC-10',
      statement: 'Entering any session count gives the right tier unit price, end date, and display name.',
    },
    preconditions: ['A customer without contracts; PT service priced 500,000 per session for 181 days'],
    steps: [
      {
        action: 'Customer > new contract: PT, 24 sessions',
        expected: 'Unit price 500.000 ₫, total 12.000.000 ₫, end date start + 181 days, name "PT 24 buổi"',
      },
    ],
    manualReason:
      'Creates a contract through a multi-field form whose expected end date depends on today; automation needs date-relative assertions and data cleanup.',
  },
  {
    id: 'TC-24',
    section: 'Customers and contracts',
    priority: 'P1',
    title: 'A new contract waits for approval and its creator cannot approve it',
    requirement: {
      id: 'BR-304',
      statement:
        'A contract is created Pending approval ("Chờ duyệt"); actions in the approval matrix take effect only after approval by someone other than the submitter.',
    },
    preconditions: ['A manager creates a contract'],
    steps: [
      { action: 'Create a contract', expected: 'Status "Chờ duyệt"' },
      {
        action: 'Try to approve it as its creator',
        expected: '"Bạn không thể tự duyệt yêu cầu do chính mình gửi."',
      },
    ],
    manualReason:
      'Needs a freshly created contract (the demo data has no pending one) and two sign-ins; the executor cannot pass the new contract id between steps yet.',
  },

  // --- PT booking
  {
    id: 'TC-25',
    section: 'PT booking',
    priority: 'P1',
    title: "A booking that overlaps the trainer's session is refused",
    requirement: {
      id: 'BR-403',
      statement:
        'A PT cannot have two sessions at once: booking a trainer at a time already booked shows "Huấn luyện viên đã có lịch trùng giờ này."',
    },
    preconditions: ["Trainer Khoa has Lan's session at 17:00 today (demo data)"],
    steps: [
      {
        action: 'PT calendar: book another customer with Khoa at 17:00 today',
        expected: '"Huấn luyện viên đã có lịch trùng giờ này."',
      },
    ],
    manualReason:
      'The calendar booking form uses date and time pickers relative to today; not automatable with the current step types without date-relative input.',
  },
  {
    id: 'TC-26',
    section: 'PT booking',
    priority: 'P1',
    title: 'A contract with no sessions left cannot be booked',
    requirement: {
      id: 'AC-15',
      statement: 'Booking is refused when no sessions are left, the contract has expired, or times overlap.',
    },
    preconditions: ['A contract with 0 sessions left'],
    steps: [{ action: 'Book a session on it', expected: '"Hợp đồng không còn buổi tập nào khả dụng."' }],
    manualReason:
      'The demo data has no contract with 0 sessions left; setting one up needs bookings created and completed first.',
  },
  {
    id: 'TC-27',
    section: 'PT booking',
    priority: 'P1',
    title: 'A contract not yet approved cannot be booked',
    requirement: { id: 'AC-11', statement: 'A contract not yet approved cannot be booked.' },
    preconditions: ['A contract in status "Chờ duyệt"'],
    steps: [
      {
        action: 'Book a session on the pending contract',
        expected: '"Hợp đồng không ở trạng thái hiệu lực (đang nháp, đã hủy hoặc đã hết hạn)."',
      },
    ],
    manualReason: "Depends on TC-24's freshly created pending contract.",
  },
  {
    id: 'TC-28',
    section: 'PT booking',
    priority: 'P2',
    title: 'Booking does not consume a session',
    requirement: {
      id: 'BR-401',
      statement: 'Booking never consumes a session: sessions left are unchanged after a booking is created.',
    },
    preconditions: ['An active contract with sessions left'],
    steps: [{ action: 'Note sessions left; book a session', expected: 'Sessions left unchanged' }],
    manualReason: 'Needs the calendar booking form (see TC-25) and a before/after comparison of a value.',
  },

  // --- Money
  {
    id: 'TC-29',
    section: 'Money',
    priority: 'P1',
    title: 'A payment above what is still owed is refused',
    requirement: {
      id: 'BR-604',
      statement:
        'A receipt may not take the paid amount above the contract value: "Khoản thanh toán làm tổng đã trả vượt giá trị hợp đồng."',
    },
    preconditions: ['Contract HD000007 owes 12.000.000 ₫'],
    steps: [
      {
        action: 'Record a payment of 13.000.000 ₫ on HD000007',
        expected: '"Khoản thanh toán làm tổng đã trả vượt giá trị hợp đồng."',
      },
    ],
    manualReason:
      'A refused payment changes nothing, but a mistake in the steps would record real money in the instance; kept manual until a scoped approval for payment steps is set up.',
  },
  {
    id: 'TC-30',
    section: 'Money',
    priority: 'P2',
    title: 'The cash book balances',
    requirement: {
      id: 'AC-19',
      statement: 'Cash book closing balance equals opening balance plus receipts minus expenses.',
    },
    preconditions: ['Payments and expenses recorded for the day'],
    steps: [{ action: 'Reports > Sổ quỹ for today', expected: 'Closing = opening + receipts − expenses' }],
    manualReason:
      'Needs arithmetic across several displayed amounts; the executor compares observed text with expected text and does not compute values.',
  },
];
