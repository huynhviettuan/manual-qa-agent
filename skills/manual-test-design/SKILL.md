---
name: manual-test-design
description: >
  Design manual test cases from requirements with formal test-design techniques (equivalence partitioning, boundary
  values, decision tables, state transitions, use cases, permission matrix, pairwise, metamorphic, syntax, error
  guessing, exploratory charters and more), with a requirement catalogue, open questions, traceability, coverage
  gaps, risk-based priority and regression scope. Use whenever the user asks to write, design, generate or review
  manual test cases, test scenarios or test conditions from a user story, acceptance criteria, a Jira ticket, a spec
  or a PRD; asks which test-design techniques apply; asks for a traceability matrix, coverage analysis or regression
  scope; or keeps a case catalogue that both people and an automated suite use.
---

# Manual test case design

Goal: test cases that are traceable, reproducible, non-redundant, risk-aware and verifiable. Choose techniques by
the structure of the requirement, not to maximise the number of cases. Read these when the work is more than a few
cases:

- [references/techniques.md](references/techniques.md): the technique catalogue with worked patterns (boundaries,
  verified pairwise, metamorphic relations, account journeys, charters).
- [references/case-records.md](references/case-records.md): the full case schema, the requirement catalogue, the
  open-question register, and generating the manual documents and CSVs from one set of case records.

## Rules

1. Requirements and approved acceptance criteria are the source of truth. Never invent a business rule or assert an
   expected result the requirement does not support.
2. Every case has a **basis**: `specified` (each expected result follows from the cited requirements) or
   `assumption` (at least one does not; say which, in the case). An assumption is never presented as a requirement.
3. A material gap (a missing limit, message, role, rounding, precedence) becomes an **open question** in a register,
   with the product's current behaviour recorded as *observed, not a requirement*. Until it is answered, the cases
   that depend on it check today's behaviour, labelled as such.
4. Combine techniques where they give complementary coverage. Cover positive and negative cases.
5. Test boundaries systematically wherever a numeric, length, date or ordered constraint exists. Don't test a
   boundary the documents don't state (for example a name length); record the question instead.
6. Cover condition combinations (decision table) and states with their invalid transitions (state transition).
7. Use realistic test data: valid, invalid, edge and malformed. Never real personal data or real credentials.
8. Every expected result is specific and observable: an exact status, error code, message, value, state or URL.
   Never "works correctly" or "shows an error".
9. Trace every case to at least one requirement ID from a requirement catalogue. A case citing an unknown ID is
   wrong, not the catalogue.
10. Design-time cases are not executed tests. Execution fields (actual result, status) come only from a real run;
    never fabricate a Pass.
11. Use pairwise reduction only when it keeps the intended interaction coverage, and verify that every pair is
    covered. Never claim exhaustive coverage unless the stated coverage model is satisfied.

## Choosing techniques

| Requirement structure | Techniques |
| --- | --- |
| Input fields, categories, ranges, lengths | Equivalence partitioning + boundary value analysis (+ domain testing) |
| Structured inputs (email, phone, date, identifiers) | Syntax testing + equivalence partitioning |
| Several conditions decide an outcome (rules, pricing) | Decision table; cause–effect graph when the logic is complex |
| Roles and permissions | Permission matrix (role × action), including the privilege boundary and data scope |
| Each kind of user's real work | Account journeys: the role's daily work end to end, then the actions it must be refused |
| Stateful workflow (lockout, order, approval) | State transition: every valid transition plus the invalid ones |
| End-to-end business behaviour | Use case (main, alternative, exception flows) + scenario-based flows across modules |
| Many configuration parameters | Pairwise (verified) / combinatorial; classification tree |
| Outputs whose exact value is hard to know (totals, reports, search) | Metamorphic relations between outputs |
| Unspecified edge cases, known weak spots | Error guessing, defect-based (past bugs), attack-based, exploratory charters |
| Code or logic available | White-box: branch, condition, MC/DC, loop, data flow |

## Priority

Case priority is the order to run in, on a P0–P3 scale. It is a different scale from a defect's priority (P0–P4,
the order to fix in) and from severity (impact); those belong to the bug report (`qa-reporting` skill). Adapt to
the project's convention; by default:

- **P0, release-blocking:** money wrong, something consumed twice, an authorization bypass, silent data loss.
- **P1:** a major business function, or a high-risk failure.
- **P2:** a normal functional failure.
- **P3:** minor or cosmetic.

Mark a small smoke set (one or two cases per critical flow) for every pull request.

## Workflow

1. **Analyse the requirements.** Build or update the requirement catalogue (IDs by kind: functional requirements,
   business rules, acceptance criteria, decisions). List actors, preconditions, inputs, constraints, rules, outputs.
   Flag ambiguous, missing and conflicting items, and open questions for the material ones.
2. **Model them.** Extract fields with their valid ranges, states and events, conditions, roles and scopes,
   workflows, and the customer's own requests (feedback, trial scripts) as references.
