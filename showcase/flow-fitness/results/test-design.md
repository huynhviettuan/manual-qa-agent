# flow-fitness — test design

Generated 2026-10-27 from the stored cases: 376 cases, 376 approved, 353 automatable (api or ui), 23 manual. Every figure is a count of records; execution results come only from recorded runs (see test-cases.csv).

## 1. Requirement analysis

5 approved source versions carrying 490 requirement identifiers; 0 acceptance criteria across the submitted stories.

| Source | Type | Area | Identifiers | Cases |
| --- | --- | --- | --- | --- |
| FF-AC@v1 | ACCEPTANCE_CRITERIA |  | 58 | 113 |
| FF-BR@v1 | SPECIFICATION |  | 85 | 195 |
| FF-DEC@v1 | SPECIFICATION |  | 322 | 327 |
| FF-FR@v1 | SPECIFICATION |  | 84 | 271 |
| FF-NFR@v1 | SPECIFICATION |  | 0 | 0 |

### Ambiguities and open questions

None open.

## 2. Techniques selected, and why

| Technique | Approved cases |
| --- | --- |
| boundary_value_analysis | 100 |
| state_transition | 96 |
| use_case | 65 |
| permission_matrix | 62 |
| decision_table | 62 |
| equivalence_partitioning | 61 |
| attack_based | 46 |
| error_guessing | 43 |
| syntax | 26 |
| metamorphic | 22 |
| scenario | 19 |
| checklist | 18 |
| specification_based | 18 |
| domain | 11 |
| defect_based | 8 |
| exploratory | 5 |
| cause_effect | 4 |
| classification_tree | 3 |
| pairwise | 2 |

Each case names the technique its conditions came from (ADR-0014); the design notes of each draft set hold the partitions, boundaries and rule columns.

## 3. Test conditions and coverage model

Sources cited by at least one case: 4 / 5. Acceptance criteria covered: 0 / 0. Requirement identifiers covered: 490 / 490.

## 4. Test cases

| Module | Approved | P0 | Automatable | Manual |
| --- | --- | --- | --- | --- |
| Platform | 25 | 0 | 21 | 4 |
| Bookings | 51 | 7 | 48 | 3 |
| Accounts | 10 | 6 | 10 | 0 |
| Money | 42 | 12 | 41 | 1 |
| Contracts | 51 | 5 | 49 | 2 |
| Permissions | 29 | 10 | 28 | 1 |
| Reports | 16 | 0 | 14 | 2 |
| Customers | 22 | 1 | 22 | 0 |
| Services | 8 | 0 | 6 | 2 |
| Auth | 11 | 2 | 11 | 0 |
| Business flows | 23 | 4 | 21 | 2 |
| Edge cases | 14 | 1 | 14 | 0 |
| Classes | 10 | 0 | 10 | 0 |
| Exploratory | 4 | 0 | 0 | 4 |
| Leads | 20 | 0 | 19 | 1 |
| Tasks | 8 | 0 | 8 | 0 |
| Configuration | 3 | 0 | 3 | 0 |
| UI | 16 | 0 | 15 | 1 |
| Check-in | 3 | 0 | 3 | 0 |
| Workouts | 7 | 0 | 7 | 0 |
| Employees | 3 | 0 | 3 | 0 |

The full schema of every case is in test-cases.csv.

## 5. Traceability

Requirement × case: traceability.csv. Criteria with their cases:

| Story | Criterion | Cases |
| --- | --- | --- |

## 6. Coverage gaps and assumptions

**Sources no case cites (1):** FF-NFR@v1.

**Criteria no case covers (0):** none.

**Identifiers no case reaches (0):** none.

**Cases resting on assumptions (50):**

