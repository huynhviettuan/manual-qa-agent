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
| Classes | 10 | 0 | 10 | 0 |
| Services | 8 | 0 | 6 | 2 |
| Money | 42 | 12 | 41 | 1 |
| Tasks | 8 | 0 | 8 | 0 |
| Customers | 22 | 1 | 22 | 0 |
| Permissions | 29 | 10 | 28 | 1 |
| Business flows | 23 | 4 | 21 | 2 |
| Contracts | 51 | 5 | 49 | 2 |
| Workouts | 7 | 0 | 7 | 0 |
| Bookings | 51 | 7 | 48 | 3 |
| Auth | 11 | 2 | 11 | 0 |
| Accounts | 10 | 6 | 10 | 0 |
| Edge cases | 14 | 1 | 14 | 0 |
| Reports | 16 | 0 | 14 | 2 |
| Platform | 25 | 0 | 21 | 4 |
| UI | 16 | 0 | 15 | 1 |
| Leads | 20 | 0 | 19 | 1 |
| Check-in | 3 | 0 | 3 | 0 |
| Employees | 3 | 0 | 3 | 0 |
| Configuration | 3 | 0 | 3 | 0 |
| Exploratory | 4 | 0 | 0 | 4 |

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
| TASK-002 | Valid reminder hours are not bounded in the documents; 0, negative and 1000 hours are refused by the product | Q-12 |
| CUS-013 | The phone syntax is not documented (Q-2); the expected answers are the product's current ones | Q-2 |
| WO-005 | A-029 counts a customer as the PT's through a session only; the contract's PT does not count (OQ-093, answered as built by D-094) | — |
| AUTH-010 | No body size limit is documented; the product answers 400 VALIDATION_FAILED, and the case pins it | — |
| UI-007 | No layout rule is documented beyond AC-23 'works on a phone'; clipped amounts and sideways scrolling are taken as not working | — |
| FLD-009 | A-372: the value is HH:mm (H:mm taken), typed or picked; nothing documents a longest session | — |
| PLT-001 | The status for a malformed id is not documented; the product answers 404 NOT_FOUND, and the case pins it | — |
| CUS-007 | The email syntax accepted is not specified; both values are invalid under RFC 5322 | Q-4 |
| RPT-002 | Which periods besides week and month are refused is not documented; 'year' is expected to be refused (400) | Q-13 |
| CHG-006 | Whether a renewal may add sessions for 0 đ is Q-1: the case pins today's answer, not a requirement | Q-1 |
| EDGE-003 | D-082 allows a renewal of a 'running' contract; whether a frozen contract counts as running is not stated, so the case expects a refusal | Q-6 |
| CUS-012 | Accent-insensitive search is built but not stated in FR-CUS-003 | — |
| RBAC-002 | That authorization is checked before validation (403 even for an empty body) is not documented; it is how T-046 is built | — |
| PTM-014 | A-168 places a session on its scheduled day for the booking report and the overview; the documents do not say which day the manual-confirmation report uses. A-398 says the question of OQ-097 (Q-25) falls away, since a session is confirmed on its day or by Admin; the report's day for Admin's late confirmation stays as built | — |
| EDGE-004 | D-023 does not say whether a contract not yet approved can be frozen; refusing it is expected | Q-7 |
| END-016 | D-023 says 'more than 10 days'; the code reminds at exactly 10 × 24 hours; logged by the product as OQ-095 | — |
| LIFE-005 | A-223 says every figure uses the vouchers; it does not say whether that reaches sessions already paid at the old rate | Q-35 |
| LIFE-006 | Where the customer stays (Q-32) and whether the old branch's trainer may still be booked (Q-34) are open: the third expected result is today's behaviour, not a requirement | Q-32, Q-34 |
| SVC-001 | Whether a 0 đ price or a gap between ranges is allowed is not documented; the product accepts both (a gap leaves those counts unsellable, as CON-001 shows at 1001), and this case records it | — |
| CNV-001 | D-024 calls a conversion a change 'to another service or type'; A-229 keeps 'the contract's service … as sold'. The two readings differ: Q-37 | Q-37 |
| CUS-011 | The docs do not say how wildcard characters are searched; literal matching is what 'search by code, name or phone' means and what the fix of BUG-009 does | — |
| POUT-003 | What a payout answers when the take-back equals the credit exactly is Q-14: the case pins today's answer | Q-14 |
| PTM-015 | A-158 refuses 'a time that has not come yet' without saying whether the start or the end counts | — |
| BKG-004 | Only HH:mm 00:00–23:59 is documented as a time; that 23:59 is the latest end is inferred from it | — |
| CRUD-008 | That an inactive service is refused for a new contract is read from doc 07 (a service not on sale that day is serviceNotOnSale) and A-109's active flag; no document says it in so many words | — |
| CUS-010 | Whether such fields are refused (400) or ignored is not documented; the product ignores them (201), and the case pins that. A client-chosen code or id is never taken; a status no longer exists (D-101) | — |
| END-015 | The documents check the session's day against the contract dates (A-017) but are silent on confirming after the end; logged by the product as OQ-094 | — |
| CLS-002 | That a class session cannot be marked before it starts is built (CLASS_NOT_STARTED) but not stated in the documents | Q-11 |
| FLD-008 | T-064 states a CCCD of 12 digits or a passport, and a consent; no document states a passport's form, the earliest birth date or whether a birth date may be today, so those are checked as built | — |
| FLD-010 | A-002: whole đồng; doc 07 lets an amount come as a number or as text. How text is read (thousands marks) is checked as built | — |
| EXP-004 | What Admin may do to their own role and account is not documented beyond AUTH-006 (no self two-factor reset) | Q-17, Q-18 |
| PTM-003 | D-032 splits PT pay by the sessions actually taught; the documents never say what the PT shares' percentages are for | — |
| CON-009 | What a second freeze answers is not documented (Q-8); the case pins today's answer | Q-8 |
| BKG-028 | No document says whether a session may be moved into the past; today it may (a record corrected) | — |
| CUS-006 | No name length or character rule is documented; refusing control characters and 10,000 characters is the expected safe behaviour, not a stated rule | Q-3 |
| FLD-011 | A-111: the VAT percent is entered on the contract; no document sets its steps, so 8.5 is checked as built; the session and bonus limits follow the tiers' 1 to 1000 (FR-SVC-002) | — |
| CON-018 | No document says what the due date drives or bounds it (A-119: it 'records when the rest is due'); A-114 says enforcing the deadline was left to M4.6, which does not mention it | — |
| FLD-012 | No document states the password policy; the product's is checked as built: at least 10 characters, nothing else | — |
| EDGE-007 | The rounding of VAT is not documented; for whole-đồng values the case expects round(value × 8%) | Q-10 |
| PTM-008 | A-233 cancels the sessions 'still Booked from today on'; a checked-in session is still Booked, while a cancellation is refused during a session (D-010) | — |
| BKG-021 | Rules R1–R6 each break one condition and are specified; R7 breaks two at once, and which refusal wins is not documented (Q-15): the case records the current answer | Q-15 |
| BKG-018 | Which actions a cancelled session refuses is not listed; refusing every status change is the reading of D-025 (a cancelled session frees the slot and is final) | Q-9 |
| AUTH-009 | Doc 07 does not name the code for a malformed body; 400 VALIDATION_FAILED is what the product answers, and any 4xx in the error contract would meet API-ERR | — |
| PLT-002 | No page-size maximum is documented; 100 is the product's limit, so 101 is expected to be refused | Q-5 |
| CUS-005 | The phone syntax (digits, length) is not documented; letters and empty are clearly invalid, 3 and 40 digits are chosen as out of any phone length | Q-2 |
| FLD-007 | Doc 07 states lists take page and pageSize and days as dd/MM/yyyy, and that every field error is a key; no document sets the largest page. The code's limit is 100 (MAX_PAGE_SIZE), checked as built | — |
| CODE-002 | No document limits a code's uses: D-098 answered OQ-106 on the dates only (A-408), so the uses stay as built | — |
| CHK-005 | A-406 gives a customer only their own number, and staff any free code; neither rule says what happens when staff hold a customer's number | Q-41 |
| CRUD-001 | D-034 says a deleted voucher goes to the trash and the debt is recomputed; that it leaves the receipts list (rather than staying, marked) is assumed from A-125, which says so for a contract | — |
| PLT-005 | As PLT-001: 400 or 404 is not specified per operation; any 4xx meets the error contract, a 5xx never does | — |

