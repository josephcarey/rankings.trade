# Card #19 — Agent token persistence helpers

## Summary
Added `src/lib/db/agent-tokens.ts`: the lifecycle DML for the `agent_tokens`
table (create / list / look-up / revoke / bulk-revoke / rotate / touch).

## What changed
- `insertToken` — persists hash + prefix + label (validates label 1–60); insert-then-reread.
- `listTokensByAgent` — active + revoked, newest first.
- `findActiveTokenByHash` — exact match on the UNIQUE `token_hash`, excludes revoked.
- `revokeToken(id, agentId)` — agent-scoped, idempotent (guarded by `revoked_at IS NULL`).
- `revokeAllActiveTokensForOwner(agentId, ownerUserId)` — returns count; used by the
  admin transfer flow to revoke exactly the prior owner's active tokens.
- `rotateToken` — revokes the named active token and inserts one replacement carrying
  the same label/owner (caller supplies the new hash/prefix from `generateToken`).
- `touchLastUsed` — unconditional stamp; the bot middleware (#22) decides throttling.

## Key decisions
- No `RETURNING` (sql.js/runtime portability) — follow the insert-then-reread convention.
- Ownership/agent scoping on every mutation so a user can only touch their agent's tokens.
- `isValidLabel` exported for reuse by the #21 token form schema.

## Evidence
- `bun run ci` → green; 167 tests total; `agent-tokens.ts` 96.77% line coverage
  (uncovered: defensive post-write-not-found throw).
- 16 unit tests cover insert/list(active+revoked ordering)/find(active vs revoked vs
  unknown)/revoke(scoping + idempotency)/bulk-revoke(owner-scoped + count)/rotate
  (replacement + same label + null on wrong agent)/touch.

## Notes for downstream
- Unblocks #21 (token management API/UI), #22 (bot middleware → findActiveTokenByHash +
  touchLastUsed), #23 (admin transfer → revokeAllActiveTokensForOwner).
