# AGENT_CONTEXT — Card #23: admin agent ownership transfer with audit trail

## Scope
Epic C / card #23 (C8). Adds an admin-only escape hatch to transfer an agent's
ownership to another user, revoking the prior owner's active API tokens and
writing an audit event. Admins are an env allowlist of Clerk user IDs.

## What changed
- `src/platform.ts` — added `ADMIN_CLERK_USER_IDS?: string` to `CloudflareBindings`.
- `src/lib/auth/admin.ts` (+ test) — `isAdmin(clerkUserId, env)`: exact, case-sensitive
  membership in the comma-split allowlist; fails closed on empty/unset/null.
- `src/lib/db/agents.ts` — added `setAgentOwnerIfCurrent(...)`: conditional compare-and-set
  on `owner_user_id` (null-safe `IS`), returns whether the row changed — prevents
  stale-owner races.
- `src/lib/agents/ownership-service.ts` (+ test) — `transferAgentOwnership(db, input)`:
  validates input, resolves target user, compare-and-set owner, revokes exactly the prior
  owner's active tokens, writes a `transfer` audit event. Discriminated `TransferResult`.
- `src/api/admin.ts` (+ test) — `createAdminApi()` + `transferHandler`. Auth chain
  clerkAuth+requireAuth+attachLocalUser; per-route `isAdmin` guard (403 for authed
  non-admins). POST /agents/:symbol/transfer; maps reasons to 400/404/409/200.
- `src/api/app.ts` — mounts `/api/admin`.
- `src/routes/admin/agents/[symbol]/` — `+page.server.ts` (admin-only load 404s for
  non-admins; `transfer` action), `+page.svelte`, `page.server.test.ts`.
- `src/lib/auth/guard.ts` (+ test) — added `/admin` to `AUTHED_PREFIXES`.
- `.dev.vars.example` — documented `ADMIN_CLERK_USER_IDS` (placeholder, no real secret).

## Security notes
- Admin gate is server-evaluated against env; non-admins get web 404 (unprobeable) / API 403.
- Transfer is order-safe: compare-and-set owner first (conflict -> 409, no side effects),
  then revoke prior owner's tokens by owner snapshot, then audit. New owner's pre-existing
  tokens untouched. No secrets logged or persisted.

## Verification
- `bun run ci` green: svelte-check 0 errors, tsc, knip, eslint, `bun audit` clean.
- 31 test files / 259 tests pass. Coverage 95.59% lines / 85.58% branch (>=80% floor).