**Stale cases (0):** approved against a source version that is no longer active.

None.

## 7. Risk-based execution order

Run in this order; stop and report on any P0 failure. P0 is money, double consumption, authorization bypass or silent data loss.

**P0** (48): PAY-001, CON-004, ACC-002, BKG-013, CASH-003, LIFE-001, LIFE-008, BKG-003, RBAC-003, PTM-007, PTM-001, FLOW-001, PAY-002, CUS-002, RBAC-013, END-007, CON-005, POUT-001, ACC-001, DOM-003, RBAC-017, RBAC-014, CON-006, RBAC-001, FLOW-014, FLOW-019, RBAC-004, RBAC-024, PAY-005, RBAC-007, PTM-006, ACC-004, EDGE-002, BKG-002, BKG-010, RBAC-009, PTM-005, RBAC-011, BKG-031, LIFE-004, BKG-011, ACC-003, ACC-008, ACC-005, AUTH-007, AUTH-002, CON-011, PAY-004

**P1** (154): PRC-001, RBAC-006, FLOW-002, RBAC-008, CODE-001, LIFE-007, BKG-016, BKG-006, RPT-003, WO-001, PLT-003, END-001, TASK-001, CON-010, BKG-027, PTM-012, FLOW-020, EDGE-005, AUTH-004, UI-004, LEAD-010, AUTH-003, FLOW-017, PTM-010, CHG-006, CHK-001, UI-027, RND-001, BKG-008, UI-001, SEC-001, CON-020, BKG-032, CLS-001, RBAC-002, FLOW-004, CHG-004, BKG-009, GLB-003, CON-022, CRUD-006, LEAD-013, ACC-009, LEAD-001, ACC-007, IMP-001, END-003, CASH-001, LOY-001, PRC-002, PRF-001, MAN-007, END-012, FLOW-008, CLS-003, CHG-002, LIFE-006, BKG-014, CON-015, RPT-006, RBAC-019, LIFE-003, CNV-001, CHK-006, RBAC-020, MAN-006, MAN-008, LOCK-001, MAIL-001, FLOW-005, PTM-002, POUT-003, CHG-001, LEAD-004, FLOW-018, CON-013, UI-002, CHG-005, CRUD-007, ACC-006, BKG-026, RBAC-012, LEAD-003, RPT-009, BKG-034, WO-003, PTM-009, EDGE-009, FLOW-016, DOM-001, UI-003, FLOW-013, FLOW-011, AUTH-001, MAN-005, RBAC-016, LIFE-002, UI-025, FLOW-007, CON-002, FLOW-010, EDGE-008, BKG-001, END-006, BKG-035, RBAC-010, BKG-029, FLD-008, FLD-010, BKG-005, EXP-004, RBAC-021, PAY-007, END-011, CUS-008, SHOP-001, PTM-016, INT-001, UI-011, CON-009, GLB-001, BKG-028, FLOW-003, FLOW-012, RBAC-015, CON-021, RBAC-022, BKG-021, RBAC-023, EXP-002, UI-006, RBAC-018, EDGE-001, XPT-003, CRUD-003, CUS-001, END-008, FLOW-015, PTM-004, CON-001, XPT-001, CON-007, CRUD-010, PRC-005, CUS-003, POUT-002, WO-002, PRC-003, OPT-002, FLOW-009, LEAD-009, BKG-015, CRUD-001, MAN-009

