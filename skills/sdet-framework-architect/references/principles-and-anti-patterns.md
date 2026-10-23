# Principles and anti-patterns checklist

Generalized from two production frameworks' ADRs, code-review checklists, and design docs (one process-parallel,
one thread-parallel). Framework/language-agnostic — apply when writing or reviewing any test-automation code.

## SOLID, DRY, YAGNI, KISS — how they show up in test-automation code specifically

- **Single Responsibility** — a container owns one screen region; an element class owns one control type; a service
  class owns one API resource; a helper class owns one concern (date/time, random-data generation, response
  parsing). If a class's name needs "and" to describe it, split it.
- **Open/Closed** — new capability should mean *adding* a class (a new element type, a new notification channel, a
  new child service), not editing existing dispatch/switch logic. Prefer subscription/composition points over
  branching on type.
- **Liskov Substitution** — a subclass (or a narrowed/cloned instance from a fluent method) must remain usable
  anywhere the base type is expected. Fluent "narrowing" methods must preserve the actual runtime type, not
  silently downcast to the base class.
- **Interface Segregation** — don't force every element to inherit every possible action (a label doesn't need
  `fill()`); split capability surfaces by real-world role.
- **Dependency Inversion** — tests and high-level objects depend on abstractions (an injected page object, an
  injected service) supplied by one composition root, never on concrete constructors scattered through test bodies.
- **DRY** — one source of truth per cross-cutting concern: one error/toast component, one set of user-facing string
  constants, one config object reading environment values, one wait-strategy implementation for loading states.
  Duplication across page/screen objects is the most common DRY violation in automation frameworks specifically.
- **YAGNI** — don't build a class hierarchy, a plugin/dynamic-discovery mechanism, or a generic abstraction for a
  single current caller. Extract when a genuine second or third use appears, not preemptively. A single flexible
  class parameterized by data (e.g., one "email" class taking a subject) usually beats a class-per-variant
  hierarchy.
- **KISS** — pick the least-machinery solution that satisfies the actual current requirement (e.g., a typed
  step-wrapper over Given/When/Then instead of a full Gherkin engine when no one needs to *author* `.feature` files
  by hand). Verify your test runner's real concurrency/execution model before reaching for isolation machinery
  (thread-local storage, per-test DI containers) — a simple static holder is correct and sufficient when the runner
  is process-parallel with sequential-within-worker execution.

## Block-level anti-patterns (fix before merge)

- Global, unscoped element/locator lookups instead of resolving through the owning container's scope.
- A page/screen object reimplementing its own error/toast/notification handling instead of using the one shared
  component/fixture for that concern.
- Hardcoded sleeps/waits used to paper over a race condition, instead of waiting on the real signal (a response, a
  state change, a condition).
- Tests that depend on shared mutable state or execution order (a fixed test user, data left over from a previous
  test, an assumption about run order) — this breaks under parallelization and causes intermittent, hard-to-reproduce
  failures.
- Test code bypassing the composition root: importing the underlying test framework's primitives directly, or
  constructing page objects/services ad hoc inside a test body instead of receiving them as injected fixtures.
- Missing/ignored asynchronous handling (an un-awaited action whose failure or race goes unnoticed).
- Deep nesting or god classes/methods doing several unrelated things (usually a Single-Responsibility violation
  waiting to be split per the layer/pattern that fits, per `design-patterns-catalogue.md`).
- Mocking so much of a system that the test only proves the mock behaves as configured, not that the real
  application behaves correctly — or asserting "the mock was called" instead of asserting on observable
  user-facing behavior.
- Blanket retries (on any error or any 5xx), or a retry count that turns a failure into a pass.
- A teardown that stops at its first failing step, or swallows teardown errors instead of reporting them.
- A test for a known defect that is skipped, or whose assertion was weakened so it passes, instead of being marked
  as an expected failure.
- An expected oracle (permission matrix, API contract, seeded configuration) updated to match the product without a
  reviewed diff.
