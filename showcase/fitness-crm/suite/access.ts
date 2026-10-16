import {
  auto,
  FORBIDDEN,
  forbiddenAt,
  headingAt,
  main,
  manual,
  menuReady,
  ROLE,
  ROLE_NAME,
  signIn,
  WHY,
  type Module,
  type RoleKey,
  type SuiteCase,
} from './helpers.ts';

const S_AUTH = 'Sign-in and sessions';
const S_RBAC = 'Roles and permissions';

const auth: SuiteCase[] = [
  auto({
    id: 'AUTH-01',
    section: S_AUTH,
    priority: 'P1',
    technique: 'Use case',
    title: 'A manager signs in with email and password and reaches the dashboard',
    requirement: {
      id: 'BR-107',
      statement:
        'A user with valid credentials signs in with email and password and lands on the dashboard "Tổng quan".',
    },
    pre: ['Demo manager account'],
    steps: [['Sign in as the manager', 'The dashboard "Tổng quan" opens']],
    spec: [
      ...signIn('manager'),
      {
        id: 'dashboard',
        type: 'expectVisible',
        target: { by: 'role', role: 'heading', name: 'Tổng quan', exact: true, within: main },
      },
    ],
  }),
  auto({
    id: 'AUTH-02',
    section: S_AUTH,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'A wrong password is refused with one generic message',
    requirement: {
      id: 'BR-107',
      statement:
        'A wrong password is refused with "The email or password is wrong, or the account is disabled." and the user stays on /login.',
    },
    pre: ['Demo manager account'],
    steps: [
      ['Sign in as the manager with a wrong password', 'The generic message is shown; still on /login'],
    ],
    spec: [
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
      { id: 'sign-in', type: 'click', target: { by: 'role', role: 'button', name: 'Sign in', within: main } },
      {
        id: 'generic-error',
        type: 'expectText',
        target: main,
        text: 'The email or password is wrong, or the account is disabled.',
      },
      { id: 'stays', type: 'expectUrl', path: '/login' },
    ],
  }),
  auto({
    id: 'AUTH-03',
    section: S_AUTH,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'An unknown email gets the same message as a wrong password (no account discovery)',
    requirement: {
      id: 'BR-107',
      statement:
        'Signing in with an email that has no account shows the same "The email or password is wrong, or the account is disabled." message.',
    },
    pre: ['No account for nobody@fitness-crm.test'],
    steps: [
      [
        'Sign in as nobody@fitness-crm.test',
        'The same generic message; nothing reveals whether the account exists',
      ],
    ],
    spec: [
      { id: 'open-login', type: 'navigate', path: '/login' },
      {
        id: 'email',
        type: 'fill',
        target: { by: 'label', label: 'Email', within: main },
        value: 'nobody@fitness-crm.test',
      },
      {
        id: 'password',
        type: 'fill',
        target: { by: 'label', label: 'Password', within: main },
        value: 'whatever-password-1',
      },
      { id: 'sign-in', type: 'click', target: { by: 'role', role: 'button', name: 'Sign in', within: main } },
      {
        id: 'generic-error',
        type: 'expectText',
        target: main,
        text: 'The email or password is wrong, or the account is disabled.',
      },
    ],
  }),
  auto({
    id: 'AUTH-04',
    section: S_AUTH,
    priority: 'P1',
    technique: 'State transition',
    title: 'A signed-out visitor who opens the dashboard is sent to the login page',
    requirement: {
      id: 'AC-01',
      statement: 'A visitor who is not signed in and opens /dashboard by direct URL is sent to /login.',
    },
    pre: ['Not signed in'],
    steps: [['Open /dashboard', 'The login page opens']],
    spec: [
      { id: 'open-dashboard', type: 'navigate', path: '/dashboard' },
      { id: 'to-login', type: 'expectUrl', path: '/login' },
    ],
  }),
  auto({
    id: 'AUTH-05',
    section: S_AUTH,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A signed-out deep link to a record page is sent to the login page',
    requirement: {
      id: 'AC-01',
      statement: 'A visitor who is not signed in and opens /contracts by direct URL is sent to /login.',
    },
    pre: ['Not signed in'],
    steps: [['Open /contracts', 'The login page opens']],
    spec: [
      { id: 'open-contracts', type: 'navigate', path: '/contracts' },
      { id: 'to-login', type: 'expectUrl', path: '/login' },
    ],
  }),
  auto({
    id: 'AUTH-06',
    section: S_AUTH,
    priority: 'P1',
    technique: 'State transition',
    title: 'After signing out, the dashboard needs a new sign-in',
    requirement: {
      id: 'BR-107',
      statement: 'After "Đăng xuất" from the account menu, opening /dashboard sends the user to /login.',
    },
    pre: ['Signed in as the manager'],
    steps: [
      ['Account menu "Tài khoản" > "Đăng xuất"', 'The login page opens'],
      ['Open /dashboard', 'Sent to /login again'],
    ],
    spec: [
      ...signIn('manager'),
      {
        id: 'account-menu',
        type: 'click',
        target: { by: 'role', role: 'button', name: 'Tài khoản', exact: true },
      },
      {
        id: 'sign-out',
        type: 'click',
        target: { by: 'role', role: 'menuitem', name: 'Đăng xuất', exact: true },
      },
      { id: 'signed-out', type: 'expectUrl', path: '/login' },
      { id: 'open-dashboard', type: 'navigate', path: '/dashboard' },
      { id: 'to-login-again', type: 'expectUrl', path: '/login' },
    ],
  }),
  manual({
    id: 'AUTH-07',
    section: S_AUTH,
    priority: 'P2',
    technique: 'Decision table',
    title: 'Sign-in outside the allowed hours or days is refused',
    requirement: {
      id: 'BR-107',
      statement: 'Accounts can sign in only within their allowed hours and days.',
    },
    pre: ['A user whose allowed hours exclude the current time'],
    steps: [
      [
        'Sign in outside the allowed window',
        'Sign-in refused; the attempt is in the login history as failed',
      ],
      ['Sign in inside the window', 'Signed in'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'AUTH-08',
    section: S_AUTH,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A disabled account cannot sign in and gets the generic message',
    requirement: {
      id: 'BR-107',
      statement: 'A disabled account is refused with the generic sign-in message.',
    },
    pre: ['Admin disables a test user'],
    steps: [
      ['Sign in as the disabled user', '"The email or password is wrong, or the account is disabled."'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'AUTH-09',
    section: S_AUTH,
    priority: 'P2',
    technique: 'Use case',
    title: 'Every sign-in attempt is recorded with device and IP',
    requirement: {
      id: 'BR-107',
      statement: 'Sign-ins are recorded with device and IP in the login history.',
    },
    pre: ['Admin can open Users > a user > Login history'],
    steps: [
      [
        'Sign in once with a wrong and once with the right password',
        'Both attempts appear with result, device and IP',
      ],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'AUTH-10',
    section: S_AUTH,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'Sign-in is rate limited at 20 attempts per minute per IP',
    requirement: {
      id: 'BR-107',
      statement: 'The sign-in endpoint allows 20 attempts per 60 seconds per IP; the 21st is refused.',
    },
    pre: ['A clean rate-limit window'],
    steps: [
      ['Make 20 sign-in attempts within a minute', 'All are processed'],
      ['Make the 21st', 'Refused with HTTP 429'],
      ['Wait for the window to pass', 'Sign-in works again'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'AUTH-11',
    section: S_AUTH,
    priority: 'P3',
    technique: 'Boundary value analysis',
    title: 'A session ends after 12 hours without activity',
    requirement: { id: 'BR-107', statement: 'A session lasts one working day (12 hours) without activity.' },
    pre: ['Signed in'],
    steps: [
      ['Stay inactive for just under 12 hours', 'Still signed in'],
      ['Stay inactive for 12 hours', '"Phiên đăng nhập đã hết. Hãy đăng nhập lại."'],
    ],
    why: WHY.time,
  }),
];

/**
 * Permission matrix by privilege boundary: for each page, the least privileged role that should get
 * in, and the most privileged role that should not (docs/09_RBAC.md). Expected access comes from
 * the requirements, never from the product's behaviour.
 */
const PAGES: Array<{
  path: string;
  heading: string;
  permission: string;
  allowed: RoleKey;
  refused: RoleKey;
  rule: string;
}> = [
  {
    path: '/admin/users',
    heading: 'Người dùng',
    permission: 'user.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Users, roles, permissions: Admin only',
  },
  {
    path: '/admin/roles',
    heading: 'Vai trò và phân quyền',
    permission: 'role.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Users, roles, permissions: Admin only',
  },
  {
    path: '/admin/options',
    heading: 'Danh mục lựa chọn',
    permission: 'config.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Configuration: Admin only',
  },
  {
    path: '/admin/parameters',
    heading: 'Tham số hệ thống',
    permission: 'config.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Configuration: Admin only',
  },
  {
    path: '/admin/trash',
    heading: 'Thùng rác',
    permission: 'trash.view',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Trash: view, Admin only (AC-13)',
  },
  {
    path: '/admin/audit',
    heading: 'Lịch sử thao tác',
    permission: 'audit.view',
    allowed: 'admin',
    refused: 'manager',
    rule: 'History: audit.view, Admin only',
  },
  {
    path: '/admin/system',
    heading: 'Tình trạng hệ thống',
    permission: 'system.view',
    allowed: 'admin',
    refused: 'manager',
    rule: 'System status: Admin only',
  },
  {
    path: '/admin/approvals',
    heading: 'Ma trận phê duyệt',
    permission: 'approval.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Approval matrix: Admin only',
  },
  {
    path: '/admin/email-templates',
    heading: 'Mẫu email gửi khách',
    permission: 'mail.template',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Email templates: Admin only',
  },
  {
    path: '/admin/intake',
    heading: 'Nguồn nhận lead',
    permission: 'intake.manage',
    allowed: 'admin',
    refused: 'manager',
    rule: 'Lead sources: Admin only',
  },
  {
    path: '/admin/promotions',
    heading: 'Khuyến mãi và voucher',
    permission: 'config.manage',
    allowed: 'admin',
    refused: 'receptionist',
    rule: 'Promotions: managed by Admin; reception has no page to manage them',
  },
  {
    path: '/admin/services',
    heading: 'Dịch vụ và bậc giá',
    permission: 'service.view',
    allowed: 'receptionist',
    refused: 'trainer',
    rule: 'Read services and price tiers: Admin, Fitness Manager, Consulting, Receptionist',
  },
  {
    path: '/leads',
    heading: 'Lead',
    permission: 'lead.view',
    allowed: 'receptionist',
    refused: 'trainer',
    rule: 'Leads: view: Admin, Fitness Manager, Consulting (own), Receptionist',
  },
  {
    path: '/leads/audit',
    heading: 'Audit tư vấn',
    permission: 'lead.audit',
    allowed: 'manager',
    refused: 'receptionist',
    rule: 'Consulting audit: Admin, Fitness Manager',
  },
  {
    path: '/leads/receivers',
    heading: 'Nhận lead',
    permission: 'lead.assign',
    allowed: 'manager',
    refused: 'consulting',
    rule: 'Leads: reassign and receivers: Admin, Fitness Manager',
  },
  {
    path: '/employees',
    heading: 'Nhân viên',
    permission: 'employee.view',
    allowed: 'trainer',
    refused: 'receptionist',
    rule: 'Employees and PT schedules: Admin, Fitness Manager, PT (own schedule)',
  },
  {
    path: '/reports/pt-revenue',
    heading: 'Doanh thu phân bổ PT',
    permission: 'report.ptRevenue',
    allowed: 'accountant',
    refused: 'receptionist',
    rule: 'PT revenue: Admin, Fitness Manager, Accountant',
  },
  {
    path: '/reports/pt-payouts',
    heading: 'Chi trả PT',
    permission: 'payout.view',
    allowed: 'accountant',
    refused: 'receptionist',
    rule: 'PT payouts: Admin, Fitness Manager, Accountant',
  },
  {
    path: '/reports/bookings',
    heading: 'Báo cáo booking',
    permission: 'report.bookings',
    allowed: 'receptionist',
    refused: 'consulting',
    rule: 'Booking report: Admin, Fitness Manager, Receptionist',
  },
  {
    path: '/reports/tasks',
    heading: 'Giao việc',
    permission: 'report.tasks',
    allowed: 'manager',
    refused: 'receptionist',
    rule: 'Tasks report: Admin, Fitness Manager',
  },
  {
    path: '/reports/workouts',
    heading: 'Dashboard giáo án theo tuần',
    permission: 'report.workouts',
    allowed: 'manager',
    refused: 'trainer',
    rule: 'Workout dashboard: Admin, Fitness Manager, Master',
  },
  {
    path: '/reports/lead-analysis',
    heading: 'Phân tích lead',
    permission: 'report.leadAnalysis',
    allowed: 'manager',
    refused: 'consulting',
    rule: 'Lead analysis: refused to a consultant (A-093)',
  },
  {
    path: '/reports/consulting',
    heading: 'Dashboard tư vấn',
    permission: 'report.consulting',
    allowed: 'consulting',
    refused: 'receptionist',
    rule: 'Consulting dashboard: a consultant sees their own; a receptionist does not (A-093)',
  },
  {
    path: '/reports/cash-book',
    heading: 'Sổ quỹ',
    permission: 'report.cashBook',
    allowed: 'accountant',
    refused: 'receptionist',
    rule: 'Cash book report: refused to a receptionist',
  },
  {
    path: '/finance/cash',
    heading: 'Tài chính',
    permission: 'cash.manage',
    allowed: 'accountant',
    refused: 'receptionist',
    rule: 'Income and expenses: not for a receptionist',
  },
  {
    path: '/finance/payments',
    heading: 'Tài chính',
    permission: 'payment.view',
    allowed: 'consulting',
    refused: 'trainer',
    rule: 'Receipts: Admin, Fitness Manager, Consulting, Receptionist',
  },
  {
    path: '/workouts/plans',
    heading: 'Giáo án của khách',
    permission: 'workout.view',
    allowed: 'trainer',
    refused: 'receptionist',
    rule: 'Workout plans: Admin, Fitness Manager, Master, PT (own)',
  },
  {
    path: '/admin/workout-catalog',
    heading: 'Danh mục giáo án',
    permission: 'workout.view',
    allowed: 'trainer',
    refused: 'consulting',
    rule: 'Workout catalogs: read with workout.view',
  },
  {
    path: '/calendar',
    heading: 'Lịch PT',
    permission: 'booking.view',
    allowed: 'trainer',
    refused: 'consulting',
    rule: 'PT schedule: Admin, Fitness Manager, PT (own), Receptionist',
  },
  {
    path: '/classes',
    heading: 'Lịch lớp',
    permission: 'class.view',
    allowed: 'receptionist',
    refused: 'consulting',
    rule: 'Classes: everyone who has booking.view',
  },
];

const rbac: SuiteCase[] = PAGES.flatMap((p, i) => {
  const n = String(i + 1).padStart(2, '0');
  const req = {
    id: 'AC-01',
    statement: `${p.rule}: ${ROLE_NAME[p.allowed]} opens ${p.path} ("${p.heading}"); ${ROLE_NAME[p.refused]} sees "${FORBIDDEN}".`,
  };
  return [
    auto({
      id: `RBAC-${n}A`,
      section: S_RBAC,
      priority: 'P1',
      technique: 'Permission matrix',
      title: `${ROLE_NAME[p.allowed]} can open ${p.path}`,
      requirement: req,
      pre: [`Demo ${ROLE_NAME[p.allowed]} account`],
      steps: [[`Sign in as ${ROLE_NAME[p.allowed]} and open ${p.path}`, `The page "${p.heading}" opens`]],
      spec: [...signIn(p.allowed), ...headingAt(p.path, p.heading)],
    }),
    auto({
      id: `RBAC-${n}B`,
      section: S_RBAC,
      priority: 'P1',
      technique: 'Permission matrix',
      title: `${ROLE_NAME[p.refused]} cannot open ${p.path}`,
      requirement: req,
      pre: [`Demo ${ROLE_NAME[p.refused]} account`],
      steps: [[`Sign in as ${ROLE_NAME[p.refused]} and open ${p.path} directly`, `"${FORBIDDEN}"`]],
      spec: [...signIn(p.refused), ...forbiddenAt(p.path)],
    }),
  ];
});

const menu: SuiteCase[] = [
  auto({
    id: 'RBAC-M1',
    section: S_RBAC,
    priority: 'P1',
    technique: 'Permission matrix',
    title: 'A trainer has no Finance menu entry',
    requirement: {
      id: 'AC-01',
      statement:
        'An account without permission for a module does not see its menu: a PT has no "Tài chính" entry.',
    },
    pre: ['Demo PT account'],
    steps: [['Sign in as the PT', 'The menu has "Công việc" but no "Tài chính"']],
    spec: [
      ...signIn('trainer'),
      menuReady,
      {
        id: 'no-finance-menu',
        type: 'expectHidden',
        target: { by: 'role', role: 'link', name: 'Tài chính', exact: true },
      },
    ],
  }),
  auto({
    id: 'RBAC-M2',
    section: S_RBAC,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A manager has the Finance menu entry',
    requirement: {
      id: 'AC-01',
      statement: 'A Fitness Manager, who has finance permissions, sees the menu entry "Tài chính".',
    },
    pre: ['Demo manager account'],
    steps: [['Sign in as the manager', 'The menu has "Tài chính"']],
    spec: [
      ...signIn('manager'),
      {
        id: 'finance-menu',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'Tài chính', exact: true },
      },
    ],
  }),
  auto({
    id: 'RBAC-M3',
    section: S_RBAC,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A receptionist sees services but cannot add one',
    requirement: {
      id: 'AC-01',
      statement: 'Reception reads services and prices but has no "Thêm dịch vụ" button.',
    },
    pre: ['Demo receptionist account'],
    steps: [['Open Services as the receptionist', 'The list shows; there is no "Thêm dịch vụ"']],
    spec: [
      ...signIn('receptionist'),
      ...headingAt('/admin/services', 'Dịch vụ và bậc giá'),
      { id: 'no-add', type: 'expectHidden', target: { by: 'text', text: 'Thêm dịch vụ', within: main } },
    ],
  }),
  auto({
    id: 'RBAC-M4',
    section: S_RBAC,
    priority: 'P3',
    technique: 'Permission matrix',
    title: 'An admin can add a service',
    requirement: { id: 'AC-01', statement: 'An Admin sees the "Thêm dịch vụ" action on Services.' },
    pre: ['Admin account'],
    steps: [['Open Services as Admin', '"Thêm dịch vụ" is offered']],
    spec: [
      ...signIn('admin'),
      ...headingAt('/admin/services', 'Dịch vụ và bậc giá'),
      { id: 'add', type: 'expectVisible', target: { by: 'text', text: 'Thêm dịch vụ', within: main } },
    ],
  }),
  manual({
    id: 'RBAC-M5',
    section: S_RBAC,
    priority: 'P1',
    technique: 'Permission matrix',
    title: 'A consultant sees only their own leads and customers',
    requirement: {
      id: 'BR-101',
      statement:
        'Data scope "own": a consultant sees leads added by them or in their charge; another consultant\'s lead says who has it, with no way in.',
    },
    pre: ['Two consultants, each with a lead'],
    steps: [
      ['Sign in as consultant A; open the lead list', "Only A's leads"],
      ["Open consultant B's lead by URL", 'Shows who has it, with no way in'],
    ],
    why: WHY.setup,
  }),
  manual({
    id: 'RBAC-M6',
    section: S_RBAC,
    priority: 'P1',
    technique: 'Permission matrix',
    title: 'A role with phone numbers hidden never sees them, on screen or in exports',
    requirement: {
      id: 'AC-01',
      statement: 'A role with phone numbers hidden never sees them on any screen or export.',
    },
    pre: ['A role with the customer phone field hidden (e.g. Marketing)'],
    steps: [
      ['Open customers and a customer as that role', 'No phone numbers'],
      ['Export the list', 'The file has no phone column'],
    ],
    why: WHY.setup,
  }),
  manual({
    id: 'RBAC-M7',
    section: S_RBAC,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A per-user override switches one permission off',
    requirement: {
      id: 'FR-PLT-003',
      statement: 'Admin switches individual permissions on or off per user; the change applies immediately.',
    },
    pre: ['Admin and a receptionist'],
    steps: [
      [
        'Admin removes payment.view from the receptionist',
        "The receptionist's /finance/payments is refused at the next page load",
      ],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'RBAC-M8',
    section: S_RBAC,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A user sees only the branches granted to them',
    requirement: {
      id: 'BR-101',
      statement:
        'Every business record belongs to a branch; a user sees and acts only in the branches granted to them.',
    },
    pre: ['Two branches with data; a user granted one'],
    steps: [['Open lists as that user', "Only the granted branch's records"]],
    why: WHY.setup,
  }),
];

export const ACCESS: Module = {
  id: 'ACCESS',
  name: 'Sign-in, sessions, roles and permissions',
  designs: [
    {
      technique: 'Equivalence partitioning',
      title: 'Sign-in credentials',
      columns: ['Partition', 'Example', 'Expected', 'Cases'],
      rows: [
        ['Valid email + correct password', 'demo-manager + password', 'Dashboard', 'AUTH-01'],
        ['Valid email + wrong password', 'demo-manager + wrong', 'Generic message', 'AUTH-02'],
        ['Unknown email', 'nobody@…', 'Same generic message', 'AUTH-03'],
        ['Disabled account', 'disabled user', 'Same generic message', 'AUTH-08'],
        ['Outside allowed hours', 'restricted user', 'Refused, logged', 'AUTH-07'],
      ],
    },
    {
      technique: 'State transition',
      title: 'Session',
      columns: ['From', 'Event', 'To', 'Cases'],
      rows: [
        ['Signed out', 'Open a protected page', 'Login page', 'AUTH-04, AUTH-05'],
        ['Signed out', 'Valid sign-in', 'Signed in (dashboard)', 'AUTH-01'],
        ['Signed in', 'Đăng xuất', 'Signed out', 'AUTH-06'],
        ['Signed in', '12 h without activity', 'Signed out', 'AUTH-11'],
      ],
    },
    {
      technique: 'Boundary value analysis',
      title: 'Sign-in rate limit (20 per 60 s per IP)',
      columns: ['Attempt in the window', 'Expected', 'Case'],
      rows: [
        ['20th', 'Processed', 'AUTH-10'],
        ['21st', 'HTTP 429', 'AUTH-10'],
      ],
    },
    {
      technique: 'Permission matrix',
      title: 'Page access by privilege boundary (expected from docs/09_RBAC.md)',
      columns: ['Page', 'Permission', 'Allowed (least privileged)', 'Refused (most privileged)', 'Cases'],
      rows: PAGES.map((p, i) => [
        p.path,
        p.permission,
        ROLE_NAME[p.allowed],
        ROLE_NAME[p.refused],
        `RBAC-${String(i + 1).padStart(2, '0')}A/B`,
      ]),
    },
  ],
  cases: [...auth, ...rbac, ...menu],
};
