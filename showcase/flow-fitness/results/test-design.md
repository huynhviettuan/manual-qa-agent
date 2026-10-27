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
| specification_based | 18 |
| checklist | 18 |
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
| Accounts | 10 | 6 | 10 | 0 |
| Customers | 22 | 1 | 22 | 0 |
| Leads | 20 | 0 | 19 | 1 |
| Contracts | 51 | 5 | 49 | 2 |
| UI | 16 | 0 | 15 | 1 |
| Platform | 25 | 0 | 21 | 4 |
| Permissions | 29 | 10 | 28 | 1 |
| Money | 42 | 12 | 41 | 1 |
| Bookings | 51 | 7 | 48 | 3 |
| Business flows | 23 | 4 | 21 | 2 |
| Edge cases | 14 | 1 | 14 | 0 |
| Tasks | 8 | 0 | 8 | 0 |
| Employees | 3 | 0 | 3 | 0 |
| Exploratory | 4 | 0 | 0 | 4 |
| Auth | 11 | 2 | 11 | 0 |
| Reports | 16 | 0 | 14 | 2 |
| Services | 8 | 0 | 6 | 2 |
| Configuration | 3 | 0 | 3 | 0 |
| Classes | 10 | 0 | 10 | 0 |
| Workouts | 7 | 0 | 7 | 0 |
| Check-in | 3 | 0 | 3 | 0 |

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
| SVC-001 | Whether a 0 đ price or a gap between ranges is allowed is not documented; the product accepts both (a gap leaves those counts unsellable, as CON-001 shows at 1001), and this case records it | — |
| BKG-004 | Only HH:mm 00:00–23:59 is documented as a time; that 23:59 is the latest end is inferred from it | — |
| END-015 | The documents check the session's day against the contract dates (A-017) but are silent on confirming after the end; logged by the product as OQ-094 | — |
| AUTH-009 | Doc 07 does not name the code for a malformed body; 400 VALIDATION_FAILED is what the product answers, and any 4xx in the error contract would meet API-ERR | — |
| TASK-002 | Valid reminder hours are not bounded in the documents; 0, negative and 1000 hours are refused by the product | Q-12 |
| CUS-010 | Whether such fields are refused (400) or ignored is not documented; the product ignores them (201), and the case pins that. A client-chosen code or id is never taken; a status no longer exists (D-101) | — |
| PTM-014 | A-168 places a session on its scheduled day for the booking report and the overview; the documents do not say which day the manual-confirmation report uses. A-398 says the question of OQ-097 (Q-25) falls away, since a session is confirmed on its day or by Admin; the report's day for Admin's late confirmation stays as built | — |
| CUS-011 | The docs do not say how wildcard characters are searched; literal matching is what 'search by code, name or phone' means and what the fix of BUG-009 does | — |
| EDGE-003 | D-082 allows a renewal of a 'running' contract; whether a frozen contract counts as running is not stated, so the case expects a refusal | Q-6 |
| END-016 | D-023 says 'more than 10 days'; the code reminds at exactly 10 × 24 hours; logged by the product as OQ-095 | — |
| AUTH-010 | No body size limit is documented; the product answers 400 VALIDATION_FAILED, and the case pins it | — |
| BKG-018 | Which actions a cancelled session refuses is not listed; refusing every status change is the reading of D-025 (a cancelled session frees the slot and is final) | Q-9 |
| BKG-028 | No document says whether a session may be moved into the past; today it may (a record corrected) | — |
| WO-005 | A-029 counts a customer as the PT's through a session only; the contract's PT does not count (OQ-093, answered as built by D-094) | — |
| LIFE-006 | Where the customer stays (Q-32) and whether the old branch's trainer may still be booked (Q-34) are open: the third expected result is today's behaviour, not a requirement | Q-32, Q-34 |
| LIFE-005 | A-223 says every figure uses the vouchers; it does not say whether that reaches sessions already paid at the old rate | Q-35 |
| PTM-003 | D-032 splits PT pay by the sessions actually taught; the documents never say what the PT shares' percentages are for | — |
| PTM-015 | A-158 refuses 'a time that has not come yet' without saying whether the start or the end counts | — |
| CHG-006 | Whether a renewal may add sessions for 0 đ is Q-1: the case pins today's answer, not a requirement | Q-1 |
| RBAC-002 | That authorization is checked before validation (403 even for an empty body) is not documented; it is how T-046 is built | — |
| CON-009 | What a second freeze answers is not documented (Q-8); the case pins today's answer | Q-8 |
| POUT-003 | What a payout answers when the take-back equals the credit exactly is Q-14: the case pins today's answer | Q-14 |
| CRUD-008 | That an inactive service is refused for a new contract is read from doc 07 (a service not on sale that day is serviceNotOnSale) and A-109's active flag; no document says it in so many words | — |
| PLT-002 | No page-size maximum is documented; 100 is the product's limit, so 101 is expected to be refused | Q-5 |
| FLD-007 | Doc 07 states lists take page and pageSize and days as dd/MM/yyyy, and that every field error is a key; no document sets the largest page. The code's limit is 100 (MAX_PAGE_SIZE), checked as built | — |
| FLD-008 | T-064 states a CCCD of 12 digits or a passport, and a consent; no document states a passport's form, the earliest birth date or whether a birth date may be today, so those are checked as built | — |
| FLD-011 | A-111: the VAT percent is entered on the contract; no document sets its steps, so 8.5 is checked as built; the session and bonus limits follow the tiers' 1 to 1000 (FR-SVC-002) | — |
| CUS-006 | No name length or character rule is documented; refusing control characters and 10,000 characters is the expected safe behaviour, not a stated rule | Q-3 |
| CRUD-001 | D-034 says a deleted voucher goes to the trash and the debt is recomputed; that it leaves the receipts list (rather than staying, marked) is assumed from A-125, which says so for a contract | — |
| CODE-002 | No document limits a code's uses: D-098 answered OQ-106 on the dates only (A-408), so the uses stay as built | — |
| EDGE-007 | The rounding of VAT is not documented; for whole-đồng values the case expects round(value × 8%) | Q-10 |
| FLD-010 | A-002: whole đồng; doc 07 lets an amount come as a number or as text. How text is read (thousands marks) is checked as built | — |
| FLD-009 | A-372: the value is HH:mm (H:mm taken), typed or picked; nothing documents a longest session | — |
| PTM-008 | A-233 cancels the sessions 'still Booked from today on'; a checked-in session is still Booked, while a cancellation is refused during a session (D-010) | — |
| CLS-002 | That a class session cannot be marked before it starts is built (CLASS_NOT_STARTED) but not stated in the documents | Q-11 |
| UI-007 | No layout rule is documented beyond AC-23 'works on a phone'; clipped amounts and sideways scrolling are taken as not working | — |
| FLD-012 | No document states the password policy; the product's is checked as built: at least 10 characters, nothing else | — |
| CNV-001 | D-024 calls a conversion a change 'to another service or type'; A-229 keeps 'the contract's service … as sold'. The two readings differ: Q-37 | Q-37 |
| BKG-021 | Rules R1–R6 each break one condition and are specified; R7 breaks two at once, and which refusal wins is not documented (Q-15): the case records the current answer | Q-15 |
| EDGE-004 | D-023 does not say whether a contract not yet approved can be frozen; refusing it is expected | Q-7 |
| PLT-005 | As PLT-001: 400 or 404 is not specified per operation; any 4xx meets the error contract, a 5xx never does | — |
| CUS-012 | Accent-insensitive search is built but not stated in FR-CUS-003 | — |
| RPT-002 | Which periods besides week and month are refused is not documented; 'year' is expected to be refused (400) | Q-13 |
| CHK-005 | A-406 gives a customer only their own number, and staff any free code; neither rule says what happens when staff hold a customer's number | Q-41 |
| CUS-005 | The phone syntax (digits, length) is not documented; letters and empty are clearly invalid, 3 and 40 digits are chosen as out of any phone length | Q-2 |
| CUS-007 | The email syntax accepted is not specified; both values are invalid under RFC 5322 | Q-4 |
| CON-018 | No document says what the due date drives or bounds it (A-119: it 'records when the rest is due'); A-114 says enforcing the deadline was left to M4.6, which does not mention it | — |
| CUS-013 | The phone syntax is not documented (Q-2); the expected answers are the product's current ones | Q-2 |
| EXP-004 | What Admin may do to their own role and account is not documented beyond AUTH-006 (no self two-factor reset) | Q-17, Q-18 |

