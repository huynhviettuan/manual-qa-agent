---
sourceId: GYM-BR-SERVICES-PRICES-CONTRACTS
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# BR-301 (Services, prices, contracts)
A contract's unit price, total, and end date are computed from the service's price tier for the number of sessions; nobody types a unit price. The display name is the service plus the real session count (D-021).

# BR-302 (Services, prices, contracts)
A price different from the tier, or a manual discount outside promotions and vouchers, is an exception price: reason required, approval required, both prices stored (D-021).

# BR-303 (Services, prices, contracts)
Promotions and vouchers apply to the tier price and are not exception prices (D-021).

# BR-304 (Services, prices, contracts)
A contract is created *Pending approval* and can be edited only while pending. Only an approved contract can be activated and booked (D-022). A contract the approver rejects is *Rejected* and has no effect; an approved one can be sent back to pending only with no receipts or sessions (A-121, A-124).

# BR-305 (Services, prices, contracts)
An approved contract is never edited, even by admin. Changes go through change vouchers (D-022, D-024).

# BR-306 (Services, prices, contracts)
A contract cannot be deleted while it has receipts (the system lists them), recorded sessions, or change vouchers. Deletion order: receipts first, then the contract (D-022).

# BR-307 (Services, prices, contracts)
Deactivation and reactivation require reasons. While frozen: no booking, check-in, or Burn Show, and no expiry. Reactivation proposes extending by the frozen days; admin accepts, edits, or declines with a reason; each freeze extends at most once. A freeze longer than 10 days creates a reminder task (D-023).

# BR-308 (Services, prices, contracts)
PT and Sale shares on a contract each total 100% (D-022).

# BR-309 (Services, prices, contracts)
Opening balances of imported contracts are set once and never edited (D-011).