| Case | Assumption | Open question |
| --- | --- | --- |
| PLT-001 | The status for a malformed id is not documented; the product answers 404 NOT_FOUND, and the case pins it | — |
| RPT-002 | Which periods besides week and month are refused is not documented; 'year' is expected to be refused (400) | Q-13 |
| BKG-018 | Which actions a cancelled session refuses is not listed; refusing every status change is the reading of D-025 (a cancelled session frees the slot and is final) | Q-9 |
| RBAC-002 | That authorization is checked before validation (403 even for an empty body) is not documented; it is how T-046 is built | — |
| BKG-004 | Only HH:mm 00:00–23:59 is documented as a time; that 23:59 is the latest end is inferred from it | — |
| EDGE-003 | D-082 allows a renewal of a 'running' contract; whether a frozen contract counts as running is not stated, so the case expects a refusal | Q-6 |
| CRUD-008 | That an inactive service is refused for a new contract is read from doc 07 (a service not on sale that day is serviceNotOnSale) and A-109's active flag; no document says it in so many words | — |
| CUS-006 | No name length or character rule is documented; refusing control characters and 10,000 characters is the expected safe behaviour, not a stated rule | Q-3 |
| EXP-004 | What Admin may do to their own role and account is not documented beyond AUTH-006 (no self two-factor reset) | Q-17, Q-18 |
| CODE-002 | No document limits a code's uses: D-098 answered OQ-106 on the dates only (A-408), so the uses stay as built | — |
| END-015 | The documents check the session's day against the contract dates (A-017) but are silent on confirming after the end; logged by the product as OQ-094 | — |
| CHK-005 | A-406 gives a customer only their own number, and staff any free code; neither rule says what happens when staff hold a customer's number | Q-41 |
| LIFE-006 | Where the customer stays (Q-32) and whether the old branch's trainer may still be booked (Q-34) are open: the third expected result is today's behaviour, not a requirement | Q-32, Q-34 |
| UI-007 | No layout rule is documented beyond AC-23 'works on a phone'; clipped amounts and sideways scrolling are taken as not working | — |
| CNV-001 | D-024 calls a conversion a change 'to another service or type'; A-229 keeps 'the contract's service … as sold'. The two readings differ: Q-37 | Q-37 |
| BKG-028 | No document says whether a session may be moved into the past; today it may (a record corrected) | — |
| CON-009 | What a second freeze answers is not documented (Q-8); the case pins today's answer | Q-8 |
| PTM-008 | A-233 cancels the sessions 'still Booked from today on'; a checked-in session is still Booked, while a cancellation is refused during a session (D-010) | — |
| AUTH-009 | Doc 07 does not name the code for a malformed body; 400 VALIDATION_FAILED is what the product answers, and any 4xx in the error contract would meet API-ERR | — |
| CLS-002 | That a class session cannot be marked before it starts is built (CLASS_NOT_STARTED) but not stated in the documents | Q-11 |
| CUS-012 | Accent-insensitive search is built but not stated in FR-CUS-003 | — |
| TASK-002 | Valid reminder hours are not bounded in the documents; 0, negative and 1000 hours are refused by the product | Q-12 |
| FLD-009 | A-372: the value is HH:mm (H:mm taken), typed or picked; nothing documents a longest session | — |
| BKG-021 | Rules R1–R6 each break one condition and are specified; R7 breaks two at once, and which refusal wins is not documented (Q-15): the case records the current answer | Q-15 |
| CUS-013 | The phone syntax is not documented (Q-2); the expected answers are the product's current ones | Q-2 |
| SVC-001 | Whether a 0 đ price or a gap between ranges is allowed is not documented; the product accepts both (a gap leaves those counts unsellable, as CON-001 shows at 1001), and this case records it | — |
| LIFE-005 | A-223 says every figure uses the vouchers; it does not say whether that reaches sessions already paid at the old rate | Q-35 |
| AUTH-010 | No body size limit is documented; the product answers 400 VALIDATION_FAILED, and the case pins it | — |
| FLD-007 | Doc 07 states lists take page and pageSize and days as dd/MM/yyyy, and that every field error is a key; no document sets the largest page. The code's limit is 100 (MAX_PAGE_SIZE), checked as built | — |
| CUS-010 | Whether such fields are refused (400) or ignored is not documented; the product ignores them (201), and the case pins that. A client-chosen code or id is never taken; a status no longer exists (D-101) | — |
| FLD-011 | A-111: the VAT percent is entered on the contract; no document sets its steps, so 8.5 is checked as built; the session and bonus limits follow the tiers' 1 to 1000 (FR-SVC-002) | — |
| FLD-012 | No document states the password policy; the product's is checked as built: at least 10 characters, nothing else | — |
| END-016 | D-023 says 'more than 10 days'; the code reminds at exactly 10 × 24 hours; logged by the product as OQ-095 | — |
| EDGE-007 | The rounding of VAT is not documented; for whole-đồng values the case expects round(value × 8%) | Q-10 |
| CUS-011 | The docs do not say how wildcard characters are searched; literal matching is what 'search by code, name or phone' means and what the fix of BUG-009 does | — |
| CON-018 | No document says what the due date drives or bounds it (A-119: it 'records when the rest is due'); A-114 says enforcing the deadline was left to M4.6, which does not mention it | — |
| PTM-014 | A-168 places a session on its scheduled day for the booking report and the overview; the documents do not say which day the manual-confirmation report uses. A-398 says the question of OQ-097 (Q-25) falls away, since a session is confirmed on its day or by Admin; the report's day for Admin's late confirmation stays as built | — |
| FLD-010 | A-002: whole đồng; doc 07 lets an amount come as a number or as text. How text is read (thousands marks) is checked as built | — |
| WO-005 | A-029 counts a customer as the PT's through a session only; the contract's PT does not count (OQ-093, answered as built by D-094) | — |
| CHG-006 | Whether a renewal may add sessions for 0 đ is Q-1: the case pins today's answer, not a requirement | Q-1 |
| PTM-003 | D-032 splits PT pay by the sessions actually taught; the documents never say what the PT shares' percentages are for | — |
| EDGE-004 | D-023 does not say whether a contract not yet approved can be frozen; refusing it is expected | Q-7 |
| PLT-005 | As PLT-001: 400 or 404 is not specified per operation; any 4xx meets the error contract, a 5xx never does | — |
| CUS-007 | The email syntax accepted is not specified; both values are invalid under RFC 5322 | Q-4 |
| POUT-003 | What a payout answers when the take-back equals the credit exactly is Q-14: the case pins today's answer | Q-14 |
| CRUD-001 | D-034 says a deleted voucher goes to the trash and the debt is recomputed; that it leaves the receipts list (rather than staying, marked) is assumed from A-125, which says so for a contract | — |
| CUS-005 | The phone syntax (digits, length) is not documented; letters and empty are clearly invalid, 3 and 40 digits are chosen as out of any phone length | Q-2 |
| PTM-015 | A-158 refuses 'a time that has not come yet' without saying whether the start or the end counts | — |
| FLD-008 | T-064 states a CCCD of 12 digits or a passport, and a consent; no document states a passport's form, the earliest birth date or whether a birth date may be today, so those are checked as built | — |
| PLT-002 | No page-size maximum is documented; 100 is the product's limit, so 101 is expected to be refused | Q-5 |

