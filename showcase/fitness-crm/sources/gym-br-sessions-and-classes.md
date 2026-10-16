---
sourceId: GYM-BR-SESSIONS-AND-CLASSES
version: v1
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# BR-401 (Sessions and classes)
Booking never consumes a session (D-004, D-025).

# BR-402 (Sessions and classes)
A booking requires an approved, active contract with sessions left, not expired and not frozen, and inside the service's hours and limits (A-149). A PT's shift never limits it (D-058; OQ-001 interim: the session's day is within the contract dates, A-017).

# BR-403 (Sessions and classes)
A PT cannot have two sessions at once, and a customer cannot have two sessions at once, while the statuses hold the slot (A-024). Enforced by the database (T-014).

# BR-404 (Sessions and classes)
Each session status has one rule: consumes a session or not, credits the PT or not, and a color. Initial rules: Đã tập (yes, yes), Khách không đến (yes, yes), Hủy lịch (no, no), deleted (no, no). The rule applied is stored on the session (D-025, T-050).

# BR-405 (Sessions and classes)
"Đã tập" requires its own permission (admin by default) and is final (D-026).

# BR-406 (Sessions and classes)
A recorded session is corrected only by deleting it from the check-in history: reason required; one session refunded; PT credit removed; reports recomputed; moved to the trash; the customer emailed (D-026).

# BR-407 (Sessions and classes)
Deleting a session in a period already paid to the PT keeps the payout and adds a negative adjustment to the PT's next period (D-027).

# BR-408 (Sessions and classes)
Burn Show adds a session by hand with a mandatory reason; it consumes and credits like Đã tập and is marked "added by hand" (D-028).

# BR-409 (Sessions and classes)
Repeating a status change never consumes twice, also under concurrent requests (T-013, T-050).

# BR-410 (Sessions and classes)
Cancellation (Hủy lịch) has no time limit while the cut-off parameter is off (D-029).

# BR-411 (Sessions and classes)
Class enrollment is refused when the class is full or the group-class contract is out of sessions or expired. *Present* consumes one session of that contract; each class taught counts as a teaching session for the coach (D-031).