**Stale cases (0):** approved against a source version that is no longer active.

None.

## 7. Risk-based execution order

Run in this order; stop and report on any P0 failure. P0 is money, double consumption, authorization bypass or silent data loss.

**P0** (48): ACC-004, ACC-003, LIFE-001, LIFE-008, CON-004, AUTH-002, BKG-010, PTM-001, DOM-003, FLOW-001, CON-011, ACC-005, LIFE-004, PTM-005, RBAC-004, RBAC-009, BKG-031, PAY-001, PTM-007, BKG-013, CON-006, FLOW-019, RBAC-024, EDGE-002, PAY-005, RBAC-017, BKG-011, RBAC-014, END-007, ACC-002, PTM-006, CUS-002, PAY-004, RBAC-003, CASH-003, CON-005, RBAC-011, PAY-002, BKG-003, ACC-001, POUT-001, BKG-002, FLOW-014, RBAC-007, ACC-008, RBAC-001, RBAC-013, AUTH-007

**P1** (154): LEAD-001, LIFE-003, UI-011, RBAC-020, CRUD-010, BKG-001, LIFE-002, EDGE-005, CON-015, CRUD-007, END-001, FLOW-018, RBAC-010, UI-025, CON-002, FLOW-017, BKG-008, BKG-014, LIFE-007, CHK-001, END-003, ACC-009, CUS-008, PRC-001, FLOW-005, BKG-026, GLB-001, ACC-006, EDGE-001, MAN-009, RBAC-019, CHG-004, BKG-009, FLOW-015, EXP-002, PRC-003, CLS-003, OPT-002, RBAC-021, CHG-005, RBAC-006, WO-003, CON-021, PRC-002, BKG-028, FLOW-009, UI-027, LIFE-006, AUTH-001, WO-001, PLT-003, BKG-029, FLOW-010, MAN-005, BKG-006, DOM-001, CON-013, CON-020, PTM-004, CUS-003, BKG-005, UI-002, PRC-005, BKG-027, RPT-003, GLB-003, PTM-009, WO-002, TASK-001, SEC-001, RBAC-015, CHG-006, RBAC-002, PRF-001, CRUD-006, CON-009, POUT-003, XPT-003, LEAD-010, FLOW-011, END-011, CON-001, EDGE-008, CON-010, END-012, RND-001, FLD-008, AUTH-003, LOCK-001, FLOW-016, RBAC-008, FLOW-012, RBAC-016, CRUD-001, UI-003, EDGE-009, PTM-012, UI-006, LEAD-003, RBAC-023, PTM-002, CLS-001, RBAC-018, RBAC-012, CODE-001, BKG-034, MAN-006, RPT-006, FLD-010, RBAC-022, END-006, LEAD-009, INT-001, PTM-016, FLOW-004, MAIL-001, PTM-010, FLOW-008, LEAD-004, BKG-015, UI-001, IMP-001, MAN-007, BKG-016, CHK-006, CNV-001, UI-004, BKG-021, AUTH-004, BKG-032, CON-007, XPT-001, PAY-007, FLOW-007, SHOP-001, CASH-001, LEAD-013, ACC-007, LOY-001, FLOW-003, CUS-001, BKG-035, POUT-002, FLOW-020, FLOW-013, MAN-008, END-008, CON-022, EXP-004, FLOW-002, CRUD-003, CHG-001, RPT-009, CHG-002

