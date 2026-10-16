---
sourceId: GYM-AC
version: v1
sourceType: ACCEPTANCE_CRITERIA
trustTier: T1
approvalStatus: APPROVED
approvedBy: gym-po
owner: gym-po
productArea: gym-crm
effectiveFrom: 2026-01-01
---
# AC-01
An account without permission for a module does not see its menu and cannot reach it by direct URL; a role with phone numbers hidden never sees them on any screen or export. (milestone M1)

# AC-02
Admin changes permissions, approval thresholds, price tiers, timers, and session status rules on screen; changes take effect immediately, with no developer. (milestone M1, M4, M5)

# AC-03
Every consulting step result, checklist item, and reason is a drop-down; admin adds or deactivates an option on screen, the change shows immediately, and old data is unchanged. (milestone M1, M2)

# AC-04
Choosing "Khác" in any drop-down cannot be saved without a note. (milestone M1)

# AC-05
Actions in approval groups have no effect until approved; the submitter cannot approve them; admin switches approval on or off and changes approvers per action type on screen. (milestone M1, M4)

# AC-06
A lead created from the form gets the right channel and source, is assigned in the right round-robin order, and the manager is notified. (milestone M2)

# AC-07
Reminder steps at 60 minutes, 24 hours, 3 hours and 60 minutes before the visit, and 15 days are created at the right time; overdue steps appear in "Today's tasks" and count as late in the audit; the "Báo Studio" step creates a task for the coach manager. (milestone M2)

# AC-08
The consulting dashboard gives the right lead counts, booking rate, and show rate per consultant when compared with the Excel files of September and October 2026. (milestone M3)

# AC-09
One person goes through lead → appointment → show → contract → session with a single record. (milestone M2, M4, M5)

# AC-10
Entering any session count gives the right tier unit price, end date, and display name; a price different from the tier flags the contract "Exception price" and it cannot be activated until approved. (milestone M4)

# AC-11
An approved contract cannot be edited, even by admin; a contract not yet approved cannot be booked. (milestone M4, M5)

# AC-12
Deleting a contract with receipts is blocked and the receipts to delete first are listed; after deleting in the right order, total receipts and revenue fall by exactly the deleted amounts. (milestone M4)

# AC-13
Deleted data is in the trash with its reason, viewable only by management, and cannot be deleted. (milestone M1, M4)

# AC-14
A frozen contract cannot be booked or checked in; reactivation shows the frozen days and the proposed new end date; the end date changes only after admin confirms and is never extended twice; a freeze over 10 days reminds the manager. (milestone M4)

# AC-15
"Đã tập" and no-show reduce sessions left by exactly 1 and credit the PT; "Hủy lịch" and delete do not; each status shows its color; booking is refused when no sessions are left, the contract has expired, or times overlap. (milestone M5)

# AC-16
A session in "Đã tập" cannot change status; when admin deletes it, the customer gets exactly 1 session back and the PT exactly 1 credit less; if its period was already paid, the next period has an adjustment line. (milestone M5)

# AC-17
Every credited or refunded session sends exactly one email to the customer, from the template and in the right language, with its sending status stored in the customer profile. (milestone M6)

# AC-18
The PT revenue allocation report matches GymMaster's export on the same data; PT payout vouchers never pay a session twice. (milestone M5)

# AC-19
Each contract's paid amount and debt always equal the sum of its valid receipts; cash book closing balance equals opening balance plus receipts minus expenses. (milestone M4)

# AC-20
A customer's plans and every session log are visible in their profile, with plan and actual on the same row; choosing a Cardio exercise shows time, speed, and heart rate. (milestone M7)

# AC-21
Choosing Action "Stop + Escalation" notifies the manager and Master, and the item stays in the waiting list until handled; the weekly workout dashboard gives the right Flag and Action percentages. (milestone M7)

# AC-22
Data imported from GymMaster matches the number of customers, contract value, paid amounts, and sessions left. (milestone M9)

# AC-23
The lead, PT calendar, and session log screens work on a phone. (milestone M2, M5, M7)

# AC-24
A PT can book outside the on-duty shift, and the grid colors in-shift and off-shift time differently (D-058). (milestone M5)

# AC-25
A lead needs only a name and a channel; the country is chosen from the list of countries and the email goes in the language derived from it (D-057, D-060). (milestone M2)

# AC-26
Leads are shared by turn weight; a lead not taken care of after 1 working hour moves on, never outside 08:30–20:30, and each move is in the history and the dashboard (D-050, D-052). (milestone M2)

# AC-27
A ticked checklist step cannot be unticked; an overdue step past its grace period locks as "Không thực hiện" and cannot be ticked late (D-054). (milestone M2)

# AC-28
A task is reminded at all three points before its deadline through the bell, email, and phone, and a slow approval past 24 hours is told to the approver's direct manager (D-053, D-056, D-048). (milestone M2, M6)

# AC-29
Simulated scans through the API: a pair of the customer and the right PT within 15 minutes and the pairing window turns the session to *Đã tập* and triggers the session taken, the PT credit, and the email; a missing side hangs the session with the right reason; a scan with no booking is an error; a customer training twice with two PTs needs a pair for each (D-069, D-070). (milestone M5)

# AC-30
A session without a full check-in is notified to its PT at the end of the day, and to the Studio Manager with a task after 24 hours (D-071). (milestone M5, M6)
