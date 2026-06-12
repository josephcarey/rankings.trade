# AGENT_CONTEXT — Card #20 (C5): register and claim agents (API + settings UI)

## Scope
Signed-in users can register/claim a SpaceTraders agent callsign (trust-based, no
verification in v1) with **one active owner per agent**. Adds:

- `src/routes/agents/agent-schema.ts` — valibot `claimSchema` (trim + uppercase +
  `^[A-Z0-9_-]{3,20}$`).
- `src/routes/agents/+page.server.ts` — load (empty form + caller's owned agents) and a
  claim action mapping the atomic `claimAgent` result → success message / 409 / 400.
- `src/routes/agents/+page.svelte` — claim form + agent list with Unverified/Verified badge.
- `src/api/agents.ts` — `ownedAgentsHandler` + `createAgentsApi()` mounted at authed
  `/api/agents` in `src/api/app.ts`.
- `src/lib/auth/guard.ts` — `/agents` added to `AUTHED_PREFIXES`.
- `src/routes/+layout.svelte` — "Agents" nav link in the signed-in block.
- `src/lib/db/agents.ts` — re-exported `SYMBOL_PATTERN` (now consumed by the schema).

## One-active-owner enforcement
Claim uses the atomic `claimAgent` helper (#17): insert-or-claim-if-unowned, then re-read;
the persisted owner decides the outcome (`claimed` / `already_owner` / `already_claimed`).
A contested claim by a different user returns 409 and does not overwrite the owner.

## Tests
- `src/routes/agents/page.server.test.ts` (6): load form + caller's agents only; redirect
  when no local user; claim unowned -> unverified; re-claim by same owner -> "already own";
  claim taken callsign -> 409 field error, owner unchanged; invalid symbol -> 400 pre-write.
- `src/api/agents.test.ts` (2): handler returns owned agents JSON; guard returns 401.
- `src/routes/agents/agent-schema.test.ts`: valid normalize/uppercase; invalid rejected.
- `src/lib/auth/guard.test.ts`: `/agents` root + subpaths require auth.

## Evidence
- `bun run ci` -> green. svelte-check 0 errors (2 pre-existing benign warnings).
  24 test files, 176 tests passing.
- Coverage: All files 95.03% lines / 87.16% branch (>=80% floor held).
