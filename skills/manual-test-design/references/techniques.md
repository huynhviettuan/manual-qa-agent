# Test design technique catalogue

## Black-box

| Technique | Purpose | When to use |
| --- | --- | --- |
| Equivalence partitioning (EP) | Split inputs into valid and invalid classes; test one representative of each | Input fields, categories, ranges |
| Boundary value analysis (BVA) | Values at and next to each boundary | Min/max, length, quantity, dates |
| Decision table | Each relevant combination of conditions and its resulting actions | Business rules, pricing, permissions |
| State transition | States, events, and valid and invalid transitions | Login lockout, orders, approval workflows |
| Use case | Main, alternative and exception flows | End-to-end business scenarios |
| Pairwise | Every pair of parameter values at least once | Browser, device, OS, configuration |
| Combinatorial | Chosen higher-order combinations of factors | Complex configurations and integrations |
| Cause–effect graphing | Map input conditions to outcomes through logic | Complex validation and business logic |
| Classification tree | Partition independent input dimensions, then combine the classes | Several independent input categories |
| Domain testing | Explore input domains, ranges and their edges | Numeric, date and string inputs |
| Syntax testing | Valid and invalid input structures | Email, phone, date, identifiers |
| Specification-based | Derive tests directly from documented requirements | Functional requirements, acceptance criteria |

### Worked patterns

- **EP + BVA for an integer field allowed from 1 to 1000:** partitions are below 1, 1–1000, above 1000, non-numeric
  and empty. Boundaries are 0, 1, 2, 999, 1000 and 1001. For a text field with a maximum length n, test 0, 1, n-1, n
  and n+1 characters, plus whitespace only.
- **Dates:** the day before, on and after each limit. Add month end, leap day and the timezone day boundary when the
  rule depends on "today".
- **Decision table:** one column per combination of conditions, with don't-care columns collapsed, and one case per
  column.
- **State transition:** build a state table (state × event → next state). Write one case per valid transition, and
  one per invalid event in each state; for those, the expected result is the rejection with the state unchanged. For
  risky workflows, add 1-switch sequences (two transitions in a row).
- **Permission matrix:** role × action. For each action, test the lowest role that is allowed and the highest role
  that is not (the privilege boundary). Check both the UI and direct URL or API access. Keep the expected matrix as
  a dated snapshot of the documented one, reviewed by hand when it changes; a difference from the product shows up
  as a failing case to review, never as a silently updated expectation. Beyond grants, cover data scope (own,
  branch, all), field masks, who may approve, role changes and per-user overrides, and anonymous callers. Change
  roles only on a role or user the test creates, never on seeded ones.
- **Exhaustive permission sweep (automated):** call every operation of the API contract as every role, with a
  random id and an empty body, so no call can change anything. A role holding the operation's permission must get
  past authorization (any answer but 401 or 403); every other role must get 403.
- **Syntax:** for each structural rule, test one valid form and one violation of that rule only.
- **Pairwise, verified:** list the factors and values with the reason for each value (for example "sessions: 1
  lower tier edge, 17 any count, 1000 upper tier edge"). Build the table (greedy is fine), then check by program that
  every pair of values appears at least once. Write down why pairwise keeps the intended coverage: each rule
  involved depends on at most two factors at a time. Example: 2 × 3 × 3 × 3 × 2 = 108 combinations covered by 12
  rows. If a rule depends on three factors, cover those three exhaustively.
- **Metamorphic relations:** when the exact output is hard to know, test a relation between two runs. Examples:
  paying a contract in two receipts leaves the same debt as one receipt of the sum; a report over a period equals the
  sum of its sub-periods; adding a filter never returns more rows; reordering input doesn't change a total; searching
  with and without accents finds the same record when search is accent-insensitive.
- **Account journeys:** one case per account type (each seeded role, and any job-title role built on one). It does
  that person's real daily work with real data, end to end, then tries the actions the role must be refused. These
  find gaps that a permission matrix misses: a step that needs a permission nobody in that job holds, or data the
  person can't see at the moment they need it.
- **Business flows:** cross-module flows from the customer's own scripts (lead → consultation → contract → first
  payment → bookings → sessions → payout), each named after the script item it follows, plus the negative branch at
  each hand-over.
- **Exploratory charters:** a mission, an area, a time box (for example 45 minutes) and the risks to probe; record
  what was tried, what was found and the follow-up cases. Use a charter where an automated check would be risky on a
  shared environment (for example an administrator removing their own rights).
- **Defect-based:** for each past defect, a case at the same pattern elsewhere (one field fixed → sweep every
  operation for the same fault).

## White-box (needs knowledge of the code or logic)

| Technique | Purpose |
| --- | --- |
| Statement coverage | Execute every executable statement |
| Branch/decision coverage | Exercise each decision outcome |
| Condition coverage | Make each Boolean condition true and false |
| Multiple condition coverage | Test combinations of condition outcomes |
| MC/DC | Show that each condition independently affects the decision |
| Path coverage | Exercise the execution paths |
| Loop testing | Zero, one, typical and maximum iterations |
| Data flow testing | Paths from where a variable is defined to where it is used |

## Experience-based

| Technique | Purpose |
| --- | --- |
| Error guessing | Predict defects from experience and past failures |
| Exploratory testing | Learn, design and execute together, in time-boxed charters |
| Checklist-based | Test against a predefined checklist |
| Defect-based | Target known defect patterns |
| Attack-based | Probe likely weaknesses and misuse cases |

Common error-guessing targets:
- empty and whitespace-only input; leading zeros; very long input;
- Unicode and diacritics; pasted values with trailing spaces;
- double submit; the back button after a submit; a session that expires mid-flow; concurrent edits; two requests at
  once that each pass a check only one should pass (double booking, consuming the last session twice);
- a malformed id in every path parameter (expect 400 or 404, never 500); a missing, `null` or wrongly typed field
  (expect a field error code, never the validator's raw sentence); wildcard characters (`%`, `_`) in search;
- phone numbers in every written form (+84, 0…, spaces, dots, brackets) matching the same person;
- timezone and date rollover; rounding; duplicate records; injection-like strings.

## Complementary approaches

| Approach | Purpose |
| --- | --- |
| Risk-based testing | Prioritise by the likelihood and impact of failure |
| Requirement-based testing | Map tests to requirements and acceptance criteria |
| Scenario-based testing | Test realistic business scenarios |
| Positive and negative testing | Valid inputs and permitted actions; invalid inputs and prohibited actions |
| Model-based testing | Derive tests from behavioural models |
| Mutation-oriented design | Check whether the tests would catch an injected logic change |
| Metamorphic testing | Check relationships between outputs |
| Regression test selection | Select the tests affected by a change |

These approaches complement the core techniques and overlap with them; they are not exclusive to manual testing.