**Stale cases (0):** approved against a source version that is no longer active.

None.

## 7. Risk-based execution order

Run in this order; stop and report on any P0 failure. P0 is money, double consumption, authorization bypass or silent data loss.

**P0** (48): ACC-005, LIFE-004, BKG-011, BKG-013, CUS-002, BKG-003, CON-005, RBAC-007, RBAC-001, RBAC-009, RBAC-014, BKG-031, ACC-003, RBAC-024, PAY-001, ACC-001, CON-011, PTM-007, AUTH-002, RBAC-011, RBAC-013, FLOW-014, PTM-006, CON-004, RBAC-003, RBAC-004, BKG-010, ACC-004, PAY-005, LIFE-008, BKG-002, END-007, FLOW-019, ACC-008, PAY-002, CON-006, RBAC-017, LIFE-001, PTM-001, PAY-004, AUTH-007, FLOW-001, POUT-001, EDGE-002, DOM-003, ACC-002, CASH-003, PTM-005

**P1** (154): BKG-001, CHG-001, PRC-003, BKG-009, RBAC-002, PRC-002, SEC-001, FLOW-016, BKG-029, IMP-001, CON-013, MAIL-001, EXP-004, RBAC-008, BKG-026, CON-020, LEAD-003, FLOW-013, BKG-035, RBAC-006, GLB-001, EDGE-005, UI-006, CLS-001, RND-001, LEAD-001, OPT-002, BKG-015, FLOW-003, LIFE-006, BKG-034, UI-027, PLT-003, RBAC-019, MAN-008, CNV-001, RBAC-018, FLOW-017, BKG-028, CON-009, FLOW-004, PTM-010, MAN-006, BKG-005, CUS-001, RBAC-023, CON-002, UI-001, CON-007, CRUD-010, RPT-006, FLOW-008, WO-001, ACC-009, SHOP-001, END-012, BKG-021, END-008, FLOW-010, LEAD-013, PTM-016, END-011, CON-010, BKG-008, BKG-027, CHG-004, LIFE-007, CUS-008, RBAC-015, UI-004, RPT-009, BKG-014, PRF-001, CRUD-006, MAN-009, END-006, WO-002, CHK-001, MAN-007, EDGE-008, FLOW-007, FLOW-005, CHG-005, RBAC-022, CON-015, LOY-001, FLOW-020, LEAD-009, RBAC-010, EDGE-009, CUS-003, CHG-002, CRUD-007, UI-025, PRC-001, UI-002, RBAC-016, PTM-009, CLS-003, GLB-003, XPT-003, AUTH-001, FLOW-009, PAY-007, FLD-010, TASK-001, LIFE-003, RPT-003, LOCK-001, INT-001, XPT-001, CODE-001, CHK-006, RBAC-012, EDGE-001, LIFE-002, BKG-016, CHG-006, END-003, DOM-001, CON-001, AUTH-004, MAN-005, RBAC-021, PTM-002, FLOW-015, UI-011, AUTH-003, CRUD-003, CASH-001, FLOW-011, PRC-005, BKG-006, CON-021, LEAD-010, END-001, POUT-003, UI-003, BKG-032, FLOW-012, WO-003, POUT-002, CON-022, CRUD-001, EXP-002, ACC-006, ACC-007, PTM-012, LEAD-004, FLD-008, PTM-004, FLOW-018, RBAC-020, FLOW-002

