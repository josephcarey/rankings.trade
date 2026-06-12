# Card #17 — Agents schema migration + agent/ownership DB helpers

## Summary
Added the Epic C persistence foundation: migration `0003_agents.sql` (agents,
agent_tokens, agent_ownership_events) and `src/lib/db/agents.ts` typed helpers
that enforce one active owner per agent via an atomic conditional claim.

## What changed
- `migrations/0003_agents.sql`:
  - `agents` (symbol UNIQUE + CHECK upper-case/length, nullable owner_user_id,
    verified default 0, timestamps).
  - `agent_tokens` (agent_id, owner_user_id creation-time snapshot, token_hash UNIQUE,
    token_prefix, label CHECK 1–60, last_used_at, revoked_at) + index.
  - `agent_ownership_events` audit (event_type CHECK claim/transfer/admin_release,
    actor/prior/new owner, reason) + index.
- `src/lib/db/agents.ts`: `normalizeSymbol`, `isValidSymbol`, `createAgent`,
  `getAgentBySymbol`, `getAgentById`, `listAgentsByOwner`, `claimAgent`,
  `setAgentOwner`, `recordOwnershipEvent`.

## Key decisions / invariants
- **Atomic one-active-owner**: `claimAgent` uses `INSERT … ON CONFLICT(symbol) DO UPDATE
  SET owner_user_id = excluded.owner_user_id WHERE agents.owner_user_id IS NULL`, then
  re-reads and lets the persisted owner decide the outcome. Two racing claims can never
  both win. A successful new claim writes a `claim` audit event.
- `claimAgent` returns a discriminated result: claimed | already_owner | already_claimed
  | invalid_symbol.
- Symbols normalized (trim + upper) and validated `^[A-Z0-9_-]{3,20}$` before any write.

## Evidence
- `bunx vitest run src/lib/db/agents.test.ts` → 21 passed.
- `bun run ci` → green; `agents.ts` line coverage 93.93% (uncovered: defensive
  post-write-not-found throw + the lost-race branch).
- All migrations (0001–0003) apply cleanly on a fresh sql.js DB; contested-claim smoke
  confirmed the owner is not overwritten (owner stays 1 after user 2 attempts a claim).

## Notes for downstream
- `SYMBOL_PATTERN`, `OwnershipEventType`, `ClaimStatus` are intentionally un-exported for
  now (knip) — re-export when a consumer card needs them (e.g. #20's valibot schema).
- Unblocks #19 (agent-tokens helpers) and #20 (claim API/UI).
