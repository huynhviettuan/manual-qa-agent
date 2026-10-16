import {
  auto,
  duplicateDialog,
  inDialog,
  leadDialog,
  leadForm,
  main,
  manual,
  notInDialog,
  saveLead,
  signIn,
  WHY,
  type Module,
  type SuiteCase,
} from './helpers.ts';

const S = 'Leads and consulting';
const REQUIRED = 'Bắt buộc nhập.';
const TOO_LONG = 'Quá dài.';
const BAD_PHONE = 'Số điện thoại không hợp lệ.';
const NAME_150 = 'Q'.repeat(150);
const NAME_151 = 'Q'.repeat(151);

/**
 * Valid phone boundaries are checked without saving: the form is submitted without a channel, so the
 * channel's "Bắt buộc nhập." appears and the phone error must not. Reruns never collide on phone
 * numbers. Names need not be unique, so valid name boundaries are saved and opened instead.
 */
const acceptedWithoutSaving = (value: string, rejected: string) => [
  ...signIn('manager'),
  ...leadForm({ name: 'QA boundary', phone: value }),
  saveLead,
  inDialog('channel-required', REQUIRED),
  notInDialog('value-accepted', rejected),
];
const refusedOnSave = (o: { name?: string; phone?: string; channel?: string }, message: string) => [
  ...signIn('manager'),
  ...leadForm(o),
  saveLead,
  inDialog('refused', message),
  { id: 'still-open', type: 'expectVisible', target: leadDialog },
];
const savedAs = (name: string, channel: string, extra: Record<string, unknown>[] = []) => [
  ...signIn('manager'),
  ...leadForm({ name, channel }),
  ...extra,
  saveLead,
  { id: 'on-lead-page', type: 'expectUrl', path: '/leads/', match: 'prefix' },
  {
    id: 'lead-heading',
    type: 'expectVisible',
    target: { by: 'role', role: 'heading', name, exact: true, within: main },
  },
];

