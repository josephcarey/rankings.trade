# Card #16 — Epic C design lock: ownership model + token security

## Summary
Locked the agent-ownership data model and API-token security design for Epic C so cards
#17–#23 build on agreed foundations. No app code; the deliverable is a decisions addendum
appended to `docs/decisions.md` (section "Epic C — Agents & per-agent API tokens").

## Decisions (see docs/decisions.md, DEC-C1…DEC-C5)
- **Admins** via env allowlist `ADMIN_CLERK_USER_IDS` → `isAdmin(clerkUserId, env)`; no role UI.
- **Admin transfer** = admin-only endpoint + minimal SvelteKit form action; no `/admin` page.
- **Token**: `rtbot_<base64url(32 CSPRNG bytes)>`, stored as SHA-256 hex hash (UNIQUE index)
  + non-secret `token_prefix`; shown once; rotate = revoke + one replacement.
- **Schema**: `agents` (symbol UNIQUE, nullable owner, verified flag), `agent_tokens`
  (owner_user_id snapshot, token_hash UNIQUE, label, last_used_at, revoked_at),
  `agent_ownership_events` audit (event_type, actor, prior/new owner, reason).
- **Invariants**: atomic one-owner claim (conditional UPDATE), transactional transfer +
  prior-owner token revocation + audit, throttled last_used_at writes (~10 min).

## Rubber-duck critique (token crypto + transfer/revocation)
Ran during planning. Key findings adopted:
1. Enforce one-active-owner at the DB with an atomic conditional UPDATE, not app logic alone.
2. Snapshot `owner_user_id` on `agent_tokens` so transfer revokes exactly the prior owner's
   tokens, transactionally with the owner change + audit insert.
3. Make audit fields explicit (actor / prior / new owner / reason).
4. Define rotate semantics (revoke + single replacement, same label).
5. Throttle `last_used_at` writes to avoid per-request write amplification.
6. Keep rate-limiting / body-size caps in Epic F (avoid scope creep).
SHA-256 (not bcrypt) confirmed appropriate for a full-entropy random secret with a unique-hash
equality lookup.

## Evidence
- `bun run ci` green on the synced base before this card (94.39% line coverage).
- This card adds only `docs/decisions.md` + this file; CI unaffected.

## Result
Epic C design locked. Unblocks #17 (schema/DB), #18 (token crypto), and downstream cards.
