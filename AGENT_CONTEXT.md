# AGENT_CONTEXT — Card #24: Epic C closeout

## Scope
Epic C / card #24 (C9). Verifies Epic C is complete end-to-end and leaves a
green base for later epics. No new behaviour — verification + evidence only.

## Acceptance criteria — evidence
- **CI green with all C cards merged**: `bun run ci` on the integration branch
  (`josephcarey/epic-c-agents-tokens`, all of #16–#23 merged `--no-ff`) passes —
  svelte-check 0 errors, tsc, knip, eslint, `bun audit --audit-level=high` clean;
  31 test files / 259 tests pass; coverage 95.59% lines / 85.58% branch (>=80% floor).
- **Migration 0003 applies cleanly to a fresh D1**: applying 0001→0002→0003 in order
  to a fresh SQLite DB yields tables `users, agents, agent_tokens,
  agent_ownership_events` (+ `_migrations`). Verified via a throwaway sql.js run.
- **`ADMIN_CLERK_USER_IDS` documented; no secrets committed**: documented in
  `.dev.vars.example` with a placeholder; `CloudflareBindings` carries the typed
  binding (`src/platform.ts`). Secret scan of the epic diff (sk_live/sk_test/AKIA/
  PEM/`secret=…`) finds nothing.

## End-to-end trace (covered by unit tests across the epic)
1. **Claim (unverified)** — `claimAgent` atomic one-owner UPDATE; `agents.verified`
   defaults 0. (`src/lib/db/agents.test.ts`, `src/routes/agents/page.server.test.ts`)
2. **Generate token (shown once, hashed)** — CSPRNG `rtbot_…`, SHA-256 hash stored,
   raw returned once. (`src/lib/agents/token*.test.ts`, `src/api/agents.test.ts`)
3. **Bot authenticates** — `requireAgentToken` resolves the active token by hash,
   throttled `last_used_at`. (`src/api/bot-auth.test.ts`)
4. **Revoke / rotate** — owner-scoped revoke + rotate-replaces-one.
   (`token-service`, `agents` API, `routes/agents/[symbol]` tests)
5. **Admin transfer** — env-allowlist guard, compare-and-set owner, prior-owner token
   revocation, `transfer` audit event. (`ownership-service`, `api/admin`,
   `routes/admin/agents/[symbol]` tests)

## Epic C scope — satisfied
Trust-based agent claims with one active owner; per-agent hashed API tokens shown
once, listable/revocable/rotatable; bot token-auth middleware; admin transfer escape
hatch with audit trail. All 9 cards (#16–#24) merged; CI green.
