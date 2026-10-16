---
sourceId: GYM-BR-LEADS-AND-CUSTOMERS
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# BR-201 (Leads and customers)
One person has one record; a lead becomes a customer at Show and keeps its ID (D-019).

# BR-202 (Leads and customers)
A new lead or contact with a phone number already in use triggers a duplicate warning and a merge proposal; no second record is created (D-019). Built (M2 slice 5): the quick form answers `DUPLICATE_PHONE`; "Gộp vào hồ sơ này" adds the new inquiry to the existing lead or customer; managers merge two existing records (A-063 to A-068).

# BR-203 (Leads and customers)
Leads are assigned round-robin to active consultants of the branch; managers may reassign (D-020, OQ-017).

# BR-204 (Leads and customers)
Refused requires a reason. Refused, No response, and No show leads enter the re-care queue with a contact-again date (initially 15 days) and are never closed (D-020, OQ-018). The next contact-again day is `recareDays` after today every time (A-062); the lead stays with its consultant, who and the managers are notified (M2 slice 5).

# BR-205 (Leads and customers)
Each consulting step creates a task with a deadline from the checklist; its result is a drop-down; it is marked on time, late, or skipped. Checklist changes apply only to new leads (D-020).

# BR-206 (Leads and customers)
Converting to a customer requires ID card/passport, birth date, nationality, and email (brief §4.1, D-036).

# BR-207 (Leads and customers)
Customer status is derived from contracts: training, expiring soon, expired, on hold, no contract (D-040).
