# Case-driven black-box suites

Patterns from an independent API-and-UI suite (233 cases, 219 automated) for a product it could reach only as a user
does: over HTTP and in a browser. Every rule is stated tool-agnostically; the code samples are **labelled
Playwright/TypeScript examples**, so translate them for other stacks.

## 1. Black-box independence

- Import nothing from the product's repository, read none of its databases, and rely on none of its demo data or its
  own test fixtures. Prepare what the suite needs **through the product's own API**, so the suite can point at any
  environment (local, staging).
- An **idempotent bootstrap** command, run once per environment, makes the suite's own accounts (one per role, with
  passwords regenerated each time), reference data (services, lookups) and anything else every test needs. It writes
  them to a git-ignored folder. Running it twice changes nothing.
- The environment needs only an address and one administrator account (with its second factor, if required).

## 2. The case registry drives the tests

Keep one record per case (ID, requirements, techniques, types, priority, steps, expected results, basis, level,
known bug; see the `manual-test-design` skill). A test is declared **by case ID** and takes its title, tags and
annotations from the record, so no test can exist without its documented case.

```ts
// Playwright/TypeScript example
export function qa(id: string, body: Body): void {
  const spec = caseById(id); // throws for an unknown id
  const details = {
    tag: [`@${spec.module}`, `@${spec.priority}`, ...(spec.smoke ? ["@smoke"] : []),
          ...spec.requirements.map((r) => `@req:${r}`)],
    annotation: [{ type: "requirements", description: spec.requirements.join(", ") }],
  };
  (spec.knownBug ? test.fail : test)(`${spec.id}: ${spec.title}`, details, body);
}
```

- **Tags select runs:** by priority (`@P0`), module, smoke, or requirement (`@req:BR-404` selects the regression set
  of one requirement).
- **Known bug = expected failure.** A case whose expected result an open defect blocks is marked as expected to fail.
  It stays green while the defect is open, and turns red ("expected to fail, but passed") the day it is fixed: the
  signal to remove the mark. Never skip such a test, and never weaken its assertion to make it pass.
- **A consistency check** (in the generator or CI) fails when an automated case has no test, a manual case has one,
  or a test names an unknown case.

## 3. Domain assertions

Wrap the raw status checks in matchers that read as the rule being checked and print the answer on failure:

```ts
// Playwright/TypeScript example
await expect(await api.contracts.create(body)).toAnswer(409, "CONTRACT_NOT_APPROVED");
await expect(result).toBeRefused("PHONE_ALREADY_USED"); // any 4xx with that code
await expect(result).toSucceed();
// failure message: expected 409 CONTRACT_NOT_APPROVED, got 200 {"id":"…"}
```

## 4. The HTTP client

- One client per signed-in actor, holding its own cookies, sending what a browser on the app would send (for
  example the app's own Origin on state-changing calls).
- It returns status, parsed body and the product's error code; it never throws on a 4xx or 5xx, so tests assert on
  them.
- **Retry only a known, harmless signature**, for example an *empty* 5xx from a proxy while the API restarts. A real
  server error (with a body) always reaches the test. Never add blanket retries.

## 5. Sessions and contention

- Sign in **once per role per run** in a setup project and save the session; every test reuses it. Only the case
  whose subject is signing in uses the sign-in form.
- **A budget shared by the whole machine** (a sign-in throttle, a lockout counter) belongs to a serial project, so
  parallel tests never consume it. A lockout test waits the throttle out instead of counting a throttled attempt as
  a failed one.
- **Give each test the scarce resources it competes for.** If tests book slots on a calendar, each test makes its
  own trainer (or resource) and books on its own planner, instead of sharing one calendar across workers.

## 6. Test data and teardown

- A **data factory** per test makes the records the test needs, tags each with the test's tag (for example
  `QA<random>`), and registers how to undo each one.
- A **cleanup registry** runs after the test whatever its outcome: steps run last-in-first-out, each once; a failing
  step doesn't stop the others; all failures are reported together. Order fixtures so the API clients are still
  open while teardown runs.

```ts
// Playwright/TypeScript example: the fixture runs teardown after use(), even when the test failed
cleanup: async ({ as }, use) => { void as; const c = new Cleanup(); await use(c); await c.runAll(); },
```

- When the product **never hard-deletes**, teardown is what the product allows (disable users, deactivate
  trainers); the rest stays, tagged. Say plainly that the suite needs a disposable environment.
- **Global configuration** a test changes (approval rules, system parameters) goes through a settings guard: snapshot
  before the change, register the restore, and verify the restore succeeded. Those tests run in the serial project.

## 7. Project order

| Project | Contents | Parallel |
| --- | --- | --- |
| setup | Sign in once per role, save sessions | — |
| api | Cases that touch only data they own | Fully |
| serial | Cases that change global configuration, or use a machine-wide budget | One file at a time, each serial; after api |
| ui | Browser cases (pinned locale and timezone) | Fully |

## 8. Safety guard

The suite writes data, so it refuses any host that is not local unless the host is explicitly allowlisted *and* its
name marks a test environment (staging, dev, test, qa, sandbox, preview). Check this in code before the first call,
and never point the suite at production.

## 9. Oracle snapshots and sweeps

- Keep the documented oracles as **dated snapshots in the suite**, reviewed by hand when they change: the permission
  matrix (every grant, data scope, field mask, approval rule) and the API contract (every operation with the
  permission it declares, refreshed from the product's OpenAPI file with the commit it came from).
- A product change then appears as a failing case to review, never as a silently updated expectation.
- **Sweeps** find a whole class of defect at once: every operation × every role (random id, empty body, so nothing
  changes) for authorization; every operation with a malformed id (expect 400 or 404, never 500); every create and
  update with an empty body (expect field error codes, never raw validator text). When a fix covers only the fields
  reported, the sweep shows the rest.

## 10. Environment facts to encode

- Run against a **stable build**; a development server in watch mode restarts when its source changes, and a
  browser test that hits the restart fails.
- **Type dates as the product types them**, in the business's timezone (configured), and pick data that respects
  date rules (for example sessions booked on past days of a contract that started 60 days ago, when sessions can't
  be confirmed before their day).
- Report pacing or waiting time separately from execution time.
