# ADR-0013 — The agent tool server also speaks Streamable HTTP, with a key per request

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amends:** ADR-0011 (transport only; the tool surface and propose-only rules are unchanged)

## Context

ADR-0011's tool server runs over stdio: the assistant spawns `pnpm -s mcp` on the same machine, with one
`AI_AGENT` key in its environment. Hosted assistants and shared setups can't spawn a local process; they need an
HTTP endpoint.

## Decision

- `pnpm -s mcp --http` serves MCP Streamable HTTP at `POST /mcp` (plus `GET /healthz`), bound to `127.0.0.1:3100` by
  default (`QA_MCP_HOST`, `QA_MCP_PORT`). Put it behind TLS before exposing it beyond the host.
- **The server holds no key.** Every request carries the caller's key (`Authorization: Bearer <key>` or
  `x-api-key`). Before any tool runs the server calls `GET /api/me` with it: unknown key → 401, any key that is not a
  pure `AI_AGENT` key → 403. All API calls for that request use the caller's key, so each caller gets the API's own
  role, tenant and rate-limit checks.
- **Stateless:** one MCP server instance per HTTP request, no session ids — nothing to hijack or expire. `GET` and
  other methods on `/mcp` get 405.

## Consequences

- Hosted and shared assistants can use the same eight tools with the same guarantees as stdio.
- One `/api/me` call per MCP request; negligible next to the tool calls themselves.
- Stateless mode has no server-to-client notifications; the tools don't need any.