const cases: SuiteCase[] = [
  // Quick form: name
  auto({
    id: 'LEAD-01',
    section: S,
    priority: 'P1',
    technique: 'Use case',
    title: 'A lead is saved with only a name and a channel',
    requirement: {
      id: 'AC-25',
      statement:
        'A lead needs only a name and a channel: name "QA LEAD-01" and channel "Zalo" save and open the new lead.',
    },
    pre: ['Signed in as the manager'],
    steps: [
      ['Leads > "Thêm lead": name and channel Zalo only; save', 'The new lead page opens with its name'],
    ],
    spec: savedAs('QA LEAD-01', 'Zalo'),
  }),
  auto({
    id: 'LEAD-02',
    section: S,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'An empty name is refused',
    requirement: {
      id: 'AC-25',
      statement: 'Saving a lead with a channel but no name shows "Bắt buộc nhập." and saves nothing.',
    },
    steps: [['Choose channel Zalo, leave the name empty; save', '"Bắt buộc nhập."; the dialog stays open']],
    spec: refusedOnSave({ channel: 'Zalo' }, REQUIRED),
  }),
  auto({
    id: 'LEAD-03',
    section: S,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A name of spaces only is refused',
    requirement: { id: 'AC-25', statement: 'A lead name of spaces only counts as empty: "Bắt buộc nhập."' },
    steps: [['Name "   ", channel Zalo; save', '"Bắt buộc nhập."']],
    spec: refusedOnSave({ name: '   ', channel: 'Zalo' }, REQUIRED),
  }),
  auto({
    id: 'LEAD-04',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A one-character name is accepted (minimum)',
    requirement: {
      id: 'AC-25',
      statement: 'A lead name of 1 character is accepted (the name is 1 to 150 characters).',
    },
    steps: [['Name "Q", channel Zalo; save', 'The lead "Q" is saved and opens']],
    spec: savedAs('Q', 'Zalo'),
  }),
  auto({
    id: 'LEAD-05',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A 150-character name is accepted (maximum)',
    requirement: { id: 'AC-25', statement: 'A lead name of 150 characters is accepted; 151 is "Quá dài."' },
    steps: [['Name of 150 characters, channel Zalo; save', 'Saved; no "Quá dài."']],
    spec: savedAs(NAME_150, 'Zalo'),
  }),
  auto({
    id: 'LEAD-06',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A 151-character name is too long (maximum + 1)',
    requirement: { id: 'AC-25', statement: 'A lead name of 151 characters is refused with "Quá dài."' },
    steps: [['Name of 151 characters, channel Zalo; save', '"Quá dài."; nothing saved']],
    spec: refusedOnSave({ name: NAME_151, channel: 'Zalo' }, TOO_LONG),
  }),
  auto({
    id: 'LEAD-07',
    section: S,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'A lead without a channel is refused',
    requirement: {
      id: 'AC-25',
      statement:
        'A lead needs a channel: saving with a name but no channel shows "Bắt buộc nhập." under the channel.',
    },
    steps: [['Name only; save', '"Bắt buộc nhập." under Kênh liên hệ']],
    spec: refusedOnSave({ name: 'QA LEAD-07' }, REQUIRED),
  }),
  // Quick form: phone (optional; 8 to 15 digits, an optional leading +)
  auto({
    id: 'LEAD-08',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A 7-digit phone is refused (minimum − 1)',
    requirement: {
      id: 'BR-202',
      statement: 'A lead phone has 8 to 15 digits: 7 digits show "Số điện thoại không hợp lệ."',
    },
    steps: [['Phone 0912345, channel Zalo; save', '"Số điện thoại không hợp lệ."']],
    spec: refusedOnSave({ name: 'QA LEAD-08', phone: '0912345', channel: 'Zalo' }, BAD_PHONE),
  }),
  auto({
    id: 'LEAD-09',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'An 8-digit phone is accepted (minimum)',
    requirement: { id: 'BR-202', statement: 'A lead phone of 8 digits is accepted.' },
    steps: [['Phone 09123456; save without a channel', 'No phone error']],
    spec: acceptedWithoutSaving('09123456', BAD_PHONE),
  }),
  auto({
    id: 'LEAD-10',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A 15-digit phone is accepted (maximum)',
    requirement: { id: 'BR-202', statement: 'A lead phone of 15 digits is accepted.' },
    steps: [['Phone 091234567890123; save without a channel', 'No phone error']],
    spec: acceptedWithoutSaving('091234567890123', BAD_PHONE),
  }),
  auto({
    id: 'LEAD-11',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'A 16-digit phone is refused (maximum + 1)',
    requirement: { id: 'BR-202', statement: 'A lead phone of 16 digits shows "Số điện thoại không hợp lệ."' },
    steps: [['Phone 0912345678901234; save', '"Số điện thoại không hợp lệ."']],
    spec: refusedOnSave({ name: 'QA LEAD-11', phone: '0912345678901234', channel: 'Zalo' }, BAD_PHONE),
  }),
  auto({
    id: 'LEAD-12',
    section: S,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'A phone with letters is refused',
    requirement: {
      id: 'BR-202',
      statement: 'A lead phone containing letters shows "Số điện thoại không hợp lệ."',
    },
    steps: [['Phone 09abc45678; save', '"Số điện thoại không hợp lệ."']],
    spec: refusedOnSave({ name: 'QA LEAD-12', phone: '09abc45678', channel: 'Zalo' }, BAD_PHONE),
  }),
  auto({
    id: 'LEAD-13',
    section: S,
    priority: 'P3',
    technique: 'Equivalence partitioning',
    title: 'A phone typed with spaces is accepted',
    requirement: {
      id: 'BR-202',
      statement: 'A lead phone typed with spaces, e.g. "0912 345 678", is normalized and accepted.',
    },
    steps: [['Phone "0912 345 678"; save without a channel', 'No phone error']],
    spec: acceptedWithoutSaving('0912 345 678', BAD_PHONE),
  }),
  auto({
    id: 'LEAD-14',
    section: S,
    priority: 'P3',
    technique: 'Equivalence partitioning',
    title: 'An international phone with + is accepted',
    requirement: {
      id: 'BR-202',
      statement: 'A lead phone in international form "+84912345678" is accepted.',
    },
    steps: [['Phone +84912345678; save without a channel', 'No phone error']],
    spec: acceptedWithoutSaving('+84912345678', BAD_PHONE),
  }),
  // "Khác" decision table
  auto({
    id: 'LEAD-15',
    section: S,
    priority: 'P1',
    technique: 'Decision table',
    title: '"Khác" without a note cannot be saved',
    requirement: {
      id: 'AC-04',
      statement: 'Choosing "Khác" in any drop-down cannot be saved without a note.',
    },
    steps: [['Channel "Khác", note empty; save', '"Đã chọn "Khác" thì phải ghi rõ."; nothing saved']],
    spec: refusedOnSave({ name: 'QA LEAD-15', channel: 'Khác' }, 'Đã chọn "Khác" thì phải ghi rõ'),
  }),
  auto({
    id: 'LEAD-16',
    section: S,
    priority: 'P1',
    technique: 'Decision table',
    title: '"Khác" with a note is saved',
    requirement: { id: 'AC-04', statement: 'Choosing "Khác" with a note in "Ghi rõ" saves the lead.' },
    steps: [['Channel "Khác", note "Fanpage cũ"; save', 'The new lead opens']],
    spec: savedAs('QA LEAD-16', 'Khác', [
      {
        id: 'note',
        type: 'fill',
        target: { by: 'label', label: 'Ghi rõ', within: leadDialog },
        value: 'Fanpage cũ',
      },
    ]),
  }),
  auto({
    id: 'LEAD-17',
    section: S,
    priority: 'P3',
    technique: 'Decision table',
    title: 'Another channel needs no note',
    requirement: {
      id: 'AC-04',
      statement: 'A channel other than "Khác" shows no "Ghi rõ" field and saves without a note.',
    },
    steps: [
      ['Channel Zalo; look for "Ghi rõ"', 'No "Ghi rõ" field'],
      ['Save', 'Saved'],
    ],
    spec: [
      ...signIn('manager'),
      ...leadForm({ name: 'QA LEAD-17', channel: 'Zalo' }),
      {
        id: 'no-note-field',
        type: 'expectHidden',
        target: { by: 'label', label: 'Ghi rõ', within: leadDialog },
      },
      saveLead,
      { id: 'on-lead-page', type: 'expectUrl', path: '/leads/', match: 'prefix' },
    ],
  }),
  // Duplicates (BR-202)
  auto({
    id: 'LEAD-18',
    section: S,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'A phone of an existing customer offers a merge',
    requirement: {
      id: 'BR-202',
      statement:
        'A new lead with a customer\'s phone (0909123456, KH000001 Nguyễn Văn An) opens "Số điện thoại đã có hồ sơ" naming that record and offering "Gộp vào hồ sơ này".',
    },
    pre: ['Customer KH000001 Nguyễn Văn An, phone 0909123456'],
    steps: [
      [
        'Add a lead with phone 0909123456; save',
        'The duplicate dialog names KH000001 · Nguyễn Văn An and offers the merge',
      ],
    ],
    spec: [
      ...signIn('manager'),
      ...leadForm({ name: 'QA LEAD-18', phone: '0909123456', channel: 'Zalo' }),
      saveLead,
      { id: 'names-record', type: 'expectText', target: duplicateDialog, text: 'KH000001 · Nguyễn Văn An' },
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
  }),
  auto({
    id: 'LEAD-19',
    section: S,
    priority: 'P1',
    technique: 'Equivalence partitioning',
    title: 'A phone of an existing lead offers a merge',
    requirement: {
      id: 'BR-202',
      statement:
        'A new lead with another lead\'s phone (0901234508, Tạ Thu Uyên) opens "Số điện thoại đã có hồ sơ" naming that lead.',
    },
    pre: ['Lead Tạ Thu Uyên, phone 0901234508'],
    steps: [['Add a lead with phone 0901234508; save', 'The duplicate dialog names Tạ Thu Uyên']],
    spec: [
      ...signIn('manager'),
      ...leadForm({ name: 'QA LEAD-19', phone: '0901234508', channel: 'Zalo' }),
      saveLead,
      { id: 'names-record', type: 'expectText', target: duplicateDialog, text: 'Tạ Thu Uyên' },
    ],
  }),
  auto({
    id: 'LEAD-20',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: '"Quay lại sửa" returns to the form with the values kept',
    requirement: {
      id: 'BR-202',
      statement:
        'In the duplicate dialog, "Quay lại sửa" closes it and keeps the lead form open for editing.',
    },
    steps: [
      ['Trigger the duplicate dialog; choose "Quay lại sửa"', 'The dialog closes; "Thêm lead" is still open'],
    ],
    spec: [
      ...signIn('manager'),
      ...leadForm({ name: 'QA LEAD-20', phone: '0909123456', channel: 'Zalo' }),
      saveLead,
      {
        id: 'back',
        type: 'click',
        target: { by: 'role', role: 'button', name: 'Quay lại sửa', exact: true, within: duplicateDialog },
      },
      {
        id: 'form-kept',
        type: 'expectVisible',
        target: { by: 'label', label: 'Họ và tên', within: leadDialog },
      },
    ],
  }),
  manual({
    id: 'LEAD-21',
    section: S,
    priority: 'P1',
    technique: 'Use case',
    title: '"Gộp vào hồ sơ này" adds the inquiry to the existing record and creates none',
    requirement: {
      id: 'BR-202',
      statement:
        'Merging adds the new inquiry (channel, source, need, note) to the existing record and leaves one record.',
    },
    steps: [
      ['Trigger the duplicate dialog; choose the merge', "The existing record's timeline shows the inquiry"],
      ['Count records with that phone', 'Still one'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'LEAD-22',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: 'A manager merges two existing records of one person',
    requirement: {
      id: 'FR-LEAD-009',
      statement: 'A manager merges two records of one person; one record remains with both histories.',
    },
    steps: [
      ['Merge two leads of the same person', 'One record with both histories'],
      ['Try merging two customers', '"Chưa thể gộp hai hồ sơ khách hàng."'],
    ],
    why: WHY.mutate,
  }),
  // Search
  auto({
    id: 'LEAD-23',
    section: S,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'Search by phone finds only the matching lead',
    requirement: {
      id: 'FR-LEAD-006',
      statement: 'Searching leads for 0901234508 lists "Tạ Thu Uyên" and not "Kiều Quốc Việt".',
    },
    steps: [['Search 0901234508', 'Only Tạ Thu Uyên']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/leads?q=0901234508' },
      {
        id: 'match',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'Xem lead Tạ Thu Uyên', within: main },
      },
      {
        id: 'no-other',
        type: 'expectHidden',
        target: { by: 'role', role: 'link', name: 'Xem lead Kiều Quốc Việt', within: main },
      },
    ],
  }),
  auto({
    id: 'LEAD-24',
    section: S,
    priority: 'P2',
    technique: 'Equivalence partitioning',
    title: 'Search by name finds the lead',
    requirement: { id: 'FR-LEAD-006', statement: 'Searching leads for "Kiều Quốc Việt" lists that lead.' },
    steps: [['Search "Kiều Quốc Việt"', 'Kiều Quốc Việt is listed']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/leads?q=Ki%E1%BB%81u%20Qu%E1%BB%91c%20Vi%E1%BB%87t' },
      {
        id: 'match',
        type: 'expectVisible',
        target: { by: 'role', role: 'link', name: 'Xem lead Kiều Quốc Việt', within: main },
      },
    ],
  }),
  auto({
    id: 'LEAD-25',
    section: S,
    priority: 'P3',
    technique: 'Equivalence partitioning',
    title: 'A search with no match says so',
    requirement: { id: 'FR-LEAD-006', statement: 'A lead search with no match shows "Không tìm thấy lead".' },
    steps: [['Search "zz-no-such-lead"', '"Không tìm thấy lead"']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/leads?q=zz-no-such-lead' },
      { id: 'none', type: 'expectText', target: main, text: 'Không tìm thấy lead' },
    ],
  }),
  auto({
    id: 'LEAD-26',
    section: S,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A search that looks like SQL is treated as text',
    requirement: {
      id: 'FR-LEAD-006',
      statement: 'Searching for "\' OR 1=1 --" is treated as plain text and shows "Không tìm thấy lead".',
    },
    steps: [['Search "\' OR 1=1 --"', '"Không tìm thấy lead"; no error page']],
    spec: [
      ...signIn('manager'),
      { id: 'search', type: 'navigate', path: '/leads?q=%27%20OR%201%3D1%20--' },
      { id: 'none', type: 'expectText', target: main, text: 'Không tìm thấy lead' },
    ],
  }),
  auto({
    id: 'LEAD-27',
    section: S,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'A name with HTML is shown as text',
    requirement: {
      id: 'FR-LEAD-002',
      statement: 'A lead named "<b>QA LEAD-27</b>" is shown with the literal text, not as markup.',
    },
    steps: [['Save a lead named "<b>QA LEAD-27</b>"', 'The heading shows the angle brackets as typed']],
    spec: savedAs('<b>QA LEAD-27</b>', 'Zalo'),
  }),
  manual({
    id: 'LEAD-28',
    section: S,
    priority: 'P3',
    technique: 'Error guessing',
    title: 'A name with control characters is refused',
    requirement: {
      id: 'FR-LEAD-002',
      statement: 'A lead name with control characters shows "Có ký tự không hợp lệ."',
    },
    steps: [['Paste a name containing a control character; save', '"Có ký tự không hợp lệ."']],
    why: WHY.judge,
  }),
  manual({
    id: 'LEAD-29',
    section: S,
    priority: 'P2',
    technique: 'Error guessing',
    title: 'Double-clicking Save creates one lead',
    requirement: {
      id: 'FR-LEAD-001',
      statement: 'Submitting the quick form twice quickly creates one lead.',
    },
    steps: [['Double-click "Lưu"', 'One new lead']],
    why: WHY.concurrency,
  }),
  // Views
  auto({
    id: 'LEAD-30',
    section: S,
    priority: 'P3',
    technique: 'Use case',
    title: 'The Kanban board has a column per status',
    requirement: {
      id: 'FR-LEAD-006',
      statement: 'The lead Kanban board shows the columns "Mới", "Đang tư vấn" and "Từ chối".',
    },
    steps: [['Leads > Kanban', 'Columns Mới, Đang tư vấn, Từ chối, …']],
    spec: [
      ...signIn('manager'),
      { id: 'board', type: 'navigate', path: '/leads?view=board' },
      {
        id: 'col-new',
        type: 'expectVisible',
        target: { by: 'role', role: 'region', name: 'Cột Mới', exact: true, within: main },
      },
      {
        id: 'col-consulting',
        type: 'expectVisible',
        target: { by: 'role', role: 'region', name: 'Cột Đang tư vấn', exact: true, within: main },
      },
      {
        id: 'col-refused',
        type: 'expectVisible',
        target: { by: 'role', role: 'region', name: 'Cột Từ chối', exact: true, within: main },
      },
    ],
  }),
  auto({
    id: 'LEAD-31',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: 'A new lead is assigned to a consultant',
    requirement: {
      id: 'BR-203',
      statement:
        'A new lead is assigned to an active consultant of the branch ("Người phụ trách" is set, not "Chưa phân công").',
    },
    steps: [['Save a new lead', 'Its page shows a consultant in charge']],
    spec: [
      ...savedAs('QA LEAD-31', 'Zalo'),
      {
        id: 'not-unassigned',
        type: 'expectHidden',
        target: { by: 'text', text: 'Chưa phân công', within: main },
      },
    ],
  }),
  manual({
    id: 'LEAD-32',
    section: S,
    priority: 'P1',
    technique: 'Use case',
    title: 'Leads are shared by turn weight among receiving consultants',
    requirement: { id: 'AC-26', statement: 'Leads are shared by turn weight; each move is in the history.' },
    pre: ['A branch with two receiving consultants, weights 2 and 1'],
    steps: [['Add three leads', 'Shared 2:1 in turn order; history shows each assignment']],
    why: WHY.setup,
  }),
  manual({
    id: 'LEAD-33',
    section: S,
    priority: 'P1',
    technique: 'Boundary value analysis',
    title: 'An untouched lead moves on after 1 working hour, never outside 08:30–20:30',
    requirement: {
      id: 'AC-26',
      statement: 'A lead not taken care of after 1 working hour moves on, never outside 08:30–20:30.',
    },
    steps: [
      ['Leave a lead untouched 59 working minutes', 'Not moved'],
      ['60 working minutes', 'Moved to the next consultant'],
      ['At 20:29 leave it', 'Clock pauses until 08:30'],
    ],
    why: WHY.time,
  }),
  // Status state machine
  manual({
    id: 'LEAD-34',
    section: S,
    priority: 'P1',
    technique: 'State transition',
    title: 'Only the moves allowed from the current status are offered',
    requirement: {
      id: 'BR-204',
      statement: 'From "Mới" only the allowed moves are offered; each move is recorded.',
    },
    steps: [
      ['Open a "Mới" lead > "Đổi trạng thái"', 'Only the allowed next statuses'],
      ['Move to "Đang tư vấn"', 'Recorded in the history'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'LEAD-35',
    section: S,
    priority: 'P1',
    technique: 'State transition',
    title: 'Refused needs a reason and sends the lead to re-care in 15 days',
    requirement: {
      id: 'BR-204',
      statement:
        'Refused requires a reason; the lead enters re-care with a contact-again date 15 days later and is never closed.',
    },
    steps: [
      ['Set "Từ chối" without a reason', 'Refused'],
      ['With a reason', 'In re-care, contact-again date today + 15'],
    ],
    why: WHY.date,
  }),
  manual({
    id: 'LEAD-36',
    section: S,
    priority: 'P2',
    technique: 'State transition',
    title: 'No response and No show also go to re-care',
    requirement: {
      id: 'BR-204',
      statement: 'No response and No show leads enter the re-care queue with a contact-again date.',
    },
    steps: [
      ['Set "Chưa phản hồi"', 'In re-care'],
      ['Set "No show"', 'In re-care'],
    ],
    why: WHY.date,
  }),
  manual({
    id: 'LEAD-37',
    section: S,
    priority: 'P1',
    technique: 'Decision table',
    title: 'Converting at Show needs ID document, birth date, nationality and email',
    requirement: {
      id: 'BR-206',
      statement:
        'Converting to a customer requires ID card or passport, birth date, nationality and email; the record keeps its ID.',
    },
    steps: [
      ['Show with each field missing in turn', 'Conversion refused, naming the missing field'],
      ['All present', 'Converted; same record ID'],
    ],
    why: WHY.mutate,
  }),
  manual({
    id: 'LEAD-38',
    section: S,
    priority: 'P2',
    technique: 'State transition',
    title: 'A ticked checklist step cannot be unticked except by Admin with a reason',
    requirement: {
      id: 'AC-27',
      statement: 'A ticked checklist step cannot be unticked; Admin removes a tick with a reason.',
    },
    steps: [
      ['Consultant: tick a step, try to untick', 'No way to untick'],
      ['Admin removes it with a reason', 'The step opens again'],
    ],
    why: WHY.twoUsers,
  }),
  manual({
    id: 'LEAD-39',
    section: S,
    priority: 'P2',
    technique: 'Boundary value analysis',
    title: 'An overdue step locks after its grace period',
    requirement: {
      id: 'AC-27',
      statement:
        'An overdue step past its grace period locks as "Không thực hiện" and cannot be ticked late.',
    },
    steps: [
      ['Tick just inside the grace period', 'Ticked, marked late'],
      ['After the grace period', 'Locked "Không thực hiện"'],
    ],
    why: WHY.time,
  }),
  manual({
    id: 'LEAD-40',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: 'Reminder steps are created at the right times',
    requirement: {
      id: 'AC-07',
      statement:
        'Reminder steps at 60 minutes, 24 hours, 3 hours and 60 minutes before the visit, and 15 days are created at the right time.',
    },
    steps: [['Book an appointment', 'Each reminder step exists with its due time']],
    why: WHY.time,
  }),
  manual({
    id: 'LEAD-41',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: '"Today\'s tasks" lists due and overdue steps',
    requirement: {
      id: 'FR-LEAD-005',
      statement: '"Today\'s tasks" per consultant shows due and overdue steps.',
    },
    steps: [['Open "Việc hôm nay" as a consultant', 'Due and overdue steps, overdue highlighted']],
    why: WHY.time,
  }),
  manual({
    id: 'LEAD-42',
    section: S,
    priority: 'P2',
    technique: 'Use case',
    title: 'A manager reassigns a lead',
    requirement: {
      id: 'BR-203',
      statement: 'Managers may reassign a lead; the move is in the history and both consultants are told.',
    },
    steps: [['Reassign a lead', 'New person in charge; history and notifications']],
    why: WHY.mutate,
  }),
  manual({
    id: 'LEAD-43',
    section: S,
    priority: 'P3',
    technique: 'Use case',
    title: 'The script library answers in Vietnamese and English with copy',
    requirement: {
      id: 'FR-LEAD-010',
      statement:
        'Script library: situations with Vietnamese and English answers and a copy button, managed by managers.',
    },
    steps: [['Open a script; copy the English answer', 'Copied text matches']],
    why: WHY.judge,
  }),
];

export const LEADS: Module = {
  id: 'LEAD',
  name: 'Leads and consulting',
  designs: [
    {
      technique: 'Equivalence partitioning',
      title: 'Lead name',
      columns: ['Partition', 'Example', 'Expected', 'Case'],
      rows: [
        ['Valid (1–150)', '"QA LEAD-01"', 'Saved', 'LEAD-01, LEAD-04, LEAD-05'],
        ['Empty', '""', 'Bắt buộc nhập.', 'LEAD-02'],
        ['Spaces only', '"   "', 'Bắt buộc nhập.', 'LEAD-03'],
        ['Too long (>150)', '151 × Q', 'Quá dài.', 'LEAD-06'],
        ['Markup', '<b>…</b>', 'Shown as text', 'LEAD-27'],
        ['Control characters', '\\u0007', 'Có ký tự không hợp lệ.', 'LEAD-28'],
      ],
    },
    {
      technique: 'Boundary value analysis',
      title: 'Lead name length (1–150) and phone digits (8–15)',
      columns: ['Field', 'Value', 'Expected', 'Case'],
      rows: [
        ['Name', '0 chars', 'Bắt buộc nhập.', 'LEAD-02'],
        ['Name', '1 char', 'Accepted', 'LEAD-04'],
        ['Name', '150 chars', 'Accepted', 'LEAD-05'],
        ['Name', '151 chars', 'Quá dài.', 'LEAD-06'],
        ['Phone', '7 digits', 'Số điện thoại không hợp lệ.', 'LEAD-08'],
        ['Phone', '8 digits', 'Accepted', 'LEAD-09'],
        ['Phone', '15 digits', 'Accepted', 'LEAD-10'],
        ['Phone', '16 digits', 'Số điện thoại không hợp lệ.', 'LEAD-11'],
      ],
    },
    {
      technique: 'Equivalence partitioning',
      title: 'Lead phone',
      columns: ['Partition', 'Example', 'Expected', 'Case'],
      rows: [
        ['Empty (optional)', '""', 'Saved', 'LEAD-01'],
        ['Digits only', '09123456', 'Accepted', 'LEAD-09'],
        ['With spaces', '0912 345 678', 'Normalized, accepted', 'LEAD-13'],
        ['International', '+84912345678', 'Accepted', 'LEAD-14'],
        ['With letters', '09abc45678', 'Invalid', 'LEAD-12'],
        ["Already a customer's", '0909123456', 'Merge prompt', 'LEAD-18'],
        ["Already a lead's", '0901234508', 'Merge prompt', 'LEAD-19'],
      ],
    },
    {
      technique: 'Decision table',
      title: 'Channel "Khác" and the note (AC-04)',
      columns: ['Channel is "Khác"', 'Note given', 'Expected', 'Case'],
      rows: [
        ['Yes', 'No', 'Refused: Đã chọn "Khác" thì phải ghi rõ.', 'LEAD-15'],
        ['Yes', 'Yes', 'Saved', 'LEAD-16'],
        ['No', '— (no field)', 'Saved', 'LEAD-17'],
        ['None chosen', '—', 'Bắt buộc nhập.', 'LEAD-07'],
      ],
    },
    {
      technique: 'Decision table',
      title: 'Converting a lead at Show (BR-206)',
      columns: ['ID document', 'Birth date', 'Nationality', 'Email', 'Expected'],
      rows: [
        ['✓', '✓', '✓', '✓', 'Converted, same ID'],
        ['—', '✓', '✓', '✓', 'Refused'],
        ['✓', '—', '✓', '✓', 'Refused'],
        ['✓', '✓', '—', '✓', 'Refused'],
        ['✓', '✓', '✓', '—', 'Refused'],
      ],
    },
    {
      technique: 'State transition',
      title: 'Lead status (BR-204)',
      columns: ['From', 'Event', 'To', 'Cases'],
      rows: [
        ['Mới', 'Start consulting', 'Đang tư vấn', 'LEAD-34'],
        ['Đang tư vấn', 'Appointment', 'Đã đặt lịch', 'LEAD-34'],
        ['Đã đặt lịch', 'Came', 'Show → customer', 'LEAD-37'],
        ['Đã đặt lịch', 'Did not come', 'No show → re-care', 'LEAD-36'],
        ['Any open', 'Refused + reason', 'Từ chối → re-care +15 days', 'LEAD-35'],
        ['Any open', 'No answer', 'Chưa phản hồi → re-care', 'LEAD-36'],
      ],
    },
  ],
  cases,
};
