---
sourceId: GYM-RBAC
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# Roles and permissions: Model

**Rules:**
- A menu or button without permission is hidden.
- The API checks the permission, branch, data scope, and masking on every request (T-046).
- Every change to roles, permissions, scopes, masks, thresholds, or the approval matrix is audited (T-048).

# Model: Role
| Element | Meaning |
|---|---|
| Role | A named set of permissions; admin creates, edits, and clones roles. |

# Model: Permission tree
| Element | Meaning |
|---|---|
| Permission tree | Groups per module, each with actions: view, create, edit, delete, approve, export. Groups: Catalogs, System, Leads and consulting, Customers, Contract operations, PT and class schedule, Workout plans, Tasks, Cash book, Employees, Reports. |

# Model: Individual overrides
| Element | Meaning |
|---|---|
| Individual overrides | A user inherits the role and can have single permissions switched on or off, so no role is named after a person. |

# Model: Data scope
| Element | Meaning |
|---|---|
| Data scope | Separate from functions: **all** or **only mine** for leads, members, contracts, PT schedule, receipts and expenses, staff, action history. Plus: see staff of all branches, see contract totals, see member debt. |

# Model: Field masking
| Element | Meaning |
|---|---|
| Field masking | Hide member phone, email, address, ID documents, and receipt list totals per role — on every screen and in every export. |

# Model: Sensitive actions
| Element | Meaning |
|---|---|
| Sensitive actions | Separate permissions: Đã tập, Burn Show, delete session, delete contract, delete receipt, edit receipt date, deactivate and reactivate contract, approve exception price, view trash, export Excel. |

# Model: Reports
| Element | Meaning |
|---|---|
| Reports | Each report and dashboard is its own permission. |

# Model: Branches
| Element | Meaning |
|---|---|
| Branches | Accounts are granted branches; the system is multi-branch from day one. |

# Model: Access hours
| Element | Meaning |
|---|---|
| Access hours | Allowed days and times to sign in, per account. |

# Model: Login history
| Element | Meaning |
|---|---|
| Login history | Time, device, and IP of each sign-in. |

# Roles and permissions: Default roles

There is no default Accountant role. Cash-book work (receipts, expense vouchers, PT payouts) is granted through Cash book permissions, for example to the Fitness Manager or to a custom role. Users of the Phases 0–4 Accountant role migrate to a custom role with those permissions (`25_BRIEF_V2_GAP_ANALYSIS.md`).

# Default roles: Admin
| Role | Does | Data scope |
|---|---|---|
| Admin | Full configuration, Đã tập check-in, deletions, trash, every report | All branches |

# Default roles: Fitness Manager
| Role | Does | Data scope |
|---|---|---|
| Fitness Manager | Receives new leads and escalations, reassigns leads, audits consulting, approves contracts and exception prices, receives "Báo Studio" tasks | Assigned branches |

# Default roles: Master
| Role | Does | Data scope |
|---|---|---|
| Master | Views and reviews every PT's plans, handles escalations, workout dashboard | Assigned branches |

# Default roles: Consulting
| Role | Does | Data scope |
|---|---|---|
| Consulting | Works assigned leads through the journey, creates contracts for approval | Own leads and customers |

# Default roles: PT
| Role | Does | Data scope |
|---|---|---|
| PT | Books sessions, writes plans, logs sessions, own session report | Own customers and schedule |

# Default roles: Receptionist
| Role | Does | Data scope |
|---|---|---|
| Receptionist | Walk-in leads, Show / No show, booking support, completes customer details | Assigned branches |

# Default roles: Marketing
| Role | Does | Data scope |
|---|---|---|
| Marketing | Lead reports by channel and source | No phone numbers or documents |

# Roles and permissions: Initial permission matrix

✓ = granted · own = only own data · — = not granted