**P2** (141): PLT-001, RPT-007, BKG-018, END-018, CON-016, PRC-007, BKG-004, EDGE-003, PROMO-001, CRUD-008, CLS-006, CUS-006, CUS-009, BKG-024, DOM-002, UI-018, CRUD-002, EXP-003, CLS-004, CON-003, TASK-003, CODE-002, UI-029, UI-005, UI-017, UI-026, END-015, LEAD-011, CHK-005, PRC-006, RPT-005, TASK-005, AUTH-006, PAY-006, EDGE-010, LEAD-008, RPT-001, LEAD-005, UI-028, SVC-002, BKG-012, BKG-007, WO-007, MAN-002, LEAD-007, PTM-008, EDGE-006, FLD-005, AUTH-009, CLS-002, CUS-012, RBAC-005, CON-008, WO-004, RPT-004, UI-024, FLD-009, CUS-013, MAIL-002, SVC-001, AUTH-005, LEAD-002, END-005, LEAD-014, CRUD-005, GLB-004, UI-009, CRUD-004, LIFE-005, BKG-019, MAN-011, BKG-025, ACC-010, CUS-014, FLD-007, CRUD-009, EDGE-012, CUS-010, CON-019, FLD-011, CUS-004, END-019, BKG-017, FLD-012, PRC-004, FLD-003, WO-006, CON-012, EDGE-007, BKG-023, BKG-033, AUD-001, CUS-011, END-017, BKG-030, CHK-004, CLS-007, BKG-020, EDGE-011, RPT-008, CON-017, TRASH-001, FLD-004, UI-016, SCR-001, UI-012, CLS-008, PTM-011, END-013, CHK-002, FLOW-006, CNV-002, EXP-001, CON-014, WO-005, MAN-004, BKG-022, END-014, EMP-001, PTM-003, UI-014, END-009, LIFE-009, XPT-002, AUTH-008, EMP-002, END-002, OPT-001, END-004, CHG-003, MAN-003, CUS-005, FLD-001, PTM-015, GLB-002, UI-013, TASK-004, OPT-003, MAN-010, CHK-003, MAN-001

