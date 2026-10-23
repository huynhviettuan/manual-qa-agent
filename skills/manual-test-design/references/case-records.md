# Case records, the requirement catalogue and open questions

How to keep a large case catalogue honest when people read it and an automated suite runs it. Patterns from a
233-case black-box suite whose catalogue covered all 284 requirement IDs of its product.

## The requirement catalogue

A dated snapshot of the product's requirement IDs, by kind, with the documents and the date or commit it was taken
from:

| Kind | Example IDs |
| --- | --- |
| Functional requirements | FR-CUS-001 |
| Business rules | BR-404 |
| Acceptance criteria | AC-23 |
| Decisions and assumptions the product documents | D-082, A-377 |
| Non-functional and API contract | NFR-SEC, API-ERR |

- A case citing an ID not in the catalogue is refused; this catches typos and stale references.
- Coverage is measured per ID: list the IDs that no case names, by kind. The target is zero, and every remaining
  gap is listed with its risk, never silently dropped.
- Refresh the snapshot deliberately (new date, reviewed diff), not by editing IDs to make cases load.

## The case record

One record per case, in the schema of `SKILL.md`. Fields that carry the most weight:

- **`basis`:** `specified` or `assumption`. With `assumption`, `assumptions` states exactly which expected result
  the documents don't support, for example "No body size limit is documented; the case only requires a 4xx, never a
  5xx".
- **`openQuestions`:** the IDs of the register entries the case depends on.
- **`level`:** `api`, `ui`, or `manual` (no black-box automation is possible; say why in notes).
- **`knownBug`:** an open defect blocks the expected result. An automated test of such a case is marked as an
  expected failure; it stays green while the bug is open and turns red the day the bug is fixed.
- **`refs`:** user stories, the customer's feedback or trial scripts, past defects, the product's own test IDs.
- **`smoke`:** part of the per-pull-request set.

Write the expected result for an assumption case so it is safe either way when you can: "any 4xx in the error
contract; a 5xx never".

## The open-question register

| Id | About (requirement IDs) | Question | Current behaviour (observed, not a requirement) | Cases |
| --- | --- | --- | --- | --- |
| Q-2 | FR-CUS-001 | What is a valid phone: which characters, how many digits? | After removing separators, '+' and 8–15 digits are accepted. | CUS-005, CUS-013 |
| Q-8 | D-023 | What does freezing an already frozen contract answer? | 200 with a single open freeze. | CON-009 |

- Ask one precise question per entry; the person who owns the requirement answers it, and the answer goes into the
  requirements, not only into the case.
- Record what the product does today, clearly labelled as observed. It gives the owner something concrete to accept
  or reject.
- When it is answered: update the requirement, switch the case's basis to `specified`, and remove the label.
- **Keep "current behaviour" current from the run, not by hand.** A test for an assumption case records what it saw
  as an annotation (for example `observed: freezing a frozen contract answered 200 with one open freeze`), and the
  generator copies those annotations into the case list and the register. When the product changes, the next run
  updates the observation, and the owner sees the latest behaviour when deciding.
- Don't test what an open question leaves undefined (for example "names up to 150 characters" when no limit is
  documented); record the question instead.

## One source, several views

Keep the case records in one machine-readable place (code or data files). Generate everything people read from
them, so the manual and automated views never drift:

| View | Contents |
| --- | --- |
| Test design document | The eight outputs of `SKILL.md`: analysis and open questions, techniques and why, coverage model, a link to the cases, traceability, gaps and assumptions, risk-based order, regression scope |
| Test case list | Every case in the body template, grouped by module, with its last execution |
| Test case CSV | One row per case, for a spreadsheet or a test-management import (columns below) |
| Traceability CSV | Requirement × case |

CSV columns, in this order: Test Case ID, Requirement ID(s), Title, Feature/Module, Technique(s), Test Type,
Priority, Preconditions, Test Data, Steps, Expected Results, Basis, Assumptions, Open Questions, Actual Result,
Status, Defect ID, Environment, Notes, Automation Candidate. Join list fields with line breaks inside the quoted
cell, and write a UTF-8 BOM so spreadsheet programs read accented text correctly.

The generator also checks the two views agree: every `api` or `ui` case has a test, every `manual` case has none,
and no test names an unknown case. Execution fields come only from the last real run's results file; with no run,
they read "Not Run".

## Regression scope

Two ways to select, both generated from the records:

- **By area changed:** a table of area → case IDs ("Contracts: pricing, approval, lifecycle → CON-001 … EDGE-014").
  Always add every P0 case.
- **By requirement:** tag each automated test with its requirement IDs (for example `@req:BR-404`), so a change to
  one requirement selects exactly its cases.
