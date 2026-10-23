import { auto, headingAt, main, manual, signIn, WHY, type Module, type SuiteCase } from './helpers.ts';

const SM = 'Money';
const SA = 'Approvals, trash and audit';
const SG = 'Configuration';
const ST = 'Tasks and notifications';
const SW = 'Workouts';
const SR = 'Reports';
const SX = 'Security';

const money: SuiteCase[] = [
  manual({
    id: 'MON-01',
    section: SM,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'A receipt of 0 is refused',
    requirement: {
      id: 'BR-603',
      statement: 'Receipt amounts are greater than zero: 0 shows "Số tiền phải lớn hơn 0."',
    },
    steps: [['Record a payment of 0', '"Số tiền phải lớn hơn 0."']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-02',
    section: SM,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'A receipt of 1 ₫ is accepted',
    requirement: { id: 'BR-603', statement: 'A receipt of 1 ₫ is accepted.' },
    steps: [['Record 1', 'Recorded, pending approval']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-03',
    section: SM,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'A receipt equal to the debt is accepted',
    requirement: {
      id: 'BR-604',
      statement:
        'A receipt may take the paid amount up to the contract value: paying exactly the debt is accepted.',
    },
    steps: [['HD000007 owes 12.000.000: record 12.000.000', 'Accepted; debt 0 once approved']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-04',
    section: SM,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'A receipt above the debt is refused',
    requirement: {
      id: 'BR-604',
      statement:
        'A receipt may not take the paid amount above the contract value: "Khoản thanh toán làm tổng đã trả vượt giá trị hợp đồng."',
    },
    steps: [['Record 12.000.001 on HD000007', '"Khoản thanh toán làm tổng đã trả vượt giá trị hợp đồng."']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-05',
    section: SM,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A non-integer amount is refused',
    requirement: {
      id: 'BR-603',
      statement:
        'Amounts are whole đồng: "1.5" shows "Số tiền không hợp lệ. Nhập số đồng nguyên, ví dụ 12.000.000."',
    },
    steps: [['Amount 1.5', 'Invalid amount message']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-06',
    section: SM,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'A payment on a cancelled contract is refused',
    requirement: {
      id: 'BR-601',
      statement:
        'A payment on a cancelled contract is refused: "Không ghi nhận thanh toán cho hợp đồng đã hủy."',
    },
    steps: [['Pay on HD000010', '"Không ghi nhận thanh toán cho hợp đồng đã hủy."']],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-07',
    section: SM,
    priority: 'P1',
    technique: 'Decision table',
    title: 'Paid and debt count only approved, undeleted receipts',
    requirement: {
      id: 'BR-602',
      statement:
        'Paid amount, debt and payment status are computed only from valid receipts (approved, not deleted) plus the opening paid amount.',
    },
    steps: [
      ['Add a pending receipt', 'Debt unchanged'],
      ['Approve it', 'Debt falls by the amount'],
      ['Delete it', 'Debt back'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'MON-08',
    section: SM,
    priority: 'P1',
    technique: 'Use case',
    title: 'Paid and debt always equal the receipts',
    requirement: {
      id: 'AC-19',
      statement: "Each contract's paid amount and debt always equal the sum of its valid receipts.",
    },
    steps: [
      [
        'Two approved receipts 5.000.000 and 3.000.000 on a 12.000.000 contract',
        'Paid 8.000.000; debt 4.000.000',
      ],
    ],
    why: WHY.calc,
  }),
  manual({
    id: 'MON-09',
    section: SM,
    priority: 'P1',
    technique: 'Use case',
    title: 'The cash book balances',
    requirement: {
      id: 'AC-19',
      statement: 'Cash book closing balance equals opening balance plus receipts minus expenses.',
    },
    steps: [['Open Sổ quỹ for a day and method', 'Closing = opening + in − out']],
    why: WHY.calc,
  }),
  manual({
    id: 'MON-10',
    section: SM,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'Only Admin edits a receipt date, and it is logged',
    requirement: {
      id: 'BR-605',
      statement: "Editing a receipt's date is a separate permission (Admin) and is always logged.",
    },
    steps: [
      ['Manager opens a receipt', 'No date edit'],
      ['Admin edits the date', 'Saved; action history shows before and after'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'MON-11',
    section: SM,
    priority: 'P2',
    technique: 'Use case',
    title: 'Deleting a receipt asks for a reason and returns the amount to the debt',
    requirement: {
      id: 'BR-104',
      statement:
        'Deleting a receipt requires a reason, waits for an admin, moves it to the trash and puts the amount back into the debt.',
    },
    steps: [
      ['Delete a receipt with "Khác" and no note', 'Refused'],
      ['With a reason; admin approves', 'In the trash; debt restored'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-12',
    section: SM,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'A PT payout never pays a session twice',
    requirement: { id: 'AC-18', statement: 'PT payout vouchers never pay a session twice.' },
    steps: [
      ['Pay a period', 'One voucher'],
      ['Pay the same period again', '"Không còn gì để chi cho PT trong kỳ này…"'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'MON-13',
    section: SM,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'An expense voucher must be greater than zero',
    requirement: { id: 'BR-603', statement: 'Expense amounts are greater than zero.' },
    steps: [
      ['Expense of 0', '"Số tiền phải lớn hơn 0."'],
      ['1', 'Accepted'],
    ],
    why: WHY.mutate,
  }),
  auto({
    id: 'MON-14',
    section: SM,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'A receptionist has payments and debt but not income and expenses',
    requirement: {
      id: 'AC-01',
      statement:
        'A receptionist opens Finance and sees the tabs "Thanh toán" and "Công nợ" but not "Thu / Chi".',
    },
    steps: [['Open Finance as the receptionist', '"Thanh toán" and "Công nợ"; no "Thu / Chi"']],
    spec: [
      ...signIn('receptionist'),
      ...headingAt('/finance/payments', 'Tài chính'),
      {
        id: 'payments-tab',
        type: 'expectVisible',
        target: { by: 'text', text: 'Thanh toán', exact: true, within: main },
      },
      {
        id: 'debt-tab',
        type: 'expectVisible',
        target: { by: 'text', text: 'Công nợ', exact: true, within: main },
      },
      {
        id: 'no-income',
        type: 'expectHidden',
        target: { by: 'text', text: 'Thu / Chi', exact: true, within: main },
      },
    ],
  }),
  auto({
    id: 'MON-15',
    section: SM,
    priority: 'P3',
    technique: 'Permission matrix',
    title: 'A manager has income and expenses',
    requirement: { id: 'AC-01', statement: 'A Fitness Manager sees the Finance tab "Thu / Chi".' },
    steps: [['Open Finance as the manager', '"Thu / Chi" is there']],
    spec: [
      ...signIn('manager'),
      ...headingAt('/finance/payments', 'Tài chính'),
      {
        id: 'income',
        type: 'expectVisible',
        target: { by: 'text', text: 'Thu / Chi', exact: true, within: main },
      },
    ],
  }),
];

const approvals: SuiteCase[] = [
  manual({
    id: 'APR-01',
    section: SA,
    priority: 'P1',
    technique: 'Decision table',
    title: 'The submitter cannot approve their own request',
    requirement: {
      id: 'AC-05',
      statement:
        'Actions in approval groups have no effect until approved; the submitter cannot approve them: "Bạn không thể tự duyệt yêu cầu do chính mình gửi."',
    },
    steps: [
      ['Submit a receipt as the manager; approve it yourself', 'Refused'],
      ['Another approver approves', 'Takes effect'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'APR-02',
    section: SA,
    priority: 'P1',
    technique: 'State transition',
    title: 'A pending request has no effect',
    requirement: {
      id: 'BR-103',
      statement: 'Actions configured in the approval matrix take effect only after approval.',
    },
    steps: [['Submit; check the figures before approval', 'Unchanged']],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'APR-03',
    section: SA,
    priority: 'P2',
    technique: 'Decision table',
    title: 'A rejection needs a reason',
    requirement: { id: 'FR-PLT-007', statement: 'Rejection takes a reason.' },
    steps: [
      ['Reject without a reason', 'Refused'],
      ['With a reason', 'Rejected; reason shown to the submitter'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'APR-04',
    section: SA,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: "An approval pending over 24 hours goes to the approver's manager",
    requirement: {
      id: 'AC-28',
      statement: "A slow approval past 24 hours is told to the approver's direct manager.",
    },
    steps: [
      ['Pending 23 h 59', 'No escalation'],
      ['24 h', 'Direct manager told'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'APR-05',
    section: SA,
    priority: 'P2',
    technique: 'Use case',
    title: 'Admin switches approval on or off per action on screen',
    requirement: {
      id: 'AC-05',
      statement:
        'Admin switches approval on or off and changes approvers per action type on screen; the change takes effect immediately.',
    },
    steps: [['Turn off approval for receipts', 'The next receipt takes effect at once']],
    why: WHY.twoUsers,
  }),
  auto({
    id: 'APR-06',
    section: SA,
    priority: 'P3',
    technique: 'Use case',
    title: 'Every role can open its approvals page',
    requirement: {
      id: 'FR-PLT-007',
      statement: 'Deciding a request needs no permission of its own: a receptionist opens "Phê duyệt".',
    },
    steps: [['Open Phê duyệt as the receptionist', 'The page opens']],
    spec: [...signIn('receptionist'), ...headingAt('/approvals', 'Phê duyệt')],
  }),
  manual({
    id: 'TRS-01',
    section: SA,
    priority: 'P1',
    technique: 'Use case',
    title: 'Deleted data is in the trash with its reason and cannot be purged',
    requirement: {
      id: 'AC-13',
      statement:
        'Deleted data is in the trash with its reason, viewable only by management, and cannot be deleted.',
    },
    steps: [
      ['Delete a record with a reason', 'In the trash with who, when and why'],
      ['Look for purge or restore', 'None'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'TRS-02',
    section: SA,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'Codes are never reused after a deletion',
    requirement: { id: 'BR-105', statement: 'Codes are unique and never reused.' },
    steps: [['Delete the newest lead; add another', 'It gets the next code, not the deleted one']],
    why: WHY.mutate,
  }),
  manual({
    id: 'AUD-01',
    section: SA,
    priority: 'P1',
    technique: 'Use case',
    title: 'Every change is audited with before and after values',
    requirement: {
      id: 'BR-106',
      statement:
        'Every create, update, delete, approval and change of roles, permissions, thresholds or configuration is audited with before and after values.',
    },
    steps: [["Edit a lead's phone", 'Action history shows old and new phone, who and when']],
    why: WHY.twoUsers,
  }),
];

const config: SuiteCase[] = [
  manual({
    id: 'CFG-01',
    section: SG,
    priority: 'P1',
    technique: 'Use case',
    title: 'An option added on screen shows immediately; old data is unchanged',
    requirement: {
      id: 'AC-03',
      statement:
        'Admin adds or deactivates an option on screen, the change shows immediately, and old data is unchanged.',
    },
    steps: [
      ['Add a channel option', 'Available in the lead form at once'],
      ['Deactivate it', 'Not offered; old leads keep it'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'CFG-02',
    section: SG,
    priority: 'P2',
    technique: 'Error guessing',
    title: '"Khác" cannot be deactivated',
    requirement: {
      id: 'BR-102',
      statement:
        '"Khác" is always available: deactivating it shows "Lựa chọn "Khác" luôn được dùng, không thể ngừng."',
    },
    steps: [['Deactivate "Khác"', 'Refused']],
    why: WHY.mutate,
  }),
  manual({
    id: 'CFG-03',
    section: SG,
    priority: 'P2',
    technique: 'Use case',
    title: 'Parameters change behaviour without a developer',
    requirement: {
      id: 'AC-02',
      statement:
        'Admin changes permissions, approval thresholds, price tiers, timers and session status rules on screen; changes take effect immediately.',
    },
    steps: [['Change the re-care days from 15 to 10', 'The next refused lead gets +10 days']],
    why: WHY.date,
  }),
  manual({
    id: 'CFG-04',
    section: SG,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: "A role's discount threshold is 0 to 100",
    requirement: {
      id: 'FR-PLT-002',
      statement: "A role's discount threshold is kept between 0 and 100; over 100 is refused.",
    },
    steps: [
      ['Set 100', 'Kept'],
      ['Set 101', 'Refused'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CFG-05',
    section: SG,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'Overlapping price tiers are refused',
    requirement: { id: 'FR-SVC-002', statement: 'Price tiers of a service may not overlap.' },
    steps: [
      ['Tiers 1–12 and 10–24', 'Refused'],
      ['1–12 and 13–24', 'Saved'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'CFG-06',
    section: SG,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A service name in use is refused in any case',
    requirement: {
      id: 'FR-SVC-001',
      statement: 'A service name already in use, in any letter case, is refused: "Tên này đã được dùng."',
    },
    steps: [['Add service "pt"', '"Tên này đã được dùng."']],
    why: WHY.mutate,
  }),
  manual({
    id: 'CFG-07',
    section: SG,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A voucher code in use is refused',
    requirement: { id: 'FR-SVC-004', statement: 'A voucher code already in use is refused.' },
    steps: [['Add a voucher with an existing code', 'Refused']],
    why: WHY.mutate,
  }),
  manual({
    id: 'CFG-08',
    section: SG,
    priority: 'P3',
    technique: 'Use case',
    title: "A price version from tomorrow does not change today's price",
    requirement: {
      id: 'FR-SVC-002',
      statement:
        "Price tiers have versions with effective dates; a version from tomorrow does not change today's price.",
    },
    steps: [['Save a new tier version effective tomorrow', "Today's contract form shows the old price"]],
    why: WHY.date,
  }),
  manual({
    id: 'CFG-09',
    section: SG,
    priority: 'P2',
    technique: 'Permission matrix',
    title: 'Only Admin changes session status rules',
    requirement: { id: 'AC-02', statement: 'Only Admin changes session status rules and colors.' },
    steps: [
      ['Open Trạng thái buổi tập as the manager', 'Refused or read-only'],
      ['As Admin', 'Editable'],
    ],
    why: WHY.twoUsers,
  }),
];

const tasks: SuiteCase[] = [
  manual({
    id: 'TSK-01',
    section: ST,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A task title is 1 to 200 characters',
    requirement: {
      id: 'FR-TASK-001',
      statement:
        'A task title is required and at most 200 characters: empty is "Bắt buộc nhập.", 201 is "Quá dài."',
    },
    steps: [
      ['Empty title', '"Bắt buộc nhập."'],
      ['200 characters', 'Saved'],
      ['201', '"Quá dài."'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'TSK-02',
    section: ST,
    priority: 'P2',
    technique: 'State transition',
    title: 'A task moves New → Accepted → In progress → Done',
    requirement: {
      id: 'FR-TASK-002',
      statement: 'Task statuses New, Accepted, In progress, Done, Cancelled; the assignee accepts.',
    },
    steps: [
      ['Assignee accepts, starts, finishes', 'Each status recorded'],
      ['Assigner cancels a New task', 'Cancelled'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'TSK-03',
    section: ST,
    priority: 'P2',
    technique: 'Use case',
    title: 'Overdue tasks are highlighted and reported to the assigner',
    requirement: { id: 'BR-702', statement: 'Overdue tasks are highlighted and reported to the assigner.' },
    steps: [['Let a task pass its deadline', 'Highlighted; assigner told']],
    why: WHY.time,
  }),
  manual({
    id: 'TSK-04',
    section: ST,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'Reminders at 24, 3 and 1 hours before the deadline',
    requirement: {
      id: 'AC-28',
      statement:
        'A task is reminded at all three points before its deadline through the bell, email and phone.',
    },
    steps: [['Task due in 25 h', 'Reminded at 24 h, 3 h and 1 h before']],
    why: WHY.time,
  }),
  auto({
    id: 'TSK-05',
    section: ST,
    priority: 'P3',
    technique: 'Permission matrix',
    title: 'Every role has its tasks page',
    requirement: { id: 'FR-TASK-005', statement: 'Tasks are for every role: a PT opens "Công việc".' },
    steps: [['Open Công việc as the trainer', 'The page opens']],
    spec: [...signIn('trainer'), ...headingAt('/tasks', 'Công việc')],
  }),
  manual({
    id: 'MAIL-01',
    section: ST,
    priority: 'P1',
    technique: 'Use case',
    title: 'Each credited or refunded session sends exactly one email',
    requirement: {
      id: 'AC-17',
      statement:
        'Every credited or refunded session sends exactly one email to the customer, from the template and in the right language, with its status stored in the profile.',
    },
    steps: [
      ['Complete a session', 'One email, status on "Email đã gửi"'],
      ['Refund it', 'One more email'],
    ],
    why: WHY.external,
  }),
  manual({
    id: 'MAIL-02',
    section: ST,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'The email language follows the nationality',
    requirement: {
      id: 'BR-701',
      statement: "Emails go in the language of the customer's nationality group (Vietnamese or foreign).",
    },
    steps: [
      ['Vietnamese customer', 'Vietnamese email'],
      ['Foreign customer', 'English email'],
    ],
    why: WHY.external,
  }),
  manual({
    id: 'MAIL-03',
    section: ST,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A failed email creates a reception task',
    requirement: { id: 'FR-MAIL-003', statement: 'Email failures create a reception task.' },
    steps: [['Make an email fail', 'Status failed with the reason; reception task']],
    why: WHY.external,
  }),
  auto({
    id: 'NTF-01',
    section: ST,
    priority: 'P3',
    technique: 'Use case',
    title: 'Users read their notifications',
    requirement: {
      id: 'FR-PLT-009',
      statement: 'Users receive in-app notifications on the page "Thông báo".',
    },
    steps: [['Open Thông báo as the manager', 'The page opens']],
    spec: [...signIn('manager'), ...headingAt('/notifications', 'Thông báo')],
  }),
];

const workouts: SuiteCase[] = [
  manual({
    id: 'WKO-01',
    section: SW,
    priority: 'P1',
    technique: 'Use case',
    title: 'Plans and session logs show plan and actual on one row',
    requirement: {
      id: 'AC-20',
      statement:
        "A customer's plans and every session log are visible in their profile, with plan and actual on the same row.",
    },
    steps: [["Open a customer's Giáo án tab", 'Plans and logs; plan and actual side by side']],
    why: WHY.setup,
  }),
  manual({
    id: 'WKO-02',
    section: SW,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A Cardio exercise shows time, speed and heart rate',
    requirement: {
      id: 'BR-502',
      statement: 'Cardio rows show time, speed and heart rate instead of weights.',
    },
    steps: [
      ['Add a Cardio exercise', 'Time, speed, HR columns'],
      ['Strength exercise', 'Weight and reps'],
    ],
    why: WHY.setup,
  }),
  manual({
    id: 'WKO-03',
    section: SW,
    priority: 'P1',
    technique: 'State transition',
    title: '"Stop + Escalation" waits until a manager or Master handles it',
    requirement: {
      id: 'AC-21',
      statement:
        'Choosing Action "Stop + Escalation" notifies the manager and Master, and the item stays in the waiting list until handled.',
    },
    steps: [
      ['Coach escalates a set', 'Manager and Master told; task open'],
      ['Master marks it reviewed with a note', 'Removed from the waiting list'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'WKO-04',
    section: SW,
    priority: 'P2',
    technique: 'State transition',
    title: 'A plan needs Master approval',
    requirement: {
      id: 'BR-504',
      statement: 'Creating and editing plans and templates needs Master approval.',
    },
    steps: [
      ['PT sends a plan', 'Pending'],
      ['Master approves', 'In use; edits need a new version'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'WKO-05',
    section: SW,
    priority: 'P2',
    technique: 'Use case',
    title: 'The weekly workout dashboard gives the right Flag and Action percentages',
    requirement: {
      id: 'AC-21',
      statement: 'The weekly workout dashboard gives the right Flag and Action percentages.',
    },
    steps: [['Fixed dataset of sets with flags', 'Percentages match a hand count']],
    why: WHY.calc,
  }),
  manual({
    id: 'WKO-06',
    section: SW,
    priority: 'P2',
    technique: 'Use case',
    title: 'The session log works on a phone',
    requirement: { id: 'AC-23', statement: 'The lead, PT calendar and session log screens work on a phone.' },
    steps: [['Open the log at phone width', 'Usable without sideways scrolling']],
    why: WHY.judge,
  }),
];

const reports: SuiteCase[] = [
  manual({
    id: 'RPT-01',
    section: SR,
    priority: 'P1',
    technique: 'Use case',
    title: 'The consulting dashboard matches the September and October files',
    requirement: {
      id: 'AC-08',
      statement:
        'The consulting dashboard gives the right lead counts, booking rate and show rate per consultant compared with the Excel files of September and October 2026.',
    },
    steps: [['Compare the dashboard with the files', 'Same counts and rates']],
    why: WHY.setup,
  }),
  manual({
    id: 'RPT-02',
    section: SR,
    priority: 'P1',
    technique: 'Use case',
    title: 'PT revenue allocation matches GymMaster',
    requirement: {
      id: 'AC-18',
      statement: "The PT revenue allocation report matches GymMaster's export on the same data.",
    },
    steps: [['Same period in both systems', 'Same totals per PT']],
    why: WHY.setup,
  }),
  manual({
    id: 'RPT-03',
    section: SR,
    priority: 'P2',
    technique: 'Use case',
    title: 'Lists export to Excel with the visible columns',
    requirement: { id: 'FR-RPT-001', statement: 'Reports and lists export to Excel, filtered as on screen.' },
    steps: [['Export the contract list with a filter', 'The file has the same rows']],
    why: WHY.external,
  }),
  manual({
    id: 'RPT-04',
    section: SR,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A list too long to export asks for a filter',
    requirement: {
      id: 'FR-RPT-001',
      statement: 'An export that is too long shows "Danh sách quá dài để xuất. Hãy lọc bớt trước."',
    },
    steps: [['Export a very large list', 'The message; no file']],
    why: WHY.setup,
  }),
  manual({
    id: 'RPT-05',
    section: SR,
    priority: 'P2',
    technique: 'Use case',
    title: 'GymMaster import reconciles',
    requirement: {
      id: 'AC-22',
      statement:
        'Data imported from GymMaster matches the number of customers, contract value, paid amounts and sessions left.',
    },
    steps: [['Import the files; open the reconciliation', 'All metrics match']],
    why: WHY.setup,
  }),
];

const security: SuiteCase[] = [
  auto({
    id: 'SEC-01',
    section: SX,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A record id that does not exist shows "Không tìm thấy"',
    requirement: {
      id: 'FR-CON-005',
      statement:
        'Opening /contracts/ with an id that does not exist shows "Không tìm thấy", not an error page.',
    },
    steps: [['Open /contracts/00000000-0000-4000-8000-000000000000', '"Không tìm thấy"']],
    spec: [
      ...signIn('manager'),
      { id: 'open', type: 'navigate', path: '/contracts/00000000-0000-4000-8000-000000000000' },
      // The not-found page nests two main landmarks (logged in findings.json), so `main` is ambiguous
      // there; the heading is the one element that names the state.
      {
        id: 'not-found',
        type: 'expectVisible',
        target: { by: 'role', role: 'heading', name: 'Không tìm thấy', exact: true },
      },
    ],
  }),
  auto({
    id: 'SEC-02',
    section: SX,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'The API refuses a request without a session',
    requirement: {
      id: 'AC-01',
      statement: 'Calling GET /api/v1/customers without signing in is refused with HTTP 401.',
    },
    steps: [['GET /api/v1/customers signed out', '401']],
    spec: [
      { id: 'customers', type: 'apiRequest', method: 'GET', path: '/api/v1/customers', expectStatus: 401 },
    ],
  }),
  auto({
    id: 'SEC-03',
    section: SX,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'The API refuses an admin endpoint to a receptionist',
    requirement: {
      id: 'AC-01',
      statement: 'A signed-in receptionist calling GET /api/v1/users (Admin only) is refused with HTTP 403.',
    },
    steps: [['Sign in as the receptionist; GET /api/v1/users', '403']],
    spec: [
      ...signIn('receptionist'),
      { id: 'users', type: 'apiRequest', method: 'GET', path: '/api/v1/users', expectStatus: 403 },
    ],
  }),
  auto({
    id: 'SEC-04',
    section: SX,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'The API refuses lead data to a trainer',
    requirement: {
      id: 'AC-01',
      statement: 'A signed-in PT calling GET /api/v1/leads (no lead permission) is refused with HTTP 403.',
    },
    steps: [['Sign in as the trainer; GET /api/v1/leads', '403']],
    spec: [
      ...signIn('trainer'),
      { id: 'leads', type: 'apiRequest', method: 'GET', path: '/api/v1/leads', expectStatus: 403 },
    ],
  }),
  manual({
    id: 'SEC-05',
    section: SX,
    priority: 'P1',
    technique: 'Error guessing',
    title: 'The OWASP security suite passes for every endpoint',
    requirement: {
      id: '24_SECURITY_TESTING',
      statement: 'Every endpoint passes the OWASP Top 10 checks in docs/24.',
    },
    steps: [['Run the security suite', 'All checks pass']],
    why: WHY.judge,
  }),
];

export const OPERATIONS: Module = {
  id: 'OPS',
  name: 'Money, approvals, configuration, tasks, workouts, reports and security',
  designs: [
    {
      technique: 'Boundary value analysis',
      title: 'Receipt amount on a contract owing 12.000.000 ₫ (BR-603, BR-604)',
      columns: ['Amount', 'Expected', 'Case'],
      rows: [
        ['0', 'Số tiền phải lớn hơn 0.', 'MON-01'],
        ['1', 'Accepted', 'MON-02'],
        ['12.000.000 (= debt)', 'Accepted', 'MON-03'],
        ['12.000.001 (debt + 1)', 'Vượt giá trị hợp đồng', 'MON-04'],
      ],
    },
    {
      technique: 'Decision table',
      title: 'Does a receipt count toward paid and debt? (BR-602)',
      columns: ['Approved', 'Deleted', 'Counts', 'Case'],
      rows: [
        ['No (pending)', 'No', 'No', 'MON-07'],
        ['Yes', 'No', 'Yes', 'MON-07'],
        ['Yes', 'Yes', 'No', 'MON-07, MON-11'],
      ],
    },
    {
      technique: 'Decision table',
      title: 'Approval of a submitted action (BR-103)',
      columns: ['Action in the matrix', 'Approver is the submitter', 'Expected', 'Case'],
      rows: [
        ['Yes', 'Yes', 'Refused', 'APR-01'],
        ['Yes', 'No', 'Takes effect on approval', 'APR-01, APR-02'],
        ['No (switched off)', '—', 'Takes effect at once', 'APR-05'],
      ],
    },
    {
      technique: 'State transition',
      title: 'Task',
      columns: ['From', 'Event', 'To', 'Case'],
      rows: [
        ['New', 'Assignee accepts', 'Accepted', 'TSK-02'],
        ['Accepted', 'Starts', 'In progress', 'TSK-02'],
        ['In progress', 'Finishes', 'Done', 'TSK-02'],
        ['New', 'Assigner cancels', 'Cancelled', 'TSK-02'],
        ['Any open', 'Deadline passes', 'Overdue (highlighted)', 'TSK-03'],
      ],
    },
    {
      technique: 'Boundary value analysis',
      title: 'Other limits',
      columns: ['Field', 'Values', 'Case'],
      rows: [
        ['Task title (1–200)', '0 / 200 / 201', 'TSK-01'],
        ['Discount threshold (0–100)', '100 / 101', 'CFG-04'],
        ['Approval escalation (24 h)', '23 h 59 / 24 h', 'APR-04'],
        ['Task reminders', '24 h / 3 h / 1 h', 'TSK-04'],
      ],
    },
    {
      technique: 'Error guessing',
      title: 'Attacks and mistakes tried',
      columns: ['Guess', 'Expected', 'Case'],
      rows: [
        ['Unknown record id in the URL', 'Không tìm thấy', 'SEC-01'],
        ['API call without a session', '401', 'SEC-02'],
        ['Admin API as receptionist', '403', 'SEC-03'],
        ['Lead API as trainer', '403', 'SEC-04'],
        ['SQL-like search text', 'Treated as text', 'LEAD-26'],
        ['Markup in a name', 'Shown as text', 'LEAD-27'],
        ['Double submit', 'One record', 'LEAD-29'],
        ['Unknown email at sign-in', 'Generic message', 'AUTH-03'],
      ],
    },
  ],
  cases: [...money, ...approvals, ...config, ...tasks, ...workouts, ...reports, ...security],
};