- A suite that writes data and can be pointed at any host, with no environment guard.

## Warn-level smells (flag, don't necessarily block)

- Premature abstraction: an interface, base class, or config option with exactly one implementation/caller and no
  concrete second use in sight.
- Parameter lists longer than 3 that aren't grouped into an options object.
- Unclear or generic names (`data`, `helper2`, `doStuff`) where a specific name would document intent for free.
- Magic numbers/strings that should be named constants (timeouts, status codes, repeated literal copy).

## Cross-project reuse: "share the vocabulary, not the sentences"

When multiple products/repos share a genuine design system, the **element/control vocabulary layer** (Button,
Input, Dropdown, Table primitives) is usually safe to extract into a shared package — *if* selectors and any
UI-copy strings it depends on are injectable/configurable per project rather than hardcoded, and the layer has no
upward coupling (elements never import page objects, services, or fixtures).

Never share, even across sibling products on the same design system:
- Page/screen objects — they encode one product's specific screen layout and flows.
- API service/endpoint definitions — one product's API surface.
- User-facing copy/message constants — locale- and product-specific.
- Test data or environment configuration — product-specific and becomes a configuration nightmare if forced to
  serve two products from one source.

If the shared vocabulary layer holds any process-wide singleton state (a driver/session instance holder), declare
its underlying driver dependency as a peer dependency when packaging it — bundling your own copy risks two live
instances of the driver library and split global state across the host project and the shared package.

## Thread-based parallel runners: additional non-negotiables

The rules below apply specifically when your test runner is thread-pool-based and can execute multiple test
methods concurrently *within one process, reusing one instance of the test class* (e.g. TestNG/JUnit-style runners
with a `parallel="methods"` setting). They don't apply to process-based runners (one worker = one OS process,
sequential execution within a worker) — there, a static singleton driver/session holder is already safe; see Layer
5 of `architecture-blueprint.md` for both shapes side by side.

- **Never cache thread-affine state in a test-class instance field.** The driver/session handle, a log-correlation
  id, or any other per-test context must be resolved fresh from thread-local (or equivalent thread-scoped) storage
  on every access — never stored in `self`/`this`, because the runner may hand two concurrently-running test
  methods the same instance.
- **Clear thread-local/log-correlation state in an always-run teardown.** A value set for one test must not survive
  past that test, or it leaks into whichever next test happens to reuse the same thread from the pool.
- **Use thread-safe structures for any cross-test shared counter or registry** (e.g. a retry-attempt counter keyed
  by test identity). Don't assume a listener/analyzer's own instance lifecycle is stable under parallel execution —
  key shared state explicitly (e.g. a concurrent map keyed by test id, with atomic counters) rather than relying on
  one-instance-per-test assumptions that thread-pool reuse breaks.

## Test-practice non-negotiables

- **Own your data.** Whoever creates test data, a mock, a DB row, or an email owns cleaning it up, idempotently
  (tolerate "already gone" on delete), in a teardown hook/fixture — never relying on the test body reaching a
  cleanup line that a failed assertion would skip. For a *limited, reusable, exclusive-access* shared resource that
  can't be freshly created per test (a pool of test accounts/licenses), use the Object Pool + RAII/bracket-leasing
  pattern from the catalogue instead of a hand-rolled locking scheme.
- **Amortize expensive, repeated setup.** Authenticate via API once and persist/reuse the resulting session state
  across tests rather than repeating a slow UI login per test; reserve the UI flow for the test(s) that actually
  verify it. The same logic applies to any other slow, repeated setup side-effect.
- **Mock at the boundary, assert on behavior.** Intercept only the external dependency (network, third-party
  service); never assert on the mock's internal call state — assert what the consumer/user actually observes as a
  result.
- **Trace test cases back to requirements.** Where acceptance criteria exist, name/tag test cases with the
  criterion ID they verify; don't invent unverified business rules to fill a gap — flag the gap instead of guessing.
