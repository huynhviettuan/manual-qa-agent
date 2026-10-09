---
sourceId: AC-LOGIN
version: v1
sourceType: ACCEPTANCE_CRITERIA
trustTier: T1
approvalStatus: APPROVED
approvedBy: pilot-po
owner: pilot-po
productArea: authentication
releaseVersion: "2026.4"
ruleKeys: [login.lockout]
effectiveFrom: 2026-01-01
---
# AC-LOGIN-01
Signing in with a valid email and password redirects to the dashboard and shows "Welcome back".

# AC-LOGIN-02
Signing in with a wrong password shows "Invalid email or password" and does not reveal whether the email exists.

# AC-LOGIN-04
Accounts are locked after repeated failed sign-in attempts.
