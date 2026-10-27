# ADR-0025 — Closing the gaps the cases named: raw bodies, headers, one-time codes, test hooks, a live generator, quoted drafts, a product vocabulary

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Asking the agent to automate real cases (ADR-0024) named what the step format lacked: six of eight refusals were a
raw or non-JSON body, a request header, a second factor, or an account of the case's own. The executable generator
existed only for the session exchange and a stand-in, the tester screen and the tool server knew nothing of
ADR-0021 to 0024, the skills described the earlier world, the draft prompt asked for no quotes, and the observability
check flagged 16 % of human-written results on the held-out set.

## Decision

1. **Step format.** `apiRequest.rawBody` (`contentType`, `text`; sent as bytes, never re-serialised) and `headers`
   on `apiRequest` and `session`, restricted to an allowlist (`Origin`, `Referer`, `Accept`, `Accept-Language`,
   `Idempotency-Key`, `X-Requested-With`, `User-Agent`: what security and locale cases need, nothing that forges
   identity); an input kind `{ totp: SECRET }` that the executor turns into an RFC 6238 code at send time (the secret
   stays in the resolver, the step log shows `[totp:NAME]`); a `testHook` step for the product's own test endpoints,
   allowed only on path prefixes the environment's administrator listed (`environments.test_hook_paths`,
   `pnpm qa env --test-hooks`), and never in production by policy.
2. **A live generator.** `ClaudeProvider.generateExecutable` through structured output (a flat answer: the spec as a
   JSON string, or a reason), then the same `checkExecutable`; the API wires it when the provider has it. The MCP
   server gains `propose_steps`, propose-only like everything there (ADR-0011).
3. **What people see.** The tester screen binds a known bug to steps, shows detection, preflight, unstable, unproven,
   failed-outside-known-bug and row marks beside the verdict, and looks up a requirement's regression scope.
4. **Skills.** `sdet-framework-architect` and `manual-test-design` carry the pilot's rules, so the next project starts
   from them.
5. **draft-v6 asks for quotes.** Each step's `evidence` is a verbatim quote from a cited source; the stand-in quotes
   the measurable line it took the expectation from.
6. **A product vocabulary.** `buildVocabulary` takes the quoted strings, codes and capitalised labels of a project's
   sources; an expected result that names one is observable to someone who knows the product. The draft check builds
   it from the cited sources.

## What the measurements say

- **Retrofitting quotes does not work.** The 27 session drafts were re-answered under draft-v6 by adding to each step
  the longest run of three or more consecutive words of its expected result found in a cited source: 4 of 105
  steps got a quote. The expected results were written in the author's words, not the sources'. Quotes have to be
  taken while writing, which is what the v6 prompt now asks for; the 101 "no quoted evidence" flags on the replay are
  the honest state of those drafts.
- **The vocabulary helps, and is not enough.** On the held-out 983 Flow Fitness expected results the check flags 159
  without it and 116 with the 146 terms of the requirement catalogue (16 % → 12 %), still mostly false ("Paid",
  "Still on /login"). It stays advisory. The terms a product's UI shows are richer than its requirement texts; a
  vocabulary from the product's own option lists and status names (the sources a team ingests) is where the next
  gain is.
- Of the 20 Flow Fitness executable requests, 12 are still unanswered in the session: the ACC-* cases need the
  product's endpoints case by case, which is work for the generator with a key, not for a person in a session.

## Consequences

- AUTH-003 to AUTH-009 can now be expressed in the step format; their answers in the session exchange still say
  "cannot" and should be re-asked.
- `rawBody` lets a step send deliberately malformed input; the host rule and the policy gate are unchanged, and a
  header can never set `Authorization`, `Cookie` or `Host`.
- The spot-check sample of the agent-vs-team pairing is still empty; it needs a person.
