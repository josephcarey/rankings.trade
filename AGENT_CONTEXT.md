# Card #11 — protect authed SvelteKit routes and redirect unauthenticated users

## Summary
Server-side route guard: signed-out requests for authed paths (`/settings*`)
redirect to sign-in with the intended destination preserved; public paths and
authenticated requests pass through. Guard runs in the hooks sequence, so
protected content never flashes client-side.

## What changed
- `src/lib/auth/guard.ts` (new):
  - `requiresAuth(pathname)` — pure classifier; `/settings` + subpaths are authed,
    everything else public.
  - `signInRedirect(pathname, search)` — builds `/sign-in?redirect_url=<encoded>`
    (param matches the existing sign-in route's `redirect_url`/`safeRedirectTarget`).
  - `requireAuthHandle` — SvelteKit `Handle`: `redirect(302, …)` for signed-out
    authed requests, else `resolve(event)`.
- `src/hooks.server.ts` — `requireAuthHandle` added to the sequence after
  `localUserHandle` (Clerk session → local user → guard → api).

## Tests (`guard.test.ts`)
- `requiresAuth`: settings root/subpaths → true; home, leaderboard, public
  profile, sign-in, callback, /api → false; prefix-only collision (`/settings-export`) → false.
- `signInRedirect`: encodes pathname; preserves+encodes query string.
- `requireAuthHandle`: signed-out on `/settings` → 302 with encoded destination,
  resolve not called; signed-in → passes; signed-out on public → passes.

## Evidence
`bun run ci` green: 17 test files, 107 tests, guard.ts 100% coverage,
global ≥80%.

## AC mapping
- AC1 server-side redirect preserving destination → requireAuthHandle + signInRedirect.
- AC2 public routes open when signed out → requiresAuth false for public + handle test.
- AC3 server-side, no client flash → runs in hooks.server.ts sequence.
- AC4 tested signed-in + signed-out → handle tests cover both.
