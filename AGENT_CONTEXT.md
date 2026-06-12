# Implementation Summary: Card #15 — feat: populate Clerk session on every request via SvelteKit hooks

> Implemented manually by the assistant. A controlled Lever-2 probe of this card (with card #7's
> svelte-clerk dependency already installed and its API documented) reproduced the opencode→Copilot
> 400 on the very first request — confirming the autonomous-dev blocker is opencode-fundamental, not
> the earlier phantom-package issue. So the epic is being finished by hand.

## What was built
| File | Change |
|---|---|
| `src/lib/auth/session.ts` | New — `toSessionLocals()` pure mapper + `clerkSessionHandle()` Handle factory (injectable Clerk resolver) |
| `src/lib/auth/session.test.ts` | New — 6 unit tests (mapper + handle, signed-in/out, injected fake) |
| `src/hooks.server.ts` | Rewrote to chain `withClerkHandler()` → `clerkSessionHandle()` → existing API handle via `sequence()` |
| `src/hooks.server.test.ts` | Rewrote — composition test with lightweight `svelte-clerk/server` + `@sveltejs/kit/hooks` mocks |
| `src/app.d.ts` | Added nullable `session` + `userId` to `App.Locals`; load svelte-clerk's `auth` augmentation |

## Design
- **Pure mapper `toSessionLocals(auth)`** — takes `Pick<SessionAuthObject, "userId" | "sessionId">`
  (typed from `svelte-clerk/server`, which re-exports `@clerk/backend`) and returns
  `{ session, userId }`. A session is only present when BOTH ids exist; otherwise signed-out
  (`null`/`null`). Trivially unit-tested, no live Clerk.
- **`clerkSessionHandle(resolveAuth?)`** — a `Handle` that reads the Clerk auth via an **injectable
  resolver** (default `event.locals.auth()`, provided by `withClerkHandler`), writes
  `event.locals.session` + `event.locals.userId`, then continues the chain. The injection seam is what
  satisfies the card's "testable without live Clerk calls" requirement.
- **`hooks.server.ts`** chains, in order: `withClerkHandler()` (populates `locals.auth`) →
  `clerkSessionHandle()` (maps to our locals) → the existing API handle (routes `/api` to Hono). So
  Clerk auth is available to API routes too (groundwork for card #9).

## Key decisions
1. **Injectable resolver over mocking the SDK in every test** — keeps the session-mapping logic pure
   and the unit tests fast and Clerk-free; the live wiring is covered by the composition test.
2. **Type from `svelte-clerk/server`, not `@clerk/backend` directly** — `svelte-clerk/server`
   re-exports `@clerk/backend`, so importing `SessionAuthObject` from it avoids adding a second direct
   dependency (knip would otherwise flag `@clerk/backend` as unlisted).
3. **`app.d.ts` loads svelte-clerk's `auth` augmentation via `import "svelte-clerk/env"`** — the
   triple-slash `reference types` form does not resolve the `svelte-clerk/env` subpath under
   `moduleResolution: bundler`; the side-effect import does (app.d.ts is ambient-only, never bundled).
4. **Lightweight `sequence` mock in the hooks test** — SvelteKit's real `sequence` needs a per-request
   async store absent in unit tests; a faithful re-implementation (thread `resolve`, last handle calls
   the original) lets the real composition order be asserted deterministically.

## Tests / CI
- `session.test.ts` (6) + `hooks.server.test.ts` (3, incl. signed-in locals population + API routing).
- `session.ts` and `hooks.server.ts` both at **100%** coverage. Full suite: 58 tests, 9 files.
- `bun run ci` **green** (svelte-check 0/0, tsc, knip, eslint, `bun audit`, vitest ≥80%).

## Notes for downstream cards
- `event.locals.userId` / `event.locals.session` are now available on every request (null when signed
  out). Card #9 (protect Hono API routes) and #11 (protect SvelteKit routes) can read these directly.
- `event.locals.auth()` (full Clerk `SessionAuthObject`) is also available via svelte-clerk.
