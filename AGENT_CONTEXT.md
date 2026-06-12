# Implementation Summary: Card #8 — feat: add Clerk magic-link sign-in and sign-out routes

> Implemented manually (Lever-2 autonomous dev blocked by the opencode→Copilot 400). UI built on
> `svelte-clerk`'s prebuilt components; the testable logic is isolated into pure `.ts` modules + a
> server load, since the repo has no Svelte component test tooling (Clerk's client components run the
> real Clerk JS SDK and can't run in unit tests).

## What was built
| File | Change |
|---|---|
| `src/lib/auth/nav.ts` (+test) | `toNavState(locals)` — pure signed-in/out derivation from `locals.userId` |
| `src/lib/auth/redirect.ts` (+test) | `safeRedirectTarget(raw)` — open-redirect-safe post-login target (same-origin path only; rejects `//`, backslash/whitespace, and the sign-in route itself) |
| `src/routes/+layout.server.ts` (+test) | `load` returns `buildClerkProps(locals.auth())` (Clerk SSR state) + `nav: toNavState(locals)` |
| `src/routes/+layout.svelte` | Wrap app in `<ClerkProvider>`; nav shows `<UserButton>` + `<SignOutButton redirectUrl="/">` when signed in, else a "Sign in" link |
| `src/routes/sign-in/[...rest]/+page.svelte` | Renders Clerk `<SignIn routing="path" path="/sign-in" fallbackRedirectUrl={data.redirectTo}>` (magic-link email flow + in-component verification + sso-callback subpath) |
| `src/routes/sign-in/[...rest]/+page.server.ts` (+test) | `load` computes the sanitized destination; redirects an already-verified user off the sign-in flow; hands guests the fallback target |

## Design
- **`<ClerkProvider>`** (svelte-clerk root) auto-reads `initialState` from `page.data` (provided by the
  layout load via `buildClerkProps`) and the publishable key from `PUBLIC_CLERK_PUBLISHABLE_KEY` env —
  no props needed. It must wrap the whole app so `<SignIn>`/`<UserButton>`/`<SignOutButton>` have Clerk context.
- **Catch-all `/sign-in/[...rest]`** hosts Clerk's path-routed `<SignIn>` so `/sign-in`,
  `/sign-in/sso-callback`, and any Clerk subpath all resolve to the same page+load. A rest param matches
  zero-or-more segments, so the base `/sign-in` is covered too. (`[...rest]`, not optional `[[...rest]]`,
  which SvelteKit's sync rejects pairing with a `+page.server.ts` cleanly.)
- **Post-verification redirect** — after Clerk completes magic-link verification client-side and sets
  the session cookie, navigation re-runs the load; `locals.userId` is now set, so the load redirects to
  the sanitized destination. The same `safeRedirectTarget` value is passed to `<SignIn fallbackRedirectUrl>`
  so Clerk's own completion lands on the intended page.
- **Sign-out (AC2)** — Clerk `<SignOutButton redirectUrl="/">` clears the session client-side and
  redirects to the public home. (No fake server action: only Clerk can revoke its session.)

## AC4 — "callback routing tested with a faked Clerk verification (no live email)"
Interpreted (per design constraints) as: a faked Clerk verification == authenticated `locals` on the
callback route. `page.server.test.ts` exercises the load with callback-like URLs:
- guest on `/sign-in/sso-callback` → no redirect, renders `<SignIn>`;
- verified (authed locals) on `/sign-in/sso-callback?redirect_url=/dashboard` → 303 → `/dashboard`;
- verified + open-redirect param (`//evil`) → 303 → `/`.

## Key decisions
1. **Pure `.ts` seams for everything testable** — `toNavState`, `safeRedirectTarget`, and the two loads
   are unit-tested; the `.svelte` components (uncovered) are excluded from coverage (`include: src/**/*.ts`).
2. **Open-redirect hardening on `redirect_url`** — explicit allowlist (same-origin absolute path), plus a
   self-redirect-loop guard for the sign-in route.
3. **Colocated route tests named without the `+` prefix** (`layout.server.test.ts`,
   `page.server.test.ts`) — SvelteKit reserves `+`-prefixed filenames for route files; vitest still
   picks them up via `src/**/*.test.ts`.

## Tests / CI
- 77 tests, 14 files; all new `.ts` at 100% coverage; global 97.79%. `bun run ci` green
  (svelte-check 0/0, tsc, knip, eslint, `bun audit`, vitest ≥80%).

## Notes for downstream cards
- `data.nav` (`{ signedIn, userId }`) is available to every page via the root layout.
- Protected SvelteKit routes (card #11) can redirect guests to `/sign-in?redirect_url=<intended>`;
  this load already honors that param safely on return.