- **Gate CI cheaply before running expensively.** Run fast checks (lint, type-check, static analysis) before
  expensive test stages so failures surface fast; parallelize independent stages/shards. Fan out result
  notifications via an Observer/pub-sub structure (see catalogue) so adding a channel never touches the reporting
  producer, and isolate each channel's failures from the others.
- **Prefer the cheapest assertion tier that expresses the requirement**, especially for non-deterministic outputs
  (e.g., AI/LLM-generated content): structural/schema checks before semantic checks, semantic checks before an
  LLM-as-judge, and reserve multi-run stability checks for genuinely flaky-by-nature behavior. Treat any AI-assisted
  tooling in the framework itself (locator-repair suggestions, generated test cases) as augmentation requiring human
  review, never an unreviewed replacement for deterministic checks.

## Execution reliability and evidence

Lessons from running a large regression suite against a real web product; each one cost a false failure or a false
pass before it was fixed.

- **Strict locators, inconclusive on ambiguity** (Block). A locator matching two elements, for example two nested
  `main` landmarks or the same button label in a page and a dialog behind it, must stop the step as inconclusive
  and report the count. Acting on the first match turns a page defect into a random pass or fail.
- **Target the active layer.** When a confirmation dialog opens over a form dialog, the form becomes inert; scope
  assertions to the topmost dialog (alert dialog, by its accessible name), not to the form underneath.
- **Positive anchor before an absence assertion** (Block). Prove the region rendered, then assert that something is
  missing; otherwise permission tests pass on a blank page.
- **Pin locale and timezone** (Block). A login form whose labels follow the browser language breaks every test on a
  machine with another default locale.
- **Assert text the way the DOM renders it** (Warn). Text-content matching concatenates child nodes ("Remaining21"
  for a label and a badge), and number formatting inserts non-breaking spaces before currency signs. Assert on a
  stable fragment or normalise whitespace; never paste a formatted value from the screen into an expected string.
- **Evidence capture must not flake the test.** Screenshots tied to navigation are best-effort, because a
  client-side redirect can replace the page mid-capture; record that the capture was skipped and why. Screenshots
  attached to an assertion are mandatory: if one is missing, the assertion's evidence is incomplete and the step is
  inconclusive.
- **Secrets by reference.** Steps carry a secret's name (for example `{ secret: 'APP_PASSWORD' }`), resolved only at
  run time; logs, traces and reports show the reference, and redaction must leave those references readable rather
  than mangling them into another pattern.
- **Environment gates live in code.** An allowlist of hosts per environment, production writes denied by default,
  destructive steps refused without a scoped approval: test each gate with a negative test, the same as product
  code.
- **Run the suite twice before trusting it.** Two identical runs are cheap evidence that the passes and failures
  are deterministic; any case that differs between runs is quarantined and investigated, not re-run until green.

## Automation candidates

Design every case first (see the `manual-test-design` skill), then decide per case whether to automate it. Record a
concrete reason for each case left manual, chosen from a small fixed list, so the reasons double as the
automation backlog: grouping them shows which framework capability would automate the most cases. Typical reasons:

| Reason | Capability that would remove it |
| --- | --- |
| Expected value depends on today's date | Date-relative inputs and assertions |
| Needs a record created earlier in the same test | Capturing a value (an id) and reusing it in later steps |
| Two people acting in sequence | Multiple sessions or users in one test |
| Data the seed doesn't have | API data fixtures with teardown |
| Depends on time passing (timers, expiry) | A controllable clock |
| Email, push notifications, devices | Mailbox or device adapters |
| Arithmetic across displayed values | Computed expectations in the test |
| Changes shared business data (money, merges, deletions) | Scoped approval plus cleanup; until then manual by choice |
| Layout, wording, phone usability | Stays manual: human judgement |
| Two simultaneous requests | Parallel sessions |

Report automation coverage as automated cases over designed cases, never over "cases we chose to automate".