# Initial permission matrix: Configuration (option lists, parameters, status rules, services, tiers, templates)
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Configuration (option lists, parameters, status rules, services, tiers, templates) | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Read services and price tiers (`service.view`, the user's branches)
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Read services and price tiers (`service.view`, the user's branches) | ✓ | ✓ | — | ✓ | — | ✓ | — |

# Initial permission matrix: Users, roles, permissions, approval matrix
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Users, roles, permissions, approval matrix | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Employees and PT working schedules
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Employees and PT working schedules | ✓ | ✓ | — | — | own schedule | — | — |

# Initial permission matrix: Leads: create
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Leads: create | ✓ | ✓ | — | ✓ | — | ✓ (walk-in) | — |

# Initial permission matrix: Leads: view, work the checklist
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Leads: view, work the checklist | ✓ | ✓ | — | own | — | ✓ | — |

# Initial permission matrix: Leads: reassign
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Leads: reassign | ✓ | ✓ | — | — | — | — | — |

# Initial permission matrix: Show / No show
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Show / No show | ✓ | ✓ | — | ✓ | — | ✓ | — |

# Initial permission matrix: Consulting audit
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Consulting audit | ✓ | ✓ | — | — | — | — | — |

# Initial permission matrix: Customers: view
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Customers: view | ✓ | ✓ | ✓ | own | own | ✓ | — |

# Initial permission matrix: Customers: edit details
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Customers: edit details | ✓ | ✓ | — | own | — | ✓ | — |

# Initial permission matrix: Contracts: create (pending)
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Contracts: create (pending) | ✓ | ✓ | — | ✓ | — | — | — |

# Initial permission matrix: Contracts: approve, exception price
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Contracts: approve, exception price | ✓ | ✓ | — | — | — | — | — |

# Initial permission matrix: Contracts: deactivate / reactivate, delete
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Contracts: deactivate / reactivate, delete | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Change vouchers: create
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Change vouchers: create | ✓ | ✓ | — | ✓ | — | — | — |

# Initial permission matrix: PT schedule: book, cancel
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| PT schedule: book, cancel | ✓ | ✓ | — | — | own | ✓ | — |

# Initial permission matrix: Đã tập, Burn Show, delete session
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Đã tập, Burn Show, delete session | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Classes: enroll, attendance
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Classes: enroll, attendance | ✓ | ✓ | — | — | own classes | ✓ | — |

# Initial permission matrix: Workout plans, session logs
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Workout plans, session logs | ✓ | ✓ | ✓ (review all) | — | own | — | — |

# Initial permission matrix: Escalations: handle
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Escalations: handle | ✓ | ✓ | ✓ | — | — | — | — |

# Initial permission matrix: Receipts: create
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Receipts: create | ✓ | ✓ | — | ✓ | — | ✓ | — |

# Initial permission matrix: Expense vouchers, PT payouts
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Expense vouchers, PT payouts | ✓ | ✓ | — | — | — | — | — |

# Initial permission matrix: Edit receipt date, delete vouchers
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Edit receipt date, delete vouchers | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Tasks: create and work
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Tasks: create and work | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

# Initial permission matrix: Trash: view
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Trash: view | ✓ | — | — | — | — | — | — |

# Initial permission matrix: Export Excel (one permission per list, A-077: `customer.export`, `lead.export`, `contract.export`, `payment.export`, `cash.export`, `task.export`; `user.export`, `audit.export`, `trash.export` for Admin only)
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Export Excel (one permission per list, A-077: `customer.export`, `lead.export`, `contract.export`, `payment.export`, `cash.export`, `task.export`; `user.export`, `audit.export`, `trash.export` for Admin only) | ✓ | ✓ (the first six) | — | — | — | — | ✓ (masked; Marketing has no list permissions yet) |

# Initial permission matrix: Reports (built so far: `report.consulting`, `report.consultingExport`, `report.leadAnalysis`, `report.leadAnalysisExport`, A-093; M4.7: `report.cashBook`, `report.incomeExpense`, `report.memberDebtExport` and their exports for Admin, Fitness Manager and Accountant; `report.contracts`, `report.exceptionPrices` and their exports for Admin and Fitness Manager; `cash.opening` for Admin only, A-138, A-139)
| Capability | Admin | Fitness Manager | Master | Consulting | PT | Receptionist | Marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Reports (built so far: `report.consulting`, `report.consultingExport`, `report.leadAnalysis`, `report.leadAnalysisExport`, A-093; M4.7: `report.cashBook`, `report.incomeExpense`, `report.memberDebtExport` and their exports for Admin, Fitness Manager and Accountant; `report.contracts`, `report.exceptionPrices` and their exports for Admin and Fitness Manager; `cash.opening` for Admin only, A-138, A-139) | all | all | workout dashboard | consulting (own) | own sessions | booking | lead analysis |

# Roles and permissions: Initial approval matrix (D-018)

Each role also has a **discount threshold** (`discountThresholdPct`, set on the role screen): the largest total discount, as a percent of the tier price, that it may approve itself; above it, the request escalates to the next level (A-112). Initially Admin 100%, Fitness Manager 10%, others 0% (OQ-038). `promotion.manage` (Admin) creates promotions and vouchers; staff with `service.view` see only the promotions on offer.
- Nobody approves their own submission.
- Requests pending longer than the configured time remind the approver and notify their superior.

# Initial approval matrix (D-018): Create and edit contracts, exception prices
| Action group | Approval | Approver |
|---|---|---|
| Create and edit contracts, exception prices | Yes | Fitness Manager; above the discount threshold, Admin |

# Initial approval matrix (D-018): Change vouchers: renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation
| Action group | Approval | Approver |
|---|---|---|
| Change vouchers: renewal, upgrade, hold, transfer, branch transfer, conversion, cancellation | Yes | Fitness Manager |

# Initial approval matrix (D-018): Receipts and expense vouchers
| Action group | Approval | Approver |
|---|---|---|
| Receipts and expense vouchers | Yes | Fitness Manager or Admin |

# Initial approval matrix (D-018): Deleting any business record; deactivating a contract
| Action group | Approval | Approver |
|---|---|---|
| Deleting any business record; deactivating a contract | Yes | Admin |

# Initial approval matrix (D-018): Editing a customer's identity (name, phone, email, documents)
| Action group | Approval | Approver |
|---|---|---|
| Editing a customer's identity (name, phone, email, documents) | Yes | Fitness Manager |

# Initial approval matrix (D-018): Creating and editing workout plans and templates
| Action group | Approval | Approver |
|---|---|---|
| Creating and editing workout plans and templates | Yes | Master |

# Initial approval matrix (D-018): Daily operations: lead entry, consulting steps, booking and cancelling, session logs, tasks
| Action group | Approval | Approver |
|---|---|---|
| Daily operations: lead entry, consulting steps, booking and cancelling, session logs, tasks | No (audit, admin check-in, and logs) | — (OQ-029) |

# Roles and permissions: Built so far (M1 slice 2, 2026-10-10)

Hideable customer fields so far: phone, email, ID document, health note, and (M2 slice 6, A-069) the address together with the emergency contact; nobody has the address hidden by default. The model above runs in the API (T-054) for the resources that exist today. Screens: **Administration → Users** (role, branches, per-user overrides, allowed hours, login history), **Roles** (permission tree, data scope, hidden fields, clone), and **Branches**.
Data-scope resources: leads (*only mine*: added by me or in my charge, T-061), customers, contracts, schedule, vouchers (*only mine* per A-029), staff (*only mine*: one's own employee profile and schedule, T-058), tasks (*only mine*: tasks one gave, got, or that went to one's department; Admin and Fitness Manager see all, T-060). Hideable fields: customer phone, customer email, customer ID document and health note (D-042; seeded per A-060), receipt totals.
Seeded roles (initial configuration, editable): Admin (everything), Fitness Manager (everything except deleting vouchers, the trash and history, and the System group), Master (view only), Consulting (*only mine*; customers, contract create, receipts), PT (*only mine*; schedule and session actions), Receptionist (customers, schedule, check-in, receipts; no contract create), Marketing (no permissions; phone and email hidden), and the custom role "Kế toán" migrated from the old Accountant (A-032). The rest of the tree (leads, approvals, status rules and other configuration, trash, reports, sensitive session actions) is added by the milestone that builds each module.

# Built so far (M1 slice 2, 2026-10-10): System
| Group | Permission keys |
|---|---|
| System | `user.manage`, `role.manage`, `branch.manage` |

# Built so far (M1 slice 2, 2026-10-10): Leads
| Group | Permission keys |
|---|---|
| Leads | `lead.view`, `lead.create`, `lead.manage` (edit and change status; Admin, Fitness Manager, Consulting, Receptionist; M2 slice 1), `lead.assign` (reassign, told of new leads; Admin, Fitness Manager), `lead.receive` (in the round-robin; Consulting; M2 slice 2), `lead.merge` (merge two records of one person; Admin, Fitness Manager; M2 slice 5, A-065), `script.manage` (the script library; Admin, Fitness Manager; M2 slice 6, A-072), `lead.audit` (the automatic consulting audit; Admin, Fitness Manager; M3 slice 2, A-084), `lead.untick` (remove the tick of a consulting step; Admin only; M2.7, A-102); `lead.assign` also switches a consultant's receiving and sets the turn weight (M2.7, A-100) |

# Built so far (M1 slice 2, 2026-10-10): Customers
| Group | Permission keys |
|---|---|
| Customers | `customer.view`, `customer.manage` |

# Built so far (M1 slice 2, 2026-10-10): Deactivation (M4.6)
| Group | Permission keys |
|---|---|
| Deactivation (M4.6) | `contract.deactivate` and `contract.reactivate` (Admin only, with a reason each) |

# Built so far (M1 slice 2, 2026-10-10): Receipts (M4.5)
| Group | Permission keys |
|---|---|
| Receipts (M4.5) | `payment.editDate` (edit a receipt's date, Admin only, always logged) besides `payment.view`, `payment.record`, and `payment.delete` |

# Built so far (M1 slice 2, 2026-10-10): Contract operations
| Group | Permission keys |
|---|---|
| Contract operations | `contract.view`, `contract.create`, `contract.approve` (and the matrix action `contract.create` decides who may), `contract.cancel`, `contract.unapprove` and `contract.delete` (Admin only, M4.4a), `contract.print` and `contract.note` (M4.4b: held by every role that sees contracts, and by every role that creates them) |

# Built so far (M1 slice 2, 2026-10-10): Check-in
| Group | Permission keys |
|---|---|
| Check-in | `checkin.review` (Admin, Fitness Manager), `checkin.devices` (Admin), `report.manualConfirmations` (Admin, Fitness Manager) |

# Built so far (M1 slice 2, 2026-10-10): Workout catalogs (M7.1)
| Group | Permission keys |
|---|---|
| Workout catalogs (M7.1) | `workout.view` (Admin, Fitness Manager, Master, PT), `workout.catalog` (Admin, Fitness Manager) |

# Built so far (M1 slice 2, 2026-10-10): Contract change vouchers (M8.1)
| Group | Permission keys |
|---|---|
| Contract change vouchers (M8.1) | `contract.change` (the roles with `contract.create`) raises one; each kind is its own approval action (`voucher.renewal`, `voucher.upgrade`, `voucher.hold`, `voucher.transfer`, `voucher.branchTransfer`, `voucher.conversion`, `voucher.cancellation`), all approved by the Fitness Manager or Admin and switchable by Admin (OQ-023) |

# Built so far (M1 slice 2, 2026-10-10): System status (A-321)
| Group | Permission keys |
|---|---|
| System status (A-321) | `system.view`: Admin; jobs, backups, the outbox, the check-in machines, and whether each server setting is on (never its value) |

# Built so far (M1 slice 2, 2026-10-10): Lead sources (M10.1)
| Group | Permission keys |
|---|---|
| Lead sources (M10.1) | `intake.manage`: Admin; a source's key is its own authentication (like a check-in machine's), for the website route only; the messages of a person need `lead.view` |

# Built so far (M1 slice 2, 2026-10-10): Tasks report (M9.1)
| Group | Permission keys |
|---|---|
| Tasks report (M9.1) | `report.tasks`, `report.tasksExport`: Admin and the Fitness Manager; the whole scope of tasks is needed |

# Built so far (M1 slice 2, 2026-10-10): Workout dashboard (M7.5)
| Group | Permission keys |
|---|---|
| Workout dashboard (M7.5) | `report.workouts` (Admin, Fitness Manager, Master); a customer's progress with `workout.view` (a PT: their own customers) |

# Built so far (M1 slice 2, 2026-10-10): Workout escalations (M7.4)
| Group | Permission keys |
|---|---|
| Workout escalations (M7.4) | read with `workout.view` (a PT: their own sessions'); mark seen with `workout.review`; told at once: users of the branch with `workout.review` |

# Built so far (M1 slice 2, 2026-10-10): Workout logs (M7.3)
| Group | Permission keys |
|---|---|
| Workout logs (M7.3) | `workout.log` (Admin, Fitness Manager, PT: own sessions); reads with `workout.view` |

# Built so far (M1 slice 2, 2026-10-10): Workout plans (M7.2)
| Group | Permission keys |
|---|---|
| Workout plans (M7.2) | `workout.plan` (Admin, Fitness Manager, PT: own plans), `workout.review` (Admin, Fitness Manager, Master); approval action `workout.plan` (Master and Admin) |

# Built so far (M1 slice 2, 2026-10-10): Staff notifications (M6.4)
| Group | Permission keys |
|---|---|
| Staff notifications (M6.4) | each employee's own choices and devices: any signed-in user; the mandatory marks: `config.manage` (Admin) |

# Built so far (M1 slice 2, 2026-10-10): Email templates (M6.2)
| Group | Permission keys |
|---|---|
| Email templates (M6.2) | `mail.template` (Admin only) |

# Built so far (M1 slice 2, 2026-10-10): PT payouts (M5.7)
| Group | Permission keys |
|---|---|
| PT payouts (M5.7) | `payout.view` and `payout.create` (Admin, Fitness Manager, Accountant); refused to a role with data scope "own" on the schedule or vouchers, or with receipt totals hidden |

# Built so far (M1 slice 2, 2026-10-10): PT reports and overview (M5.6)
| Group | Permission keys |
|---|---|
| PT reports and overview (M5.6) | `report.ptRevenue` and its export (Admin, Fitness Manager, Accountant), `report.bookings` and its export (Admin, Fitness Manager, Receptionist), `report.overview` (Admin, Fitness Manager, Accountant, Receptionist); none for a role with data scope "own" on the schedule; the PT revenue also needs receipt totals visible |

# Built so far (M1 slice 2, 2026-10-10): Class schedule (M5.5)
| Group | Permission keys |
|---|---|
| Class schedule (M5.5) | `class.view` (everyone who has `booking.view`), `class.manage` (Admin, Fitness Manager), `class.enroll` (Admin, Fitness Manager, Receptionist, PT of the class), `class.attend` (Admin, Fitness Manager, PT of the class) |

# Built so far (M1 slice 2, 2026-10-10): PT schedule
| Group | Permission keys |
|---|---|
| PT schedule | `booking.view`, `booking.manage`, `booking.delete` (Admin, Fitness Manager), `session.checkIn`, `session.complete`, `session.deleteHistory` (Admin), `session.burn` (Admin) |

# Built so far (M1 slice 2, 2026-10-10): Employees
| Group | Permission keys |
|---|---|
| Employees | `employee.view`, `employee.manage` (profiles and working schedules, M1 slice 6; were `trainer.*`) |

# Built so far (M1 slice 2, 2026-10-10): Cash book
| Group | Permission keys |
|---|---|
| Cash book | `payment.view`, `payment.record`, `payment.delete`, `cash.manage`, `cash.delete` |

# Built so far (M1 slice 2, 2026-10-10): Configuration
| Group | Permission keys |
|---|---|
| Configuration | `config.manage` (option lists, system parameters, and the consulting checklist; Admin only, M1 slice 3 and M2 slice 3) |

# Built so far (M1 slice 2, 2026-10-10): History
| Group | Permission keys |
|---|---|
| History | `audit.view` (action history), `trash.view` (Admin only, M1 slice 4) |

# Built so far (M1 slice 2, 2026-10-10): Tasks
| Group | Permission keys |
|---|---|
| Tasks | `task.view` (see and work on tasks), `task.create` (give tasks); every role (M1 slice 7) |

# Built so far (M1 slice 2, 2026-10-10): System
| Group | Permission keys |
|---|---|
| System | `approval.manage`: the approval matrix (Admin, M1 slice 5). Deciding a request needs no permission of its own: the matrix names the approver roles (D-018) |

# Roles and permissions: Job titles, roles, and reporting lines (D-046)

A job title is a position in the org chart; a role is a set of permissions. Admin gives each employee both. The departments and titles come with the system (M2.7); the table is the initial pairing, applied when the staff list is entered, not derived by code (A-098). "Reports to" is the initial value of the employee's direct manager.

# Job titles, roles, and reporting lines (D-046): CEO
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| CEO | Admin | none |

# Job titles, roles, and reporting lines (D-046): Trợ lý CEO
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Trợ lý CEO | (admin's choice) | CEO |

# Job titles, roles, and reporting lines (D-046): Studio Manager / Master
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Studio Manager / Master | Fitness Manager (Master added later) | CEO |

# Job titles, roles, and reporting lines (D-046): Operation Coordinator, Client Care
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Operation Coordinator, Client Care | Receptionist | Studio Manager / Master |

# Job titles, roles, and reporting lines (D-046): Coach Leader
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Coach Leader | PT | Studio Manager / Master |

# Job titles, roles, and reporting lines (D-046): Coach Advance, Junior, Rookie
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Coach Advance, Junior, Rookie | PT | Coach Leader |

# Job titles, roles, and reporting lines (D-046): Marketing Manager
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Marketing Manager | Marketing | CEO |

# Job titles, roles, and reporting lines (D-046): Content / Branding, Content Creator / Ads Performance, Media, Growth / Performance
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Content / Branding, Content Creator / Ads Performance, Media, Growth / Performance | Marketing | Marketing Manager |

# Job titles, roles, and reporting lines (D-046): Direct Sale / Online Demo Gym
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Direct Sale / Online Demo Gym | Consulting | Growth / Performance |

# Job titles, roles, and reporting lines (D-046): Kế toán trưởng
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Kế toán trưởng | Kế toán | CEO |

# Job titles, roles, and reporting lines (D-046): Kế toán Demo Gym
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Kế toán Demo Gym | Kế toán | Kế toán trưởng |

# Job titles, roles, and reporting lines (D-046): Demo Store titles
| Job title | Role (initial) | Reports to (initial) |
|---|---|---|
| Demo Store titles | (no accounts in phase 1) | the matching head |
