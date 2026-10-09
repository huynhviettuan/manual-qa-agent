---
sourceId: SPEC-RESET
version: v3
sourceType: SPECIFICATION
trustTier: T1
approvalStatus: APPROVED
approvedBy: pilot-po
owner: pilot-po
productArea: authentication
ruleKeys: [reset.link.expiry]
effectiveFrom: 2026-02-01
---
# AC-RESET-01
A password reset link expires 24 hours after it is issued; opening an expired link shows "This link has expired".

# AC-RESET-02
The reset email is sent within 60 seconds of the request (POST /api/password-reset).