3. **Select techniques** with the table above, and say why each applies.
4. **Derive the test conditions and a coverage model.** Write the design artifacts: partition and boundary tables,
   decision tables, state tables, the pairwise table with its factors, the permission matrix.
5. **Write the test cases** from those conditions, in the schema below. Keep each independently executable where
   practical, and decide its level: `api`, `ui`, or `manual` when it can't be automated (say why).
6. **Validate coverage.** Every case maps to catalogue IDs; every catalogue ID is named by at least one case, or is
   listed as a gap with its risk. Check that every partition, boundary, rule column, state and transition is
   covered. Remove duplicates unless they serve a different coverage objective.
7. **Prioritise and order** by risk, and write the regression scope: area changed → cases to run.
8. **Review.** Check each expected result against its requirement; list assumption-based cases with their
   assumption; flag missing test data and environment needs.

## Test case schema

Required: Test Case ID · Requirement ID(s) · Title · Feature/Module · Technique(s) · Test Type(s) (positive,
negative, boundary, security, concurrency, end-to-end, regression, UI, accessibility) · Priority · Preconditions ·
Test Data · numbered Steps · observable Expected Results · Basis (specified or assumption, with the assumptions) ·
Open questions (if any) · Level (api, ui, manual).

Optional: References (user stories, customer feedback, defects) · Known bug (an open defect blocks the expected
result) · Smoke · Notes. Execution fields, filled only from a run: Actual Result · Status (Not Run, Pass, Fail,
Blocked) · Defect ID · Environment · Automation Candidate.

Body template:

```
**Requirement(s):** AC-2, BR-14 · **Basis:** specified
**Technique:** Boundary value analysis · **Type:** Negative, boundary · **Priority:** P1 · **Level:** api
**Precondition:** [required state]
**Test data:** [values, and the partition or boundary each one represents]

**Steps:**
1. [action] → **Expected:** [observable result]
2. [action] → **Expected:** [observable result]
```

## A finished case, for scale

```
CON-007 — A contract of 1001 sessions is refused at the top tier boundary
Requirement(s): BR-301 (tiers 1–1000) · Basis: specified
Technique: Boundary value analysis · Type: Negative, boundary · Priority: P1 · Level: api
Precondition: a customer with no contract; service "PT" (tier 1–1000 sessions)
Test data: sessions = 1001 (first value above the top tier); 1000 is covered by CON-006

Steps:
1. As Consulting, POST /contracts with service PT, sessions 1001 → Expected: 400 VALIDATION_FAILED with a
   field error on sessions; no contract is created (GET /customers/{id}/contracts is unchanged).
```

Traceability row: `BR-301 → CON-005 (0), CON-006 (1000), CON-007 (1001), CON-013 (pairwise)`. Gap entry when a
limit is unknown: `Q-3: name length not documented; CUS-006 checks today's behaviour (10,000 chars refused)`.

## Output

Unless the user asks for less, produce these in order:
1. Requirement analysis: the catalogue counts by kind, ambiguities, and the open-question register.
2. The selected techniques and why.
3. Test conditions and the coverage model (the design tables).
4. Detailed test cases.
5. A requirement-to-test traceability matrix.
6. Coverage gaps (IDs no case names), assumption-based cases with their assumption, environment assumptions.
7. A risk-based execution order (P0 first; stop and report on a P0 failure) and the smoke set.
8. A regression scope: a table of area changed → cases, and how to select one requirement's cases.

Keep it proportionate: for a small change, a few well-chosen cases plus the traceability and gaps sections are
enough. When the cases will also be automated, keep one set of case records and generate the documents from it
(see [references/case-records.md](references/case-records.md)), so the manual and automated views never drift.

## What a pilot and an agent added (2026-10)

From designing 376 cases for a live product and comparing an agent's drafts with them, condition by condition
(manual-qa-agent ADR-0022 to ADR-0024):

- **Quote the evidence.** Every expected result carries a verbatim quote from the cited source it follows from; a
  result with no quote is an assumption, however confident it reads. A reviewer checks the quote, not the prose.
- **Draft the clear clauses, ask about the rest.** A criterion with one unclear clause still has testable clauses;
  quote them verbatim and design them now, and leave the unclear one to a question. Routing the whole criterion to
  a question left 11 clear clauses in 7 criteria undesigned.
- **Where people out-design the agent:** boundaries beyond the stated range (0 and non-numeric counts, 151-character
  names), the other column of a decision table (the choice that needs no note), and adjacent permission layers
  (signed-out access, actions inside a module, the API). Put those in every design, by name.
- **A requirement id is a dated snapshot.** A case citing an id not in the catalogue does not load; when the text
  behind an id changes, the cases approved before the change are stale and say so.
- **Measure, do not calibrate.** A checker tuned on the cases it is scored on shows it handles those shapes, not
  its accuracy; an "observability" check that is purely lexical flagged 16 % of human-written expected results,
  nearly all falsely. Keep such checks advisory and measure them on a held-out set.
- **Import what the team has.** A catalogue in the 20-column workbook loads as it is; what cannot be mapped (ids
  without a number, techniques outside the list) is reported and flagged on the case, never coerced.
