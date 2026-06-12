# Card #14 — Epic B closeout: auth is a green base

## Summary
Authentication & user accounts verified end-to-end as a green base for later
epics. All Epic B cards (#6–#13, #15) are merged to `main`; `bun run ci` is green.

## End-to-end verification (by code trace + automated tests)
No live Clerk creds in this environment; each boundary is verified by the
repo's unit/integration tests (faking Clerk + an in-memory D1) plus a wiring
trace of `hooks.server.ts` and `api/app.ts`.

### AC1 — sign-in → provision/refresh → settings persist → sign-out
- Magic-link sign-in: `routes/sign-in/[...rest]` (#8), Clerk `<SignIn>`.
- Session populated each request: `clerkSessionHandle` sets `locals.userId`/`session` (#15).
- Local `users` row provisioned/refreshed: `localUserHandle` → `resolveLocalUser`/`provisionUser` (#10), preserving local-only fields.
- Profile settings persist: `/settings` load+action (#12) + form UI (#13); now reachable via a signed-in **Settings** nav link added here.
- Sign-out: `<SignOutButton>` in the layout (#8).

### AC2 — authed routes redirect when signed out; public open
- `requireAuthHandle` in the hooks sequence redirects signed-out `/settings*` to sign-in (302, destination preserved); public paths pass (#11). Tested in `guard.test.ts`.

### AC3 — protected API 401 unauth / 200 with session
- `/api/me` authed group runs `clerkAuth, requireAuth, attachLocalUser`; guest → 401 studio error, valid session → 200 with the local user (#9/#10). Tested in `api/auth.test.ts`.

### AC4 — `bun run ci` green on `main`
- 19 test files, 124 tests, global coverage ≥80%. svelte-check 0 errors (1 benign superForm init warning, non-failing).

## Change in this card
- `routes/+layout.svelte`: added a signed-in **Settings** nav link so the AC1
  end-to-end flow is reachable from the UI (previously `/settings` was only
  reachable by direct URL).

## Hooks sequence (final)
`withClerkHandler() → clerkSessionHandle() → localUserHandle → requireAuthHandle → apiHandle`

## Follow-ups (non-blocking, noted for roadmap)
- No component-level (`.svelte`) test harness; UI behavior is covered indirectly via server/schema tests. Consider `@testing-library/svelte` + jsdom if richer UI grows.
- `joi` (unused optional superforms adapter) carries a moderate advisory; audit gate set to `--audit-level=high` per studio standard.

## Result
Epic B complete. Auth is a green base for later epics.
