# AGENTS.md — rankings.trade

Durable, project-specific notes for agents (and humans) working in this repo. Keep it short and
factual; link to the README/runbooks rather than duplicating them.

Stack: SvelteKit + Hono + Cloudflare Workers + D1, Bun, TypeScript (strict).

## Setup & checks — read this first

- **Run `bun install` before `bun run check` / `bun run ci`.** On a clean checkout/worktree,
  `bun run check` fails (`svelte-check: command not found` / missing `.svelte-kit` types) until
  the generated SvelteKit files exist. `bun install` runs the `prepare: svelte-kit sync` hook
  that generates them.
- If `check` still fails with missing `.svelte-kit` types, run `bunx svelte-kit sync` manually.
- CI is `bun install && bun run ci` (`ci` = `check` + `test`; `check` includes svelte-check,
  `tsc`, knip, ESLint, and `bun audit`). Don't add new lint/build/test tooling without cause.

## Two-worker split (app vs cron) — don't forget the cron worker

The project deploys **two** Cloudflare Workers sharing one D1:

- **App** — `wrangler.toml`, generated entry `.svelte-kit/cloudflare/_worker.js`,
  `bun run deploy`. The `@sveltejs/adapter-cloudflare` adapter **owns** `wrangler.toml` and
  overwrites `main` with its own fetch-only bundle.
- **Cron** — `wrangler.cron.toml`, entry `worker/cron.ts`, `bun run deploy:cron`. Runs the
  15-minute `scheduled` scrape because the adapter leaves no room for a cron handler on the app
  worker. Thin wrapper over the tested `scheduledScrape` seam in `src/lib/scrape/scheduled.ts`.

`bun run deploy` does **not** deploy the cron worker — run both when shared code or schema
changes. See [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md).

## Local D1 sequence

`scripts/db-migrate.ts` needs the `DB` binding, which only exists inside `wrangler dev`. Order:
`wrangler dev` (terminal 1) → `bun run db:migrate` (terminal 2). Running `db:migrate` without
`wrangler dev` fails (no binding).

## Migration-numbering convention (per-epic allocation + ledger)

- Migrations are forward-only, run-once, lexical-order; **never edit or delete a shipped one**.
- Numbers are allocated **per epic** to allow parallel work, which produces intentional **gaps**.
  [`migrations/README.md`](migrations/README.md) is the **central ledger** (filename → owning
  epic) and the authority on gaps. Known gaps: **0009** (unexplained, never committed),
  **0014** (reserved title-tiers, unused — DEC-2 keeps the ladder in config), **0015–0016**
  (reserved Epic K, unused).
- **Before adding a migration:** take the next free number *after the highest in the ledger* (do
  not reuse a gap), and **update the ledger in the same change**.

## Auth — Clerk

`PUBLIC_CLERK_PUBLISHABLE_KEY` (client-safe; in `.env` and `wrangler.toml` `[vars]` as a Worker
**runtime** var) + `CLERK_SECRET_KEY` (server-only; `.dev.vars`). Admin pages
(`/admin/seasons`) are gated by `ADMIN_CLERK_USER_IDS`. See the README "Authentication — Clerk"
section. Don't commit secrets; `.env`/`.dev.vars` are git-ignored, the `*.example` files are the
tracked templates.

## Conventions

- Conventional commits, with the trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Decisions live in [`docs/decisions.md`](docs/decisions.md) (`DEC-*`) and are referenced from
  code; operational procedures live in [`docs/runbooks/`](docs/runbooks/).
