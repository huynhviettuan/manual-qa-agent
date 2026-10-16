import {
  auto,
  customerRow,
  main,
  manual,
  newContractForm,
  openContract,
  openCustomer,
  priceSection,
  serviceSection,
  signIn,
  submitContract,
  WHY,
  type Module,
  type SuiteCase,
} from './helpers.ts';

const SC = 'Customers';
const SK = 'Contracts';
const RANGE = 'Nhập một số nguyên từ 1 đến 1000';

const standing = (id: string, name: string, status: string, partition: string): SuiteCase =>
  auto({
    id,
    section: SC,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: `Customer standing "${status}" (${partition})`,
    requirement: {
      id: 'BR-207',
      statement: `Customer status is derived from contracts: ${name} (${partition}) shows "${status}" in the customer list.`,
    },
    pre: [`${name} in the demo data: ${partition}`],
    steps: [['Open Customers', `${name}'s row shows "${status}"`]],
    spec: [
      ...signIn('manager'),
      { id: 'open-customers', type: 'navigate', path: '/customers' },
      { id: 'standing', type: 'expectText', target: customerRow(name), text: status },
    ],
  });

const price = (
  id: string,
  sessions: string,
  technique: 'Boundary value analysis' | 'Equivalence partitioning',
  name: string,
  total: string,
): SuiteCase =>
  auto({
    id,
    section: SK,
    priority: 'P1',
    technique,
    title: `${sessions} session(s) price from the tier: ${total} ₫`,
    requirement: {
      id: 'AC-10',
      statement: `Entering ${sessions} sessions of PT (tier 500.000 ₫ per session) gives the name "${name}" and the total ${total} ₫.`,
    },
    pre: ['Signed in as the manager; customer Phan Thị Kim Ngân has no running contract'],
    steps: [
      [
        `New contract, service PT, ${sessions} sessions`,
        `The price panel shows "${name}" and ${total} ₫; nothing is saved`,
      ],
    ],
    spec: [
      ...signIn('manager'),
      ...newContractForm(sessions),
      { id: 'contract-name', type: 'expectText', target: priceSection, text: name },
      { id: 'total', type: 'expectText', target: priceSection, text: total },
    ],
  });

const refusedOnSubmit = (
  id: string,
  sessions: string,
  technique: 'Boundary value analysis' | 'Equivalence partitioning',
  why: string,
): SuiteCase =>
  auto({
    id,
    section: SK,
    priority: 'P1',
    technique,
    title: `Submitting ${why} sessions is refused`,
    requirement: {
      id: 'AC-10',
      statement: `Submitting a contract with ${why} sessions ("${sessions}") shows "${RANGE}." and creates nothing.`,
    },
    steps: [[`New contract, PT, sessions "${sessions}"; "Tạo hợp đồng"`, `"${RANGE}."; still on the form`]],
    spec: [
      ...signIn('manager'),
      ...newContractForm(sessions),
      submitContract,
      { id: 'range-error', type: 'expectText', target: serviceSection, text: RANGE },
    ],
  });

