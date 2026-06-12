# Implementation Summary: Card #9 — feat: validate Clerk sessions on protected Hono API routes

> Implemented manually (Lever-2 autonomous dev is blocked by the opencode→Copilot 400). Near-verbatim
> port of the turbotac `packages/api/src/clerk.ts` pattern using `@hono/clerk-auth`.

## What was built
| File | Change |
|---|---|
| `src/api/auth.ts` | New — `clerkAuth` middleware (verifies Clerk session) + `requireAuth` guard (401 on guest) + `UNAUTHORIZED_ERROR` studio envelope |
| `src/api/auth.test.ts` | New — 4 tests with a faked Clerk validator (signed-in→200, signed-out→401, no-auth→401, missing keys→throw) |
| `src/api/app.ts` | Mounted an authed route group at `/api/me` guarded by `clerkAuth` + `requireAuth`; `/api/health` and future public reads stay open |
| `package.json` | Added `@hono/clerk-auth@^3.1.1` |

## Design
- **`clerkAuth`** — a `MiddlewareHandler` that reads the Clerk keys per request via `getClerkKeys(context.env)`
  (keys live on the Worker binding env, only available per request) and delegates to
  `@hono/clerk-auth`'s `clerkMiddleware({ publishableKey, secretKey })`. Keys are passed explicitly
  because our publishable var is `PUBLIC_`-prefixed, not the SDK's default name.
- **`requireAuth`** — reads `getAuth(context)?.userId`; a guest (no userId) gets a `401` with the studio
  shape `{ error: { code, message } }`; otherwise the verified identity is available to handlers via
  `getAuth(context)`.
- **Scoping** — the guard is applied only to an `authed` sub-app mounted at `/api/me`, NOT to all of
  `/api`. Public API reads (leaderboard, public profiles) mount directly on `api` and stay open. This
  satisfies the card's "do not blanket-protect all of /api".

## Key decisions
1. **`@hono/clerk-auth` over `@clerk/hono`** — the card and turbotac specify `@hono/clerk-auth`; it's
   audit-clean and matches the established pattern. (`@clerk/hono` is the newer official successor but
   is pre-1.0; the runtime deprecation notice in `@hono/clerk-auth` is cosmetic. Noted as a possible
   future swap.) A `@clerk/backend` v2/v3 split already exists via svelte-clerk; card #9 only reads
   `userId` (a string) so the split is immaterial here.
2. **`clerkAuth` as a plain middleware const, not a factory** — it takes no config, so a factory's
   returned closure tripped `unicorn/consistent-function-scoping`; a const `MiddlewareHandler` is
   cleaner and lint-clean.
3. **Faked-validator tests** — `getAuth` reads `context.get("clerkAuth")`, so tests set that var to a
   fake auth function and exercise `requireAuth` directly — no live Clerk, per the AC.

## Tests / CI
- 4 new tests; `auth.ts` at 100% coverage. Full suite: 62 tests, 10 files. `bun run ci` green.
- The live `/api/me` handler line is intentionally uncovered (it requires a live Clerk validation);
  global coverage 97.41% ≫ 80% floor.

## Notes for downstream cards
- Card #10 (provision/refresh local user) reads the verified `getAuth(context).userId` inside an authed
  handler to attach the local user.
- Add new authed API routes to the `authed` sub-app in `app.ts`; public reads stay on `api` directly.