**P2** (141): CLS-008, CUS-013, END-018, WO-005, BKG-022, BKG-012, EDGE-012, RBAC-005, CLS-004, MAN-004, FLD-009, FLD-001, CON-016, UI-024, PLT-001, MAN-002, UI-026, RPT-001, CON-017, CLS-007, LEAD-008, PAY-006, CHK-004, BKG-033, BKG-007, UI-028, MAN-003, EDGE-003, EMP-001, CUS-012, AUD-001, CRUD-004, GLB-002, TRASH-001, CON-019, UI-014, TASK-003, RPT-005, GLB-004, TASK-004, CHK-003, UI-012, BKG-024, OPT-003, CRUD-005, UI-017, END-017, WO-006, UI-009, LIFE-005, PRC-006, MAN-011, LEAD-014, PRC-007, END-009, LIFE-009, UI-016, END-005, SVC-001, EDGE-006, CUS-011, LEAD-002, UI-029, END-013, EMP-002, FLD-004, WO-007, UI-005, CON-012, PTM-015, LEAD-007, CON-003, DOM-002, MAN-001, SVC-002, MAN-010, BKG-020, BKG-004, CUS-004, CRUD-008, CON-008, EDGE-010, LEAD-011, CUS-010, CON-014, CLS-006, END-002, END-015, FLOW-006, CLS-002, CHK-002, AUTH-005, RPT-007, CUS-009, LEAD-005, CNV-002, CRUD-002, PTM-003, BKG-023, BKG-019, RPT-008, END-014, TASK-005, EDGE-011, CRUD-009, AUTH-006, XPT-002, AUTH-008, END-004, CUS-006, FLD-011, END-019, FLD-012, EDGE-007, FLD-005, BKG-030, CUS-014, SCR-001, PTM-008, PRC-004, ACC-010, UI-018, UI-013, RPT-004, BKG-017, BKG-025, PROMO-001, FLD-003, PTM-011, WO-004, CHG-003, BKG-018, AUTH-009, CUS-005, EXP-001, FLD-007, OPT-001, CODE-002, CHK-005, MAIL-002, EXP-003