**P3** (33): RPT-002, UI-023, UI-031, EDGE-013, UI-010, UI-019, END-010, PTM-013, LEAD-012, UI-021, UI-007, UI-030, PLT-004, TASK-002, AUTH-010, UI-015, CLS-005, PRF-002, UI-020, UI-022, END-016, CON-018, EDGE-014, UI-008, FLD-002, PTM-014, EDGE-004, PLT-005, FLD-006, CUS-007, LEAD-006, CRUD-011, PLT-002

**Smoke** (each run of a pull request, 0): none

## 8. Suggested regression scope

For a change, run the cases of the module it touches, plus all P0, plus the cases guarding a defect. `GET /api/regression?ref=<requirement id>` selects the cases citing one requirement.

| Module changed | Cases to run |
| --- | --- |
| Platform | PLT-001, UI-023, IMP-001, MAIL-001, UI-019, OPT-002, PLT-003, PLT-004, MAN-002, FLD-005, MAIL-002, GLB-004, FLD-007, FLD-003, TRASH-001, FLD-004, FLD-002, MAN-004, PLT-005, FLD-006, OPT-001, FLD-001, PLT-002, OPT-003, MAN-001 |
| Bookings | BKG-001, BKG-009, BKG-018, BKG-011, BKG-004, BKG-013, BKG-029, BKG-024, BKG-026, BKG-003, BKG-035, UI-017, END-015, BKG-015, BKG-034, MAN-008, BKG-028, UI-028, BKG-012, BKG-007, BKG-005, BKG-031, END-012, FLD-009, BKG-021, CRUD-005, BKG-019, PTM-007, BKG-008, BKG-027, BKG-025, BKG-014, END-019, BKG-017, END-006, BKG-010, CHK-001, BKG-023, BKG-002, BKG-033, BKG-030, BKG-020, PTM-009, CHK-002, CHK-006, BKG-022, BKG-016, END-003, BKG-006, MAN-003, PTM-015 |
| Accounts | ACC-005, ACC-003, ACC-009, ACC-001, ACC-010, ACC-004, ACC-008, ACC-002, ACC-006, ACC-007 |
| Money | CHG-001, LIFE-004, RND-001, UI-027, PAY-006, MAN-006, CRUD-010, SHOP-001, PAY-001, END-008, LIFE-005, PTM-016, CHG-004, LIFE-007, PTM-006, PRF-002, PRF-001, CRUD-006, PAY-005, CHG-005, END-007, CHG-002, PAY-002, PAY-007, FLD-010, PTM-001, LOCK-001, PAY-004, XPT-001, CHG-006, POUT-001, PTM-003, PTM-002, END-009, DOM-003, CASH-003, CASH-001, POUT-003, POUT-002, CHG-003, CRUD-001, PTM-005 |
| Contracts | PRC-003, CON-016, PROMO-001, CRUD-008, UI-031, CON-013, DOM-002, CRUD-002, CON-005, CON-020, CON-003, CODE-002, UI-026, LIFE-006, CNV-001, SVC-002, CON-009, PTM-010, CON-002, PTM-008, CON-007, CON-008, SVC-001, END-005, CON-011, CON-010, CON-019, CON-004, FLD-011, UI-020, CON-012, LIFE-008, END-016, CON-015, CON-018, CON-017, CON-006, CNV-002, LIFE-003, CODE-001, CON-014, LIFE-002, END-014, DOM-001, CON-001, CRUD-003, CON-021, END-001, END-004, CON-022, PTM-012 |
| Permissions | RPT-007, RBAC-002, RBAC-008, UI-029, RBAC-006, RBAC-007, RBAC-001, RBAC-019, RBAC-009, RBAC-018, RBAC-023, RBAC-014, RBAC-005, RBAC-024, RBAC-011, RBAC-013, RBAC-003, RBAC-015, RBAC-004, FLD-012, MAN-007, RBAC-022, RBAC-010, RBAC-016, RBAC-017, RBAC-012, RBAC-021, BKG-032, RBAC-020 |
| Reports | RPT-002, END-010, PTM-013, RPT-005, UI-021, RPT-001, RPT-006, RPT-004, RPT-009, UI-022, RPT-008, XPT-003, PTM-014, RPT-003, XPT-002, PTM-004 |
| Customers | END-018, CUS-002, CUS-006, CUS-009, CUS-001, CUS-012, UI-024, CUS-013, CRUD-004, CUS-014, CUS-010, CUS-008, CUS-004, PRC-004, CUS-011, LOY-001, END-017, CUS-003, CUS-007, END-002, CRUD-011, CUS-005 |
| Services | PRC-007, PRC-002, UI-018, PRC-006, MAN-011, PRC-001, PRC-005, MAN-010 |
| Auth | SEC-001, AUTH-006, AUTH-009, AUTH-005, AUTH-010, AUTH-002, AUTH-001, AUTH-007, AUTH-004, AUTH-003, AUTH-008 |
| Business flows | FLOW-016, FLOW-013, FLOW-003, FLOW-017, FLOW-004, FLOW-008, FLOW-010, FLOW-014, MAN-009, FLOW-007, FLOW-005, FLOW-019, FLOW-020, FLOW-006, FLOW-009, LIFE-001, FLOW-001, MAN-005, FLOW-015, FLOW-011, FLOW-012, FLOW-018, FLOW-002 |
| Edge cases | EDGE-003, EDGE-013, EDGE-005, EDGE-010, EDGE-006, EDGE-012, EDGE-008, EDGE-007, EDGE-009, EDGE-011, EDGE-014, EDGE-001, EDGE-002, EDGE-004 |
| Classes | CLS-006, CLS-004, CLS-001, CLS-002, CLS-005, CLS-007, CLS-003, CLS-008, PTM-011, LIFE-009 |
| Exploratory | EXP-004, EXP-003, EXP-001, EXP-002 |
| Leads | LEAD-003, LEAD-011, LEAD-001, LEAD-012, LEAD-008, LEAD-005, LEAD-007, LEAD-002, LEAD-014, LEAD-013, AUD-001, LEAD-009, UI-025, SCR-001, END-013, INT-001, LEAD-010, LEAD-006, LEAD-004, FLD-008 |
| Tasks | TASK-003, TASK-005, UI-030, TASK-002, END-011, CRUD-009, TASK-001, TASK-004 |
| Configuration | GLB-001, GLB-003, GLB-002 |
| UI | UI-005, UI-010, UI-006, UI-007, UI-001, UI-009, UI-015, UI-004, UI-002, UI-016, UI-012, UI-008, UI-014, UI-011, UI-003, UI-013 |
| Check-in | CHK-005, CHK-004, CHK-003 |
| Workouts | WO-007, WO-004, WO-001, WO-002, WO-006, WO-005, WO-003 |
| Employees | CRUD-007, EMP-001, EMP-002 |

**Cases guarding a defect (0):** none.

**Unstable cases (0):** verdicts differed between runs of the same steps on the same environment and build; not trusted until the cause is known.

None.