**P2** (141): END-018, PLT-001, UI-009, BKG-019, RPT-007, SVC-001, BKG-004, RBAC-005, END-015, TASK-005, UI-005, EXP-001, AUTH-009, PRC-004, MAN-004, END-009, LEAD-005, BKG-007, END-005, RPT-005, CLS-006, RPT-001, CUS-010, EDGE-006, TASK-003, UI-028, CRUD-004, END-014, FLD-001, LEAD-002, UI-013, BKG-024, CUS-011, CON-008, BKG-012, EDGE-003, EDGE-010, CRUD-009, UI-014, END-017, EDGE-011, UI-012, WO-006, BKG-025, FLD-005, UI-029, BKG-030, BKG-018, UI-016, SCR-001, LEAD-011, WO-005, EMP-001, CNV-002, XPT-002, LIFE-005, PAY-006, CON-003, CON-017, PTM-003, CRUD-005, WO-007, GLB-004, CON-016, CUS-014, CHK-002, LEAD-014, PTM-015, PRC-007, CRUD-008, BKG-020, GLB-002, PTM-011, RPT-004, WO-004, FLD-007, OPT-001, AUTH-008, TRASH-001, AUTH-005, FLD-011, UI-026, FLD-004, PROMO-001, MAN-010, CUS-009, CUS-004, CUS-006, CLS-007, MAN-001, END-013, CODE-002, CON-019, EDGE-007, ACC-010, CHK-003, DOM-002, CON-014, FLD-003, MAN-011, FLD-009, LEAD-007, PRC-006, PTM-008, CHG-003, MAIL-002, BKG-022, CLS-002, END-002, FLD-012, MAN-002, LEAD-008, EDGE-012, UI-024, RPT-008, TASK-004, UI-017, MAN-003, CUS-012, LIFE-009, FLOW-006, CHK-004, CRUD-002, AUTH-006, OPT-003, CHK-005, EXP-003, END-004, CUS-005, CLS-008, EMP-002, SVC-002, BKG-017, CUS-013, AUD-001, UI-018, END-019, BKG-023, CLS-004, BKG-033, CON-012

