# Report templates

Replace the angle-bracket parts. Keep the section order; drop a section only when it would be empty.

## Bug report

```md
# <Product> — Bug report

| | |
|---|---|
| Product | <name and repository or URL> |
| Build | <per round: branch @ commit; say when a commit is only on a branch> |
| Date | <round 1 date; round N date: what it covered> |
| Reporter | <name or team> |
| Oracle | <documents defining expected behaviour> |
| Environment | <local/staging, database, services, email in log mode, seed used> |
| Full run report | <link to the test report> |

## Status at the latest run — <date>, <branch> @ `<commit>`

**Open: <n> (<IDs>). Verified fixed: <n> (<n> bugs, <n> documentation findings).**
<One paragraph: what the latest round did, the suite result on this build ("227 of 227 passed; the cases of BUG-022
and BUG-023 are marked as expected failures"), open questions still with the owner.>

| Id | Title | Severity | Status |
|---|---|---|---|
| **BUG-024** | <title> | Medium (P2) | **Open** (new, round 15) |
| BUG-020 | <title> | High (P1) | Verified fixed (`a981386`, branch, round 14) |

## Round <N> — <what it covered> — <date>

<What was run, on which build, and the result in one or two sentences.>

### BUG-<nnn> — <the wrong behaviour, stated as what the user sees>

**Severity:** <Critical|High|Medium|Low|Trivial> · **Priority:** <P0–P4> · **Type:** <Functional, API error
contract, Data integrity, Security, UI/layout, Accessibility, Localisation, Background job, Performance,
Documentation> · **Found by:** <case ID or charter, and how: "a sweep of every create with an empty body">

**Description** <What happens, where, and why it matters. Cite the requirement it contradicts.>

**Steps to reproduce**
1. <signed in as role X, with data Y>
2. <exact request or UI action>

**Expected** <with requirement ID> · **Actual** <quoted exactly: status, code, message, value>

**Evidence** <log lines, a table of affected operations, database facts read in a throwaway environment, screenshot
names; redacted>

**Impact** <who is affected, who is not, how widespread>

**Suggested fix** <optional, one or two sentences>

### Retest (in a retest round)

| Id | Build | Result | Notes |
|---|---|---|---|
| BUG-020 | `a981386` | Verified fixed | <what was checked, including the original steps and neighbouring cases> |
| BUG-021 | `a981386` | Partly fixed → BUG-022 | <the fix covered the reported fields only> |

## Summary

| Id | Title | Severity | Priority | Type | Status |
|---|---|---|---|---|---|
```

## Test report

```md
# <Product> — test report, <date>

Tested against <repository> at `<commit>` (<branch>), using <oracle> as the oracle.
Environment: <database, services, ports, seed>. No real data, no production, emails in log mode only.

## 1. Automated suites

| Suite | Command | Result |
|---|---|---|
| Lint | `<command>` | pass |
| Unit | `<command>` | pass — <n> tests |
| Independent suite | `<command>` | <n> of <n> passed (<n> cases, <n> automated; <n> expected failures for <IDs>) |

## 2. Configuration checks

<For example: seeded roles and permissions diffed against the documented matrix: <n> permissions × <n> roles, 0
differences.>

## 3. Round <N> — <date>: <scope>

**Result: <n> pass, <n> fail (<IDs>), <n> need clarification (<IDs>).**

### 3.1 <Technique or area, e.g. Boundary value analysis>

| Id | What was provoked | Result |
|---|---|---|
| BVA-01 | <the values tried> | pass — <the observed answers> |
| EP-04 | <...> | **fail — BUG-006** |

## 4. Findings

<Links to the bug report entries, one line each.>

## 5. Clean-up

<What the run created (tagged records, accounts), where, and the command that removes it; what was never touched.>
```

## Writing style

- Titles state the wrong behaviour plainly ("A malformed id answers 500 on two operations"), not the component.
- Quote the product's own words and codes exactly, in code formatting.
- Dates in one format throughout, with the timezone when time of day matters.
- Numbers you can count, counted ("136 field errors across about 70 operations"), never "many".
