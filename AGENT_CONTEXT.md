# Card #10 — provision-or-refresh local user from Clerk claims

## Summary
Every authenticated principal now resolves to a local `users` row, kept in sync
with Clerk and exposed to both the SvelteKit (`locals.user`) and Hono
(`c.get("user")`) layers via one shared helper.

## What changed
- `src/lib/db/users.ts` — added `ProvisionUserInput` + `provisionUser(db, input)`:
  `INSERT ... ON CONFLICT(clerk_user_id) DO UPDATE SET email, display_name, updated_at`.
  Unlike `upsertUser` (card #6), it preserves local-only fields (`visibility`,
  `dashboard_url`) on refresh — AC2.
- `src/lib/auth/clerk-identity.ts` (new) — `ClerkUserLike` structural type +
  pure `clerkIdentity(user)` mapper (primary email → first email → null;
  display_name = first+last → username → null). Version-agnostic across the
  @clerk/backend v2/v3 split.
- `src/lib/auth/local-user.ts` (new) — `resolveLocalUser(db, fetchClerkUser)` +
  `createLocalUserHandle(deps)` SvelteKit handle factory (defaults `locals.user`
  to null, skips `/api` so Hono owns API provisioning, provisions on authed
  non-api requests).
- `src/hooks.server.ts` — `localUserHandle` added to the sequence (after the
  Clerk session handle, before the API handle).
- `src/api/auth.ts` — `AuthedVariables`, `AttachLocalUserDeps`,
  `createAttachLocalUser(deps)` factory + default `attachLocalUser`.
- `src/api/app.ts` — authed group typed with `Variables: AuthedVariables`,
  runs `clerkAuth, requireAuth, attachLocalUser`; `/api/me` returns the local user.
- `src/app.d.ts` — `App.Locals.user: User | null`.

## Tests
- `users.test.ts` — provisionUser: new-row defaults, idempotency, refresh-preserves-local-fields, null Clerk fields.
- `clerk-identity.test.ts` — email/name selection + fallbacks + all-null.
- `local-user.test.ts` — resolveLocalUser + handle (authed page provisions/attaches; guest → null, no fetch; `/api` skipped; db unavailable → null).
- `auth.test.ts` — `createAttachLocalUser` provisions + attaches for a verified identity.

## Evidence
`bun run ci` green: 16 test files, 94 tests, global line coverage 94.25% (≥80% floor).
All new `src/lib/auth/*.ts` at 100% coverage.

## AC mapping
- AC1 idempotent upsert keyed by clerk_user_id → provisionUser + tests.
- AC2 refresh mutable fields, preserve local-only → ON CONFLICT update set + preservation test.
- AC3 local user on SvelteKit locals + Hono context → localUserHandle + attachLocalUser.
- AC4 unit-tested → above.