**P3** (33): UI-031, UI-023, UI-030, UI-021, TASK-002, PLT-004, LEAD-012, PTM-014, FLD-006, UI-020, END-016, AUTH-010, FLD-002, EDGE-013, CRUD-011, PLT-002, LEAD-006, PTM-013, CLS-005, UI-008, UI-010, UI-022, UI-015, UI-007, PRF-002, EDGE-004, PLT-005, EDGE-014, RPT-002, UI-019, CUS-007, CON-018, END-010

**Smoke** (each run of a pull request, 0): none

## 8. Suggested regression scope

For a change, run the cases of the module it touches, plus all P0, plus the cases guarding a defect. `GET /api/regression?ref=<requirement id>` selects the cases citing one requirement.

| Module changed | Cases to run |
| --- | --- |
| Accounts | ACC-004, ACC-003, ACC-009, ACC-006, ACC-005, ACC-010, ACC-002, ACC-001, ACC-007, ACC-008 |
| Customers | END-018, PRC-004, CUS-008, CUS-010, CRUD-004, CUS-011, END-017, CUS-003, CRUD-011, CUS-014, CUS-009, CUS-004, CUS-006, END-002, CUS-002, UI-024, CUS-012, LOY-001, CUS-005, CUS-007, CUS-001, CUS-013 |
| Leads | LEAD-001, UI-025, LEAD-005, LEAD-012, LEAD-002, SCR-001, LEAD-011, LEAD-014, LEAD-010, LEAD-006, FLD-008, END-013, LEAD-003, LEAD-009, INT-001, LEAD-007, LEAD-004, LEAD-008, LEAD-013, AUD-001 |
| Contracts | LIFE-003, SVC-001, LIFE-002, CON-015, END-001, LIFE-008, UI-031, CON-002, CON-004, END-005, END-014, CON-008, UI-020, END-016, PRC-003, CON-011, CON-021, LIFE-006, CNV-002, CON-003, DOM-001, CON-013, CON-020, CON-017, CON-006, CON-016, CON-009, CRUD-008, CON-001, CON-010, FLD-011, UI-026, PROMO-001, PTM-012, CODE-002, CON-019, CODE-001, DOM-002, CON-014, PTM-008, PTM-010, CNV-001, CON-005, CON-007, CRUD-002, END-004, SVC-002, CON-018, CON-022, CON-012, CRUD-003 |
| UI | UI-011, UI-009, UI-005, UI-013, UI-014, UI-012, UI-016, UI-002, UI-008, UI-003, UI-010, UI-006, UI-015, UI-001, UI-007, UI-004 |
| Platform | PLT-001, UI-023, MAN-004, PLT-004, FLD-001, FLD-006, OPT-002, FLD-005, PLT-003, FLD-002, GLB-004, PLT-002, FLD-007, OPT-001, TRASH-001, FLD-004, MAN-001, FLD-003, MAIL-001, MAIL-002, IMP-001, MAN-002, PLT-005, OPT-003, UI-019 |
| Permissions | RBAC-020, RPT-007, RBAC-005, RBAC-010, RBAC-019, RBAC-021, UI-029, RBAC-006, RBAC-004, RBAC-009, RBAC-015, RBAC-002, RBAC-024, RBAC-008, RBAC-016, RBAC-017, RBAC-023, RBAC-014, RBAC-018, RBAC-012, RBAC-022, MAN-007, FLD-012, RBAC-003, BKG-032, RBAC-011, RBAC-007, RBAC-001, RBAC-013 |
| Money | CRUD-010, END-009, LIFE-007, PTM-001, CHG-004, DOM-003, CHG-005, UI-027, LIFE-005, PAY-006, LIFE-004, PTM-005, PTM-003, PAY-001, CHG-006, PRF-001, CRUD-006, POUT-003, RND-001, LOCK-001, PAY-005, CRUD-001, PTM-002, MAN-006, FLD-010, END-007, PTM-016, CHG-003, PTM-006, PAY-004, CASH-003, PRF-002, PAY-002, XPT-001, PAY-007, SHOP-001, POUT-001, CASH-001, POUT-002, END-008, CHG-001, CHG-002 |
| Bookings | BKG-001, BKG-019, BKG-004, END-015, BKG-008, BKG-014, BKG-007, CHK-001, END-003, BKG-026, BKG-010, UI-028, BKG-024, BKG-009, BKG-012, BKG-025, BKG-030, BKG-018, BKG-028, BKG-029, BKG-006, BKG-005, BKG-027, CRUD-005, BKG-031, PTM-007, BKG-013, PTM-009, CHK-002, PTM-015, BKG-020, END-012, BKG-011, BKG-034, END-006, FLD-009, BKG-022, BKG-015, BKG-016, CHK-006, BKG-021, UI-017, MAN-003, BKG-003, BKG-002, BKG-017, BKG-035, MAN-008, END-019, BKG-023, BKG-033 |
| Business flows | LIFE-001, FLOW-018, FLOW-017, FLOW-005, MAN-009, FLOW-015, FLOW-001, FLOW-009, FLOW-010, MAN-005, FLOW-011, FLOW-019, FLOW-016, FLOW-012, FLOW-004, FLOW-008, FLOW-007, FLOW-006, FLOW-003, FLOW-014, FLOW-020, FLOW-013, FLOW-002 |
| Edge cases | EDGE-005, EDGE-006, EDGE-001, EDGE-003, EDGE-010, EDGE-011, EDGE-013, EDGE-008, EDGE-002, EDGE-009, EDGE-007, EDGE-012, EDGE-004, EDGE-014 |
| Tasks | TASK-005, UI-030, TASK-002, TASK-003, CRUD-009, TASK-001, END-011, TASK-004 |
| Employees | CRUD-007, EMP-001, EMP-002 |
| Exploratory | EXP-001, EXP-002, EXP-003, EXP-004 |
| Auth | AUTH-009, AUTH-002, AUTH-010, AUTH-001, SEC-001, AUTH-008, AUTH-003, AUTH-005, AUTH-004, AUTH-006, AUTH-007 |
| Reports | UI-021, RPT-005, RPT-001, PTM-014, XPT-002, PTM-004, RPT-003, XPT-003, RPT-004, PTM-013, RPT-006, UI-022, RPT-008, RPT-002, END-010, RPT-009 |
| Services | PRC-001, PRC-002, PRC-005, PRC-007, MAN-010, MAN-011, PRC-006, UI-018 |
| Configuration | GLB-001, GLB-003, GLB-002 |
| Classes | CLS-006, CLS-003, PTM-011, CLS-005, CLS-007, CLS-001, CLS-002, LIFE-009, CLS-008, CLS-004 |
| Workouts | WO-006, WO-003, WO-005, WO-001, WO-007, WO-002, WO-004 |
| Check-in | CHK-003, CHK-004, CHK-005 |

**Cases guarding a defect (0):** none.

**Unstable cases (0):** verdicts differed between runs of the same steps on the same environment and build; not trusted until the cause is known.

None.
