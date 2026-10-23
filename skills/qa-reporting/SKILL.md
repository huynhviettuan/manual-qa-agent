---
name: qa-reporting
description: >
  Write and maintain QA bug reports and test-run reports: defect write-ups with severity, priority, evidence and a
  suggested fix; documentation and environment findings; retest rounds against named builds; a status summary at
  the latest run; and test reports grouped by suite or technique with real results only. Use whenever the user asks
  to report bugs or defects, write up findings, log a test round, retest or verify fixes, summarise a test run,
  produce a test report or QA status, or update an existing bug or test report. Not for stakeholder dashboards,
  showcase pages or metrics summaries built as web pages or slides: those are presentation work, not QA records.
---

# QA reporting

Two documents per product under test, both living documents updated round by round:

- **Bug report:** every finding with its current status, newest round first.
- **Test report:** what was run, against which build, and what it showed.

Templates for both are in [references/templates.md](references/templates.md). Read it before writing either.

## Rules

1. **Only real results.** Every pass, fail, count and duration comes from a run you actually did, against a build
   you name (branch and commit). Never estimate a result, carry one over from an earlier build without saying so,
   or mark something verified that wasn't retested.
2. **Name the oracle.** State the documents that define expected behaviour (requirements, contract, permission
   matrix, decisions), so each finding cites what it contradicts.
3. **Reproducible.** Each defect has the exact request or steps, the data used, what was expected (with its
   requirement ID) and what happened, quoted exactly: status, error code, message, value.
4. **Severity is not priority.** Severity is impact; priority is the order to fix in (P0–P4). A cosmetic bug on
   the sign-in page can be low severity and high priority. Defect priority is a different scale from a test case's
   priority (P0–P3, the order to run in, from the `manual-test-design` skill); don't copy one into the other.

   | Severity | Meaning |
   | --- | --- |
   | Critical | Data loss or corruption, money wrong, a security breach, or the product unusable for its purpose |
   | High | A main business function fails or gives a wrong result, with no acceptable workaround |
   | Medium | A function fails or misleads, but a workaround exists or the reach is limited |
   | Low | Incorrect but minor: an error contract detail, a wording or layout fault with no functional effect |
   | Trivial | Cosmetic, or tooling and environment only |
5. **Separate the kinds of finding:**
   - `BUG-nnn`: the product behaves wrongly.
   - `DOC-nnn`: the documentation is wrong, contradicts itself, or disagrees with a behaviour that is correct.
   - `ENV-n`: the test environment or tooling, not the product.
   - A spec gap (the documents are silent) is a question for the owner, not a bug; log it as needing
     clarification and link the open question.
6. **IDs are permanent.** Never renumber or reuse one. A regression of a fixed bug, or a fix that only covered the
   reported cases, gets a new ID linked to the old one ("follow-up of BUG-021").
7. **Retest is a round.** Each retest names the build, lists what was retested and the result per ID, and
   updates the status table. Verified fixed means retested on a named commit; say if that commit is only on a
   branch and not merged. A retest covers, in this order:
   - the original steps and data, exactly as reported;
   - the neighbouring cases of the same requirement (the regression set, for example `@req:<id>`);
   - the sweep or technique that found it, over the whole surface, because a fix often covers only the fields or
     operations named in the report (a partial fix becomes a new, linked finding);
   - the automated case that was marked as an expected failure, which must now pass, with the mark removed.
8. **Scope the impact honestly.** Say who is affected and who isn't (for example "the screens send every field, so
   only integrations are affected"), and how far the defect reaches (one operation, or a sweep showed about 70).
9. **No secrets or personal data.** Redact tokens, passwords and real customer records from requests, logs and
   screenshots; use the suite's synthetic data.
10. **Suggested fix is optional and brief:** the direction ("give the shared schemas a default error map"), not a
    patch, and only when the cause is clear.

## Bug report structure

1. Header table: product, build(s) per round, dates, reporter, oracle, environment, link to the test report.
2. **Status at the latest run:** the build and date, the open and verified-fixed counts, the latest suite result,
   open questions still with the owner, and a table of the findings that changed in the latest round.
3. Rounds, **newest first**: "Round N — <what it covered> — <date>": what was run, the result, then each new
   finding in full, or the retest results.
4. **Summary:** every finding ever, newest first: ID, title, severity, priority, type, status (with commit and
   round).

## Test report structure

1. Header: build tested, oracle, environment (and that nothing real or production was touched).
2. Automated suites: command, result, counts.
3. Configuration checks (for example seeded permissions against the documented matrix).
4. Cases by round, grouped by technique or area: ID, what was provoked, result (pass, or fail with the finding ID).
5. Findings: links to the bug report IDs.
6. Clean-up: what data the run created, where, and how to remove it.

## Statuses

Open · Fixed, awaiting retest · Verified fixed (commit, round) · Reopened · Needs clarification · Won't fix
(with who decided) · Not a defect (with the reason). Open questions stay in their own register until the owner
answers.

When a defect blocks a case in an automated suite, say so ("the case is marked as an expected failure until the
fix") so readers know why the suite is green.
