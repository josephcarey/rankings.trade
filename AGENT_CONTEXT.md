# AGENT_CONTEXT — Card #21 (C6): agent API token management (API + UI)

## Scope
Agent owners generate, list, revoke, and rotate per-agent API tokens; the raw
secret is shown exactly once at creation/rotation and is never retrievable after.

## Files
- `src/lib/agents/token-service.ts` — tested logic layer composing ownership
  checks (`agents.ts`) + token crypto (`token.ts`) + persistence
  (`agent-tokens.ts`): `requireOwnedAgent` (private), `parseTokenId`,
  `listAgentTokens`, `createAgentToken`, `revokeAgentToken`, `rotateAgentToken`.
  Returns non-secret `TokenView` (never `token_hash`).
- `src/api/agents.ts` — authed Hono routes under `/api/agents`:
  `GET/POST /:symbol/tokens`, `POST /:symbol/tokens/:id/{revoke,rotate}`.
- `src/routes/agents/[symbol]/+page.server.ts` + `+page.svelte` — token mgmt UI:
  create form, show-once secret banner, list (label/prefix/created/last-used/
  status), revoke + rotate.
- `src/routes/agents/+page.svelte` — each agent now links to its token page.

## Security decisions (rubber-duck reviewed before implementing)
- "Agent not found" and "not your agent" collapse to a single 404 — callsign
  ownership cannot be enumerated.
- Strict `parseTokenId` (`^\d+$`, safe positive integer) before any DB call.
- Label trimmed before validation AND storage (1–60 chars).
- Raw token returned only in the action/API response; never in `load`, never
  logged, never persisted. `token_hash` never leaves the service.
- Revoke/rotate scoped by `agent.id` after the ownership check.
- Rotate non-atomic (revoke + insert) is an accepted v1 risk; the row helper
  returns null on failure so success is never falsely reported.

## Tests
- `token-service.test.ts` (24): parseTokenId matrix; ownership denial for all ops;
  show-once + trimmed label; list masking + ordering; revoke idempotency +
  cross-agent isolation; rotate revokes old/issues one new, 404 on revoked/unknown.
- `agents.test.ts` (+5): create 201/400/404, list+revoke+rotate happy path,
  404 on non-numeric id.
- `[symbol]/page.server.test.ts` (9): load owner/404; create secret-once/400/404;
  revoke; rotate; 404 on bad/unknown id.

## Evidence
- `bun run ci` -> green. svelte-check 0 errors (2 pre-existing benign warnings).
  26 test files, 214 tests passing.
- Coverage: All files 95.83% lines / 84.52% branch (>=80% floor held).