const cases: SuiteCase[] = [
  standing('CUS-01', 'Lê Minh Tuấn', 'Đang tập', 'a contract running'),
  standing('CUS-02', 'Đinh Công Sơn', 'Sắp hết hạn', 'the longest contract ends in exactly 30 days'),
  standing('CUS-03', 'Ngô Gia Bảo', 'Hết hạn', 'every contract has ended'),
  standing('CUS-04', 'Phan Thị Kim Ngân', 'Chưa có hợp đồng', 'the only contract was cancelled'),
  standing('CUS-05', 'Lý Thị Hoa', 'Ngừng hoạt động', 'customer set inactive'),
  manual({
    id: 'CUS-06',
    section: SC,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'Expiring soon starts at 30 days before the end',
    requirement: {
      id: 'BR-207',
      statement:
        'A customer is "Sắp hết hạn" when the contract that runs longest ends within 30 days (A-131): 31 days left is "Đang tập".',
    },
    steps: [
      ['Contract ending in 31 days', '"Đang tập"'],
      ['Ending in 30 days', '"Sắp hết hạn"'],
      ['Ended yesterday', '"Hết hạn"'],
    ],
    why: WHY.date,
  }),
  auto({
    id: 'CUS-07',
    section: SC,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'Search customers by phone',
    requirement: {
      id: 'FR-CUS-003',
      statement: 'Searching customers for 0966554433 lists Ngô Gia Bảo and not Lê Minh Tuấn.',
    },
    steps: [['Search 0966554433', 'Only Ngô Gia Bảo']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/customers?q=0966554433' },
      {
        id: 'match',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'Ngô Gia Bảo', exact: true, within: main },
      },
      {
        id: 'no-other',
        type: 'expectHidden',
        target: { by: 'role', role: 'link', name: 'Lê Minh Tuấn', exact: true, within: main },
      },
    ],
  }),
  auto({
    id: 'CUS-08',
    section: SC,
    priority: 'P3',
    technique: 'Equivalence partitioning',
    title: 'Search customers by code',
    requirement: { id: 'FR-CUS-003', statement: 'Searching customers for code KH000008 lists Ngô Gia Bảo.' },
    steps: [['Search KH000008', 'Ngô Gia Bảo']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/customers?q=KH000008' },
      {
        id: 'match',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'Ngô Gia Bảo', exact: true, within: main },
      },
    ],
  }),
  auto({
    id: 'CUS-09',
    section: SC,
    priority: 'P3',
    technique: 'Equivalence partitioning',
    title: 'A customer search with no match says so',
    requirement: { id: 'FR-CUS-003', statement: 'A customer search with no match shows "Không có kết quả".' },
    steps: [['Search "zz-no-such-customer"', '"Không có kết quả"']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/customers?q=zz-no-such-customer' },
      { id: 'none', type: 'expectText', target: main, text: 'Không có kết quả' },
    ],
  }),
  auto({
    id: 'CUS-10',
    section: SC,
    priority: 'P2',
    technique: 'Use case',
    title: 'The customer profile has all its tabs',
    requirement: {
      id: 'FR-CUS-004',
      statement:
        'A customer page has the tabs Thông tin, Hợp đồng, Lịch tập, Thanh toán, Lịch sử tư vấn, Giáo án and Email đã gửi.',
    },
    steps: [['Open Lý Thị Hoa', 'All seven tabs']],
    spec: [
      ...signIn('manager'),
      ...openCustomer('Lý Thị Hoa'),
      ...['Thông tin', 'Hợp đồng', 'Lịch tập', 'Thanh toán', 'Lịch sử tư vấn', 'Giáo án', 'Email đã gửi'].map(
        (t, i) => ({
          id: `tab-${i + 1}`,
          type: 'expectVisible',
          target: { by: 'role', role: 'tab', name: t, exact: true, within: main },
        }),
      ),
    ],
  }),
  manual({
    id: 'CUS-11',
    section: SC,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'A customer phone is required with 8 to 15 digits',
    requirement: {
      id: 'FR-CUS-001',
      statement:
        'A customer phone is required, 8 to 15 digits: empty and 7 digits are refused, 8 and 15 accepted, 16 refused.',
    },
    steps: [['Add a customer with each phone value', 'Empty/7/16 refused; 8/15 accepted']],
    why: WHY.mutate,
  }),
  manual({
    id: 'CUS-12',
    section: SC,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A customer email is required and must be valid',
    requirement: {
      id: 'FR-CUS-001',
      statement:
        'A customer email is required: empty shows "Bắt buộc nhập.", malformed shows "Email không hợp lệ."',
    },
    steps: [
      ['Save without email', '"Bắt buộc nhập."'],
      ['Save "an@"', '"Email không hợp lệ."'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CUS-13',
    section: SC,
    priority: 'P2',
    technique: 'Use case',
    title: 'Customers without email are highlighted for reception',
    requirement: { id: 'FR-CUS-005', statement: 'Customers without email are highlighted for reception.' },
    steps: [['Open Customers as reception', 'Rows without email stand out']],
    why: WHY.judge,
  }),
  manual({
    id: 'CUS-14',
    section: SC,
    priority: 'P1',
    technique: 'Decision table',
    title: "Changing a customer's identity needs the manager's approval",
    requirement: {
      id: 'BR-103',
      statement:
        "Editing a customer's identity (name, phone, email, documents) takes effect only after approval by the Fitness Manager.",
    },
    steps: [
      ['Reception changes the phone', 'Pending; old phone still shown'],
      ['Manager approves', 'New phone shown'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CUS-15',
    section: SC,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'ID numbers and health notes are encrypted and served only through signed links',
    requirement: {
      id: 'D-042',
      statement:
        'ID numbers and health notes are encrypted at rest; files are served only through signed links.',
    },
    steps: [
      ['Read the database row', 'Ciphertext'],
      ['Open a document link after it expires', 'Refused'],
    ],
    why: WHY.judge,
  }),
  manual({
    id: 'CUS-16',
    section: SC,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A trainer sees only their own customers',
    requirement: { id: 'BR-101', statement: 'A PT (data scope own) sees only their own customers.' },
    steps: [['Open Customers as the trainer', 'Only customers the trainer coaches']],
    why: WHY.setup,
  }),

  // Contracts: pricing and validation
  price('CON-01', '1', 'Boundary value analysis', 'PT 1 buổi', '500.000'),
  price('CON-02', '24', 'Equivalence partitioning', 'PT 24 buổi', '12.000.000'),
  price('CON-03', '1000', 'Boundary value analysis', 'PT 1000 buổi', '500.000.000'),
  refusedOnSubmit('CON-04', '0', 'Boundary value analysis', 'zero'),
  refusedOnSubmit('CON-05', '1001', 'Boundary value analysis', 'too many (1001)'),
  refusedOnSubmit('CON-06', 'abc', 'Equivalence partitioning', 'non-numeric'),
  auto({
    id: 'CON-07',
    section: SK,
    priority: 'P3',
    technique: 'Boundary value analysis',
    title: 'The live price for 1001 sessions explains the range in Vietnamese',
    requirement: {
      id: 'AC-10',
      statement: `Before saving, typing 1001 sessions shows the range message "${RANGE}." in the price panel, as the form does on save.`,
    },
    steps: [['Type 1001 sessions; leave the field', `The price panel says "${RANGE}."`]],
    spec: [
      ...signIn('manager'),
      ...newContractForm('1001'),
      { id: 'range-message', type: 'expectText', target: priceSection, text: RANGE },
    ],
  }),
  manual({
    id: 'CON-08',
    section: SK,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: "The end date is the start plus the tier's validity",
    requirement: {
      id: 'BR-301',
      statement:
        "A contract's end date is computed from the tier: PT 24 sessions ends 181 days after the start.",
    },
    steps: [['24 sessions starting today', 'End date = today + 181 days']],
    why: WHY.date,
  }),
  manual({
    id: 'CON-09',
    section: SK,
    priority: 'P1',
    technique: 'Decision table',
    title: 'A price off the tier is an exception price needing a reason and approval',
    requirement: {
      id: 'BR-302',
      statement:
        'A price different from the tier is an exception price: reason required, approval required, both prices stored.',
    },
    steps: [
      ['"Giá ngoại lệ" without a reason', 'Refused'],
      ['With a reason', 'Flagged; cannot be activated until approved'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CON-10',
    section: SK,
    priority: 'P2',
    technique: 'Decision table',
    title: 'Promotion, then voucher, then VAT',
    requirement: {
      id: 'BR-303',
      statement:
        'Promotions and vouchers apply to the tier price (promotion first, voucher on the rest, then VAT) and are not exception prices.',
    },
    steps: [
      ['Choose a 10% promotion and a 100.000 voucher, VAT 8%', 'Total = ((tier × 0.9) − 100.000) × 1.08'],
    ],
    why: WHY.calc,
  }),
  manual({
    id: 'CON-11',
    section: SK,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'PT and Sale shares each total 100%',
    requirement: {
      id: 'BR-308',
      statement: 'PT and Sale shares on a contract each total 100%: 99% and 101% are refused.',
    },
    steps: [
      ['Sale shares 60% + 39%', 'Refused'],
      ['60% + 40%', 'Accepted'],
      ['60% + 41%', 'Refused'],
    ],
    why: WHY.mutate,
  }),
  // Contracts: state
  auto({
    id: 'CON-12',
    section: SK,
    priority: 'P1',
    technique: 'State transition',
    title: 'An approved contract has no Edit action',
    requirement: {
      id: 'BR-305',
      statement: 'An approved contract "Đang hiệu lực" is never edited: its page has no "Sửa hợp đồng".',
    },
    pre: ['HD000007 approved and active'],
    steps: [['Open HD000007', '"Đang hiệu lực"; no "Sửa hợp đồng"']],
    spec: [
      ...signIn('manager'),
      ...openContract('HD000007'),
      { id: 'active', type: 'expectText', target: main, text: 'Đang hiệu lực' },
      { id: 'no-edit', type: 'expectHidden', target: { by: 'text', text: 'Sửa hợp đồng', within: main } },
    ],
  }),
  auto({
    id: 'CON-13',
    section: SK,
    priority: 'P1',
    technique: 'State transition',
    title: 'An expired contract shows "Hết hạn"',
    requirement: { id: 'BR-402', statement: 'Contract HD000009 ended 10 days ago and shows "Hết hạn".' },
    steps: [['Open HD000009', '"Hết hạn"']],
    spec: [
      ...signIn('manager'),
      ...openContract('HD000009'),
      { id: 'expired', type: 'expectText', target: main, text: 'Hết hạn' },
    ],
  }),
  auto({
    id: 'CON-14',
    section: SK,
    priority: 'P2',
    technique: 'State transition',
    title: 'A cancelled contract shows "Đã hủy"',
    requirement: {
      id: 'BR-304',
      statement: 'Contract HD000010 (Phan Thị Kim Ngân) was cancelled and shows "Đã hủy".',
    },
    steps: [['Open HD000010', '"Đã hủy"']],
    spec: [
      ...signIn('manager'),
      ...openContract('HD000010'),
      { id: 'cancelled', type: 'expectText', target: main, text: 'Đã hủy' },
    ],
  }),
  auto({
    id: 'CON-15',
    section: SK,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'Sessions left and debt are derived',
    requirement: {
      id: 'BR-602',
      statement:
        'HD000007 (24 sessions, 3 completed, no receipts) shows "Còn lại" 21 and "Còn nợ" 12.000.000 ₫.',
    },
    steps: [['Open HD000007', 'Còn lại 21; Còn nợ 12.000.000 ₫']],
    spec: [
      ...signIn('manager'),
      ...openContract('HD000007'),
      { id: 'left', type: 'expectText', target: main, text: 'Còn lại21' },
      { id: 'debt', type: 'expectText', target: main, text: 'Còn nợ12.000.000' },
    ],
  }),
  auto({
    id: 'CON-16',
    section: SK,
    priority: 'P3',
    technique: 'Use case',
    title: 'The contract page has its three tabs',
    requirement: {
      id: 'FR-CON-005',
      statement: 'A contract page has the tabs "Thông tin", "Lịch sử check-in" and "Lịch sử gói tập".',
    },
    steps: [['Open HD000007', 'Three tabs']],
    spec: [
      ...signIn('manager'),
      ...openContract('HD000007'),
      ...['Thông tin', 'Lịch sử check-in', 'Lịch sử gói tập'].map((t, i) => ({
        id: `tab-${i + 1}`,
        type: 'expectVisible',
        target: { by: 'role', role: 'tab', name: t, exact: true, within: main },
      })),
    ],
  }),
  auto({
    id: 'CON-17',
    section: SK,
    priority: 'P1',
    technique: 'Permission matrix',
    title: 'A receptionist sees a contract but cannot cancel it',
    requirement: {
      id: 'AC-01',
      statement: 'A receptionist sees contracts but cannot cancel them: HD000007 shows no "Hủy hợp đồng".',
    },
    steps: [['Open HD000007 as the receptionist', 'Shown; no "Hủy hợp đồng"']],
    spec: [
      ...signIn('receptionist'),
      ...openContract('HD000007'),
      { id: 'shown', type: 'expectText', target: main, text: 'Đang hiệu lực' },
      { id: 'no-cancel', type: 'expectHidden', target: { by: 'text', text: 'Hủy hợp đồng', within: main } },
    ],
  }),
  auto({
    id: 'CON-18',
    section: SK,
    priority: 'P1',
    technique: 'Permission matrix',
    title: 'A receptionist cannot create a contract',
    requirement: {
      id: 'AC-01',
      statement: 'A receptionist (no contract create) sees a customer\'s contracts but no "Thêm hợp đồng".',
    },
    steps: [['Open Phan Thị Kim Ngân > Hợp đồng as the receptionist', 'HD000010 listed; no "Thêm hợp đồng"']],
    spec: [
      ...signIn('receptionist'),
      ...openCustomer('Phan Thị Kim Ngân'),
      {
        id: 'contracts-tab',
        type: 'click',
        target: { by: 'role', role: 'tab', name: 'Hợp đồng', exact: true, within: main },
      },
      {
        id: 'listed',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'HD000010', exact: true, within: main },
      },
      { id: 'no-add', type: 'expectHidden', target: { by: 'text', text: 'Thêm hợp đồng', within: main } },
    ],
  }),
  manual({
    id: 'CON-19',
    section: SK,
    priority: 'P1',
    technique: 'State transition',
    title: 'A new contract waits for approval; its creator cannot approve it',
    requirement: {
      id: 'BR-304',
      statement:
        'A contract is created "Chờ duyệt" and can be edited only while pending; nobody approves their own.',
    },
    steps: [
      ['Create a contract', '"Chờ duyệt"; editable'],
      ['Approve it as its creator', '"Bạn không thể tự duyệt yêu cầu do chính mình gửi."'],
      ['Approve as another manager', '"Đang hiệu lực"; no longer editable'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CON-20',
    section: SK,
    priority: 'P2',
    technique: 'State transition',
    title: 'A rejected contract has no effect',
    requirement: {
      id: 'BR-304',
      statement:
        'A contract the approver rejects is "Đã từ chối" and has no effect; a rejection needs a reason.',
    },
    steps: [
      ['Reject without a reason', 'Refused'],
      ['With a reason', '"Đã từ chối"; cannot be booked or paid'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CON-21',
    section: SK,
    priority: 'P2',
    technique: 'Decision table',
    title: 'Unapproving is allowed only with no receipts or sessions',
    requirement: {
      id: 'BR-304',
      statement: 'An approved contract can be sent back to pending only with no receipts or sessions.',
    },
    steps: [
      ['Unapprove with a receipt', 'Refused'],
      ['Without receipts or sessions', 'Back to "Chờ duyệt"'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CON-22',
    section: SK,
    priority: 'P1',
    technique: 'Decision table',
    title: 'Deleting a contract with receipts is blocked and lists them',
    requirement: {
      id: 'AC-12',
      statement:
        'Deleting a contract with receipts is blocked and the receipts to delete first are listed; after deleting in order, totals fall by exactly those amounts.',
    },
    steps: [
      ['Delete a contract with receipts', 'Blocked, receipts listed'],
      [
        'Delete receipts, then the contract',
        'Revenue and receipts fall by the deleted amounts; both in the trash',
      ],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CON-23',
    section: SK,
    priority: 'P1',
    technique: 'State transition',
    title: 'Freezing and reactivating extend the end date once',
    requirement: {
      id: 'AC-14',
      statement:
        'A frozen contract cannot be booked or checked in; reactivation shows the frozen days and proposed end date; it changes only after admin confirms and never twice.',
    },
    steps: [
      ['Deactivate with a reason', '"Tạm vô hiệu"; booking refused'],
      ['Reactivate after 10 days', 'Proposed end date + 10 days; confirmed once'],
      ['Freeze and reactivate again', 'No second extension'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'CON-24',
    section: SK,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A freeze longer than 10 days reminds the manager',
    requirement: { id: 'BR-307', statement: 'A freeze longer than 10 days creates a reminder task.' },
    steps: [
      ['Frozen for 10 days', 'No reminder'],
      ['11 days', 'Reminder task'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'CON-25',
    section: SK,
    priority: 'P2',
    technique: 'State transition',
    title: 'A renewal voucher waits for approval and then adds sessions',
    requirement: {
      id: 'FR-CHG-002',
      statement: 'An approved renewal voucher updates the derived figures; before approval it has no effect.',
    },
    steps: [
      ['Raise a renewal', 'Pending; figures unchanged'],
      ['Approve', 'Sessions and end date updated'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CON-26',
    section: SK,
    priority: 'P2',
    technique: 'State transition',
    title: 'A transfer moves the remaining sessions to the receiver',
    requirement: {
      id: 'FR-CHG-001',
      statement:
        'A transfer needs a receiver; once approved the giver has no sessions left and the receiver has them.',
    },
    steps: [
      ['Raise a transfer without a receiver', 'Refused'],
      ['With a receiver; approve', 'Sessions moved'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CON-27',
    section: SK,
    priority: 'P2',
    technique: 'Decision table',
    title: 'A cancellation with refund creates the expense voucher',
    requirement: {
      id: 'FR-CHG-002',
      statement: 'An approved cancellation creates the refund expense voucher.',
    },
    steps: [
      ['Raise a cancellation with refund', 'Needs reason, payment method, expense type'],
      ['Approve', 'Contract "Đã hủy"; refund voucher in the cash book'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CON-28',
    section: SK,
    priority: 'P2',
    technique: 'Use case',
    title: 'The contract list totals what the filter matches',
    requirement: {
      id: 'FR-CON-004',
      statement: 'The contract list totals value, paid and debt for the filter.',
    },
    steps: [['Filter by payment status "Chưa thanh toán"', 'Totals equal the sum of the listed rows']],
    why: WHY.calc,
  }),
  manual({
    id: 'CON-29',
    section: SK,
    priority: 'P3',
    technique: 'Use case',
    title: 'Imported contracts keep their opening balances',
    requirement: {
      id: 'BR-309',
      statement: 'Opening balances of imported contracts are set once and never edited.',
    },
    steps: [['Open HD000011 (imported)', 'Opening sessions used and paid amount shown; no way to edit them']],
    why: WHY.judge,
  }),
];

export const CONTRACTS: Module = {
  id: 'CON',
  name: 'Customers and contracts',
  designs: [
    {
      technique: 'Equivalence partitioning',
      title: 'Customer standing (BR-207, A-131)',
      columns: ['Partition', 'Demo customer', 'Expected badge', 'Case'],
      rows: [
        ['A contract running', 'Lê Minh Tuấn', 'Đang tập', 'CUS-01'],
        ['Ends within 30 days', 'Đinh Công Sơn (30 days)', 'Sắp hết hạn', 'CUS-02'],
        ['All contracts ended', 'Ngô Gia Bảo', 'Hết hạn', 'CUS-03'],
        ['No approved contract (cancelled)', 'Phan Thị Kim Ngân', 'Chưa có hợp đồng', 'CUS-04'],
        ['Customer inactive', 'Lý Thị Hoa', 'Ngừng hoạt động', 'CUS-05'],
      ],
    },
    {
      technique: 'Boundary value analysis',
      title: 'Sessions on a new contract (1–1000)',
      columns: ['Value', 'Expected', 'Case'],
      rows: [
        ['0', `Refused on save: ${RANGE}.`, 'CON-04'],
        ['1', 'PT 1 buổi, 500.000 ₫', 'CON-01'],
        ['24 (typical)', 'PT 24 buổi, 12.000.000 ₫', 'CON-02'],
        ['1000', 'PT 1000 buổi, 500.000.000 ₫', 'CON-03'],
        ['1001', `Refused on save; preview explains the range`, 'CON-05, CON-07'],
        ['abc', 'Refused on save', 'CON-06'],
      ],
    },
    {
      technique: 'Boundary value analysis',
      title: 'Expiring soon (30 days, A-131)',
      columns: ['Days to the end', 'Expected', 'Case'],
      rows: [
        ['31', 'Đang tập', 'CUS-06'],
        ['30', 'Sắp hết hạn', 'CUS-02, CUS-06'],
        ['−1', 'Hết hạn', 'CUS-06'],
      ],
    },
    {
      technique: 'State transition',
      title: 'Contract status',
      columns: ['From', 'Event', 'To', 'Cases'],
      rows: [
        ['—', 'Create', 'Chờ duyệt (editable)', 'CON-19'],
        ['Chờ duyệt', 'Approved by another person', 'Đang hiệu lực (locked)', 'CON-12, CON-19'],
        ['Chờ duyệt', 'Rejected with reason', 'Đã từ chối', 'CON-20'],
        ['Đang hiệu lực', 'Unapprove (no receipts/sessions)', 'Chờ duyệt', 'CON-21'],
        ['Đang hiệu lực', 'Deactivate with reason', 'Tạm vô hiệu', 'CON-23'],
        ['Tạm vô hiệu', 'Reactivate (admin confirms)', 'Đang hiệu lực, end + frozen days once', 'CON-23'],
        ['Đang hiệu lực', 'End date passes', 'Hết hạn', 'CON-13'],
        ['Đang hiệu lực', 'Cancellation approved', 'Đã hủy', 'CON-14, CON-27'],
      ],
    },
    {
      technique: 'Decision table',
      title: 'Deleting a contract (BR-306)',
      columns: ['Has receipts', 'Has sessions', 'Has change vouchers', 'Expected'],
      rows: [
        ['No', 'No', 'No', 'Deleted to the trash with reason (Admin approval)'],
        ['Yes', '—', '—', 'Blocked; receipts listed'],
        ['—', 'Yes', '—', 'Blocked'],
        ['—', '—', 'Yes', 'Blocked'],
      ],
    },
  ],
  cases,
};
