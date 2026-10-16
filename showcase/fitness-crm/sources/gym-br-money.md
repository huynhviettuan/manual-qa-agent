---
sourceId: GYM-BR-MONEY
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# BR-601 (Money)
Collecting money on a contract always creates a receipt (D-034).

# BR-602 (Money)
Paid amount, debt, and payment status are computed only from valid receipts (approved, not deleted) plus the opening paid amount (D-034, D-011).

# BR-603 (Money)
Receipt and expense amounts are greater than zero.

# BR-604 (Money)
A receipt may not take the paid amount above the contract value (OQ-003 interim).

# BR-605 (Money)
Editing a receipt's date is a separate permission and is always logged (D-034).

# BR-606 (Money)
A refund on cancellation is an expense voucher linked to the contract (D-024, D-034).

# BR-607 (Money)
PT revenue = credited sessions × (allocation value ÷ (sessions bought + bonus)) × commission rate × timesheet rate; several PTs on one contract split by sessions taught (D-032).

# BR-608 (Money)
A payout voucher stores the period and the sessions paid; a session is never paid twice (D-032).

# BR-609 (Money)
Cash book closing balance = opening balance + receipts − expense vouchers, per method and branch (D-034).
