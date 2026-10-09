# 06 — Human-in-the-loop review system

**Status:** Proposed · **Goal:** Keep reviewers involved only where business judgment, authority or ambiguous evidence demands it.

## What requires review?

| Trigger | Severity | Default route | Reviewer |
| --- | --- | --- | --- |
| Ambiguous/non-measurable AC | Medium | Pause scenario design | Product owner / BA |
| Missing trusted knowledge | Medium | Retrieval retry, then review | QA engineer / BA |
| Conflicting business rule versions | High | Block affected case | Source owner |
| Low-confidence/inconclusive interpretation | Medium | Gather evidence, then review | QA engineer |
| Contradictory API/UI/DB evidence | High | Mark run inconclusive or failed as appropriate | QA lead / developer |
| Destructive user-data changes | High | Deny unless specifically approved and allowed | Authorized QA lead / admin |
| Any production write | Critical | Disabled by default, exception review | Authorized admin + owner |
| Security/privacy-sensitive suspected bug | High | Secure review; limited evidence access | Security/QA lead |
| Unclear visual discrepancy | Low–Medium | Human compare with approved design | QA engineer / designer |
| New rule proposed for trusted RAG | High | Require authoritative approval | Rule owner |

## Review task payload (conceptual)

```json
{
  "reviewId": "review_abc",
  "kind": "REQUIREMENT_CLARIFICATION",
  "projectId": "project_123",
  "status": "OPEN",
  "sourceReferences": ["AC-LOGIN-04@v3"],
  "question": "How many failed logins lock the account?",
  "recommendedAction": "PAUSE_SCENARIO",
  "risk": "MEDIUM",
  "proposedToolActionHash": null,
  "targetEnvironment": "staging",
  "assignedRole": "PRODUCT_OWNER",
  "policyVersion": "policy-1",
  "createdAt": "2026-10-09T00:00:00Z",
  "expiresAt": null
}
```

## Reviewer actions

- `APPROVE`: approve a specific case or proposed operation; capture reviewer and conditions.
- `REJECT`: record reason; the agent must not repeat the rejected action automatically.
- `EDIT`: save edits as a new version and require relevant revalidation.
- `REQUEST_INFO`: ask for further evidence; keep affected workflow paused.
- `ESCALATE`: assign to a role with domain/permission authority.

A clarification approval may lead to an authoritative updated requirement; approving one action **does not** grant ongoing access to an environment.

## Approval safety invariants

1. Approval is tied to user, project, target environment, action hash and expiry.
2. Approval is checked again immediately before execution; revoked/expired approvals cannot be replayed.
3. Human reviewer cannot approve actions outside their own RBAC scope.
4. No approval can override non-negotiable controls (cross-tenant access, exposed secrets, off-allowlist targets).
5. Related test drafts and run results are immutable snapshots; edits create revisions.
6. Reviewer is shown raw evidence securely, with redaction and limited-retention URLs when possible.

## Reviewer queue UX (MVP)

Each row displays task type, affected story/run, severity/risk, concise question, direct source links, suggested resolution, submitter, owner and age. The details page shows the original requirement and retrieved evidence side by side, model recommendation labeled "suggested", and approve/edit/reject. Search by project, status, assignee and age. No AI-only approval.

## Suggested service objectives (to agree with team)

- Critical risk: immediate escalation and execution held.
- High risk: human acknowledgment before follow-on external side effects.
- Medium/low: queues can be processed during normal QA triage.

Do not promise fixed response times until team ownership and notification integrations exist.

## Feedback into trusted RAG

1. Human reviewer selects approved authoritative document, not merely a chat answer.
2. System records who approved which `sourceId`/version and project scope.
3. Ingestion indexes new version and marks older one superseded (keep for audit).
4. Retrieval uses effective version and prevents cross-version mixing.
5. Regression evaluation compares outcomes before/after knowledge change.
