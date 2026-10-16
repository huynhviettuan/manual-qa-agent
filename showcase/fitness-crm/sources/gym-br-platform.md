---
sourceId: GYM-BR-PLATFORM
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# BR-101 (Platform)
Every business record belongs to a branch; a user sees and acts only in the branches granted to them (D-014, D-017).

# BR-102 (Platform)
Results, statuses, categories, and reasons are chosen from option lists. "Khác" cannot be saved without a note. Deactivated options remain on old records (D-016).

# BR-103 (Platform)
Actions configured in the approval matrix take effect only after approval by someone other than the submitter. Overdue requests remind the approver and notify their superior (D-018).

# BR-104 (Platform)
Business data is never hard-deleted. Deletion requires a reason, moves the record to the trash permanently, and removes it from lists, reports, and revenue (D-035).

# BR-105 (Platform)
Codes are generated with configurable prefixes, are unique, and are never reused; imported legacy codes are kept (D-038).

# BR-106 (Platform)
Every create, update, delete, approval, and change of roles, permissions, thresholds, or configuration is audited with before and after values (T-048).

# BR-107 (Platform)
Accounts can sign in only within their allowed hours and days; sign-ins are recorded with device and IP (D-017).
