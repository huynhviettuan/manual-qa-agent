# ADR-0019 — A tester screen served by the API, as a thin client with no verdict logic

- **Status:** Accepted
- **Date:** 2026-10-23
- **Builds on:** ADR-0017 (manual execution), ADR-0018 (coverage, exports, questions)

## Context

Manual execution, the question register and the exports exist as API endpoints, which testers do not use. The
specification lists a reviewer UI as not implemented, and nothing in the repository serves a page. Introducing a
front-end framework for one screen would add a build step and a dependency tree to a team that runs the API from
source.

## Decision

- **One static page at `/tester`**, served by the API itself from `apps/api/src/tester/` (an HTML file and one
  script, read at startup). No framework, no bundler, no inline script. The page and its script are the only
  routes served without a key; every data call the page makes goes to `/api/*` and is authenticated like any
  other client.
- **The tester's own API key** is entered once, checked against `GET /api/me`, and kept in `sessionStorage` for
  that tab only. The page shows who the key belongs to and offers to change it. Nothing else is stored in the
  browser.
- **Security headers on both files:** a Content Security Policy that allows scripts and data calls from the same
  origin only (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`), `nosniff`, no referrer,
  no caching. Every value rendered from the API is HTML-escaped.
- **The page computes nothing.** It shows suite runs with their manual backlog (`GET /api/suites/{id}/runs`, new),
  opens a case with its steps, test data, preconditions and review flags, collects a status and the actual result
  per step, and posts them to `POST /api/manual-runs`. The status it then shows is the one the server derived.
  Attachments go to the evidence endpoint; questions and observations to theirs; exports are downloaded through
  the authenticated endpoints.
- **Tested in a real browser:** Playwright drives the page against the real API in `apps/api/test/tester.ui.test.ts`
  (sign in, open a run, record a failed step, see the derived status and the history). Locators follow the team's
  rules: scoped through the page's main region, strict.

## Amendment, 2026-10-23: draft review on the same page

The screen gained a "Drafts to review" view over `GET /api/test-cases?status=` (new): the list of a project's
cases by status, and for one case its design (techniques, conditions, requirements verified), steps with sources,
assumptions, missing requirements and review flags. A reviewer approves, rejects with a reason, or edits through a
form that writes a new `DRAFT` revision via the existing `EDIT` decision, including the management fields of
ADR-0018 (`module`, `level`, `manualReason`, `smoke`, `openQuestions`, `refs`); `basis` is recomputed from the
assumptions when saving. Review rules are unchanged and enforced by the API (roles, state transitions); the page
only submits decisions. Covered by the browser test.

## Consequences

- Testers can execute, record and attach evidence without `curl`; QA engineers can review drafts and keep the
  question register from the same page.
- The page is deliberately plain: one HTML file and one script. If the review workload grows (bulk actions,
  diffing revisions), a framework would be a separate decision.
- A key in `sessionStorage` is readable by scripts on the page's origin; the CSP keeps that to the API's own
  script. Serve the API over TLS and keep keys per person, as `docs/11` already requires.