**P3** (33): TASK-002, AUTH-010, UI-007, UI-010, CUS-007, RPT-002, UI-019, PTM-014, EDGE-004, EDGE-013, END-016, FLD-002, UI-030, UI-031, PLT-004, UI-008, LEAD-006, PTM-013, END-010, UI-020, CLS-005, CRUD-011, EDGE-014, LEAD-012, FLD-006, CON-018, UI-021, UI-015, PLT-002, UI-023, PRF-002, UI-022, PLT-005

**Smoke** (each run of a pull request, 0): none

## 8. Suggested regression scope

For a change, run the cases of the module it touches, plus all P0, plus the cases guarding a defect. `GET /api/regression?ref=<requirement id>` selects the cases citing one requirement.

| Module changed | Cases to run |
| --- | --- |
| Classes | CLS-008, CLS-004, CLS-007, CLS-001, CLS-003, LIFE-009, CLS-006, CLS-005, CLS-002, PTM-011 |
| Services | PRC-001, PRC-002, PRC-006, MAN-011, PRC-007, MAN-010, UI-018, PRC-005 |
| Money | PAY-001, LIFE-007, CASH-003, PAY-006, CHG-006, UI-027, RND-001, PTM-001, CHG-004, CRUD-006, PAY-002, END-007, CASH-001, PRF-001, POUT-001, LIFE-005, DOM-003, CHG-002, END-009, MAN-006, LOCK-001, PTM-002, POUT-003, CHG-001, CHG-005, FLD-010, PAY-007, PAY-005, PTM-003, SHOP-001, PTM-006, PTM-016, PTM-005, LIFE-004, CHG-003, END-008, XPT-001, CRUD-010, POUT-002, PRF-002, PAY-004, CRUD-001 |
| Tasks | TASK-002, TASK-001, TASK-003, TASK-004, UI-030, END-011, TASK-005, CRUD-009 |
| Customers | CUS-013, END-018, UI-024, CUS-007, CUS-012, CRUD-004, CUS-002, LOY-001, END-017, CUS-011, CUS-004, CUS-010, END-002, CUS-009, CRUD-011, CUS-008, CUS-006, CUS-014, PRC-004, CUS-001, CUS-005, CUS-003 |
| Permissions | RBAC-006, RBAC-008, RBAC-005, RBAC-003, BKG-032, RBAC-002, RBAC-013, MAN-007, RBAC-019, RBAC-017, UI-029, RBAC-020, RBAC-014, RBAC-012, RBAC-001, RBAC-016, RBAC-010, RBAC-004, RPT-007, RBAC-024, RBAC-021, RBAC-007, RBAC-015, FLD-012, RBAC-022, RBAC-009, RBAC-023, RBAC-011, RBAC-018 |
| Business flows | FLOW-002, LIFE-001, FLOW-020, FLOW-017, FLOW-004, FLOW-001, FLOW-008, FLOW-005, FLOW-018, FLOW-016, FLOW-013, FLOW-011, FLOW-014, MAN-005, FLOW-019, FLOW-007, FLOW-010, FLOW-006, FLOW-003, FLOW-012, FLOW-015, FLOW-009, MAN-009 |
| Contracts | CON-004, CODE-001, LIFE-008, END-001, CON-016, CON-010, UI-026, PTM-012, CON-017, PTM-010, CON-020, CON-022, CON-019, CON-005, END-016, LIFE-006, CON-015, END-005, LIFE-003, SVC-001, CNV-001, UI-031, CON-006, CON-013, CON-012, CON-003, DOM-002, UI-020, SVC-002, DOM-001, CRUD-008, CON-008, LIFE-002, CON-002, CON-014, CNV-002, CRUD-002, END-014, CON-009, END-004, FLD-011, CON-018, CON-021, PTM-008, PROMO-001, CRUD-003, CON-001, CON-007, CODE-002, PRC-003, CON-011 |
| Workouts | WO-005, WO-001, WO-006, WO-007, WO-003, WO-004, WO-002 |
| Bookings | BKG-022, BKG-012, BKG-013, BKG-016, BKG-006, FLD-009, BKG-003, BKG-027, PTM-007, BKG-033, CHK-001, BKG-007, UI-028, BKG-008, MAN-003, BKG-009, BKG-024, CRUD-005, END-003, UI-017, END-012, BKG-014, CHK-006, MAN-008, PTM-015, BKG-026, BKG-034, BKG-020, PTM-009, BKG-004, END-015, BKG-001, END-006, BKG-035, BKG-029, CHK-002, BKG-005, BKG-023, BKG-019, BKG-028, END-019, BKG-002, BKG-030, BKG-010, BKG-021, BKG-017, BKG-025, BKG-031, BKG-011, BKG-018, BKG-015 |
| Auth | AUTH-010, AUTH-004, AUTH-003, SEC-001, AUTH-001, AUTH-005, AUTH-006, AUTH-008, AUTH-009, AUTH-007, AUTH-002 |
| Accounts | ACC-002, ACC-009, ACC-007, ACC-001, ACC-006, ACC-004, ACC-010, ACC-003, ACC-008, ACC-005 |
| Edge cases | EDGE-012, EDGE-005, EDGE-003, EDGE-004, EDGE-013, EDGE-006, EDGE-009, EDGE-010, EDGE-008, EDGE-014, EDGE-011, EDGE-002, EDGE-007, EDGE-001 |
| Reports | RPT-003, RPT-001, RPT-002, PTM-014, RPT-005, RPT-006, PTM-013, END-010, RPT-009, RPT-008, XPT-002, UI-021, RPT-004, XPT-003, PTM-004, UI-022 |
| Platform | PLT-003, MAN-004, FLD-001, PLT-001, MAN-002, UI-019, TRASH-001, GLB-004, OPT-003, IMP-001, FLD-002, PLT-004, MAIL-001, FLD-004, MAN-001, FLD-006, FLD-005, FLD-003, PLT-002, UI-023, FLD-007, OPT-001, OPT-002, MAIL-002, PLT-005 |
| UI | UI-007, UI-010, UI-004, UI-001, UI-014, UI-012, UI-009, UI-016, UI-008, UI-005, UI-002, UI-003, UI-011, UI-013, UI-006, UI-015 |
| Leads | LEAD-008, LEAD-010, AUD-001, LEAD-013, LEAD-001, LEAD-014, LEAD-002, END-013, LEAD-006, LEAD-004, LEAD-007, LEAD-003, LEAD-011, UI-025, FLD-008, LEAD-005, LEAD-012, INT-001, SCR-001, LEAD-009 |
| Check-in | CHK-004, CHK-003, CHK-005 |
| Employees | EMP-001, EMP-002, CRUD-007 |
| Configuration | GLB-002, GLB-003, GLB-001 |
| Exploratory | EXP-004, EXP-002, EXP-001, EXP-003 |

**Cases guarding a defect (0):** none.
