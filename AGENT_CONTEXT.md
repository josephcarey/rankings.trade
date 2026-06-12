# Implementation Summary: Card #7 — feat: add Clerk SvelteKit SDK and Worker secret wiring

> Implemented manually by the assistant (not via the autonomous dev agent). The orchestrated runs of
> this card were hard-blocked by an opencode forced-completion 400 (see overnight log); a likely
> contributor was that the card named a **non-existent npm package** (`@clerk/sveltekit`), turning the
> task unsatisfiable and driving the agent to thrash to its step cap.

## ⚠️ Confirmed Clerk SvelteKit API surface (the spike — card #15 depends on this)

- **There is NO first-party `@clerk/sveltekit` package on npm.** Clerk ships no official SvelteKit SDK.
  The card/brief named one that does not exist. Decision (user-confirmed): use **`svelte-clerk`**.
- **Dependency:** `svelte-clerk@^1.1.9` (community, actively maintained). Wraps the official
  `@clerk/backend@3.4.8`. Peer deps satisfied by the repo: `@sveltejs/kit ^2.65`, `svelte ^5.56`.
- **Server handler (for card #15's `hooks.server.ts`):**
  `import { withClerkHandler } from "svelte-clerk/server";`
  Signature: `withClerkHandler(options?: ClerkSvelteKitMiddlewareOptions): Handle`
  where `ClerkSvelteKitMiddlewareOptions = AuthenticateRequestOptions & { debug?: boolean }`.
- **`sequence()` chaining:** the returned value is a standard SvelteKit `Handle`, so card #15 chains it
  via `import { sequence } from "@sveltejs/kit/hooks"` exactly as planned.
- **Session access:** the handler populates `event.locals.auth()` (Clerk's `getAuth`-style accessor
  from `@clerk/backend`); signed-out requests yield a null `userId`. Card #15 types `App.Locals`
  against this.
- **Key split (IMPORTANT):** the **secret key is sourced from the environment, NOT passed as a handler
  option** — `svelte-clerk/env` reads `CLERK_SECRET_KEY` (and `PUBLIC_CLERK_PUBLISHABLE_KEY`) from
  SvelteKit's env modules. `secretKey` is therefore absent from `ClerkSvelteKitMiddlewareOptions`;
  only `publishableKey` is an option. Env var name conventions confirmed from the SDK's own messages:
  `PUBLIC_CLERK_*` (publishable, client-safe) and `CLERK_SECRET_KEY` (server-only).
- **Client SDK** (later card): `svelte-clerk` (root export) provides `<ClerkProvider>` + components/stores.

## What was built (this card — config + key handling only; no `hooks.server.ts` session logic)

| File | Change |
|---|---|
| `package.json` | Added `svelte-clerk@^1.1.9`; added `js-cookie: ^3.0.7` override (see security note) |
| `src/platform.ts` | Added `CLERK_SECRET_KEY: string` to `CloudflareBindings` (Worker runtime env path) |
| `src/lib/auth/clerk-keys.ts` | New — `getClerkKeys(env)` typed accessor + `ClerkKeys` / `ClerkKeyEnv` types |
| `src/lib/auth/clerk-keys.test.ts` | New — 5 unit tests (present / trimmed / each-missing / empty) |
| `.env.example` | Added `PUBLIC_CLERK_PUBLISHABLE_KEY` (name + comment, no real value) |
| `.dev.vars.example` | Documented `CLERK_SECRET_KEY` as the server-only Worker secret |

### Key accessor design
- `getClerkKeys(env)` reads `PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` from the runtime env
  (Epic A's `event.platform.env` path), trims, and **throws** on missing/empty — missing auth keys are
  an unrecoverable startup misconfiguration (per code standards, throw is reserved for exactly this).
- `ClerkKeys.publishableKey` is typed as
  `NonNullable<ClerkSvelteKitMiddlewareOptions["publishableKey"]>`, tying the accessor to the SDK's own
  `withClerkHandler` option so card #15 stays in sync (this is also what proves the SDK import resolves
  and typechecks).
- Pure and side-effect-free: the env is passed in (no `$env/*` magic-module import), so it unit-tests
  trivially with a fake env and stays usable from both the Worker runtime and tests.

## Key decisions
1. **`svelte-clerk` over `@clerk/backend` (raw):** matches the cards' assumed `withClerkHandler` +
   `sequence()` + `locals.auth()` surface with the least friction; keeps #7/#15 coherent.
2. **Both keys via the runtime env object, accessor takes it as an argument:** keeps the function pure
   and testable; the publishable key uses the `PUBLIC_` prefix so SvelteKit can also surface it to the
   browser for the client SDK in a later card.
3. **No `hooks.server.ts` session wiring** — deliberately deferred to card #15 (kept this turn bounded).

## Security note
`svelte-clerk → @clerk/backend → @clerk/shared → js-cookie@<=3.0.5` carries a HIGH advisory
(GHSA-qjx8-664m-686j, cookie-attribute injection; fixed in 3.0.7). Pinned via a `package.json`
`overrides` entry `"js-cookie": "^3.0.7"` (matching the repo's existing `cookie` override pattern).
`bun audit` is clean.

## Tests / CI
- `src/lib/auth/clerk-keys.test.ts` — 5 tests; `clerk-keys.ts` at **100%** line/branch/function coverage.
- Full suite: 51 tests, 8 files, all passing. `svelte-check` 0/0. `bun run ci` **green** (tsc, knip,
  eslint, `bun audit`, vitest ≥80% coverage all pass).
