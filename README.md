# rankings.trade

A competitive leaderboard for [SpaceTraders](https://spacetraders.io) agents — public
profiles, per-reset rounds, Glicko-2 skill ratings, seasons, titles, and recognition.

> Greenfield build on the studio stack (SvelteKit + Hono + Cloudflare Workers + D1, Bun,
> TypeScript strict). Work is decomposed into a kanban board and driven through
> [Trellis](https://github.com/josephcarey/trellis).

## Status

Bootstrapping. The board (`kanban/`) currently holds **Epic A — project scaffold &
infrastructure** (cards #1–#5). This is the first Trellis run; later epics (B–O) are
decomposed in the planning artifact and added once Epic A lands.

## Documentation

- [`docs/brief.md`](docs/brief.md) — the source product brief (16 epics A–P, locked decisions,
  domain model).
- [`docs/decisions.md`](docs/decisions.md) — resolved design decisions (DEC-1 … DEC-7) that the
  brief flagged as early design cards.

## Board

The board lives in `kanban/` and is managed with [`kanban-md`](https://github.com/josephcarey/trellis).

```sh
kanban-md --dir kanban board      # board summary
kanban-md --dir kanban list       # all cards
kanban-md --dir kanban show 1     # a single card
```

## Development

### Setup

Install dependencies with Bun **first** — before running `bun run check` or `bun run ci`:

```sh
bun install
```

> **Fresh-worktree gotcha.** On a clean checkout, `bun run check` fails immediately
> (`svelte-check: command not found` / missing `.svelte-kit` types) until the generated
> SvelteKit files exist. `bun install` triggers the `prepare: svelte-kit sync` hook that
> generates them, so always run `bun install` first. If `check` still fails with missing
> `.svelte-kit` types, run the sync step manually:
>
> ```sh
> bunx svelte-kit sync
> ```

Copy placeholder environment files for local development:

```sh
cp .env.example .env
cp .dev.vars.example .dev.vars
```

Then fill in your Clerk keys — see [Authentication — Clerk](#authentication--clerk) below.

### Authentication — Clerk

The app authenticates users through [Clerk](https://clerk.com) (`svelte-clerk` on the
frontend, `@clerk/backend` in the Worker). Two keys wire it up locally:

| Variable | File | Visibility | Purpose |
|---|---|---|---|
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env` (and `wrangler.toml` `[vars]` for the deployed Worker) | client-safe, shipped to the browser | initializes the Clerk frontend + SSR handler |
| `CLERK_SECRET_KEY` | `.dev.vars` | server-only, **never** client-exposed | verifies sessions in the Worker runtime |

To set them up:

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com).
2. Open **API keys** and copy the **Publishable key** (`pk_test_…`) and **Secret key**
   (`sk_test_…`).
3. Put the publishable key in `.env` as `PUBLIC_CLERK_PUBLISHABLE_KEY` and the secret key in
   `.dev.vars` as `CLERK_SECRET_KEY`. (Both files are git-ignored; `.env.example` /
   `.dev.vars.example` are the tracked templates.)
4. Optionally set `ADMIN_CLERK_USER_IDS` in `.dev.vars` to a comma-separated allowlist of
   Clerk user IDs that should have admin powers (e.g. the `/admin/seasons` page).

> **Note:** `PUBLIC_CLERK_PUBLISHABLE_KEY` must exist as a Worker **runtime** var, not only a
> build-time var — `svelte-clerk`'s server handler reads it from `$env/dynamic/public` at
> runtime, so it lives in `wrangler.toml` `[vars]` for the deployed app. Publishable keys are
> public by design and safe to commit; secret keys are not.

### Common scripts

```sh
bun run dev      # SvelteKit dev server
bun run build    # Cloudflare Worker bundle via SvelteKit adapter
bun run check    # svelte-check, TypeScript, knip, ESLint, and bun audit
bun run test     # Vitest with coverage
bun run ci       # check + test
bun run db:migrate  # Run pending D1 migrations (requires `wrangler dev` running — see Database & Migrations)
wrangler dev     # serve the Cloudflare Worker locally after a build/sync
```

### Verifying the scaffold

To verify the scaffold is working end-to-end:

```sh
bun run ci       # All checks, tests, and coverage pass
bun run build    # Builds successfully for Cloudflare
wrangler dev     # Serves / (home page) and /api/health locally
```

Do not commit real secrets. D1 is declared as a Cloudflare binding in `wrangler.toml`; migration
logic and schema management land in later cards.

## Database & Migrations

### D1 Setup

The project uses Cloudflare D1 for the database, configured as a binding in `wrangler.toml`.
Local development connects to a local D1 instance via `wrangler dev`.

### Migration System

Migrations are forward-only, run-once SQL files stored in the `migrations/` directory with
numeric prefixes (e.g. `0001_init.sql`, `0002_users.sql`). The migration runner:

1. Applies migrations in lexical order (sorted by filename)
2. Records applied migrations in a `_migrations` bookkeeping table
3. Skips already-applied migrations (idempotent)
4. Fails fast if any migration errors

Each migration may contain multiple SQL statements (separated by `;`).

**Important:** Never edit or delete a shipped migration. Only append new numbered migrations.
A deployed migration is permanent and immutable. Migration numbers are allocated per epic; see
[`migrations/README.md`](migrations/README.md) for the central numbering ledger (and the
documented gaps) before picking a new number.

### Running Migrations (local)

`scripts/db-migrate.ts` runs against the `DB` binding, which only exists inside the Worker
runtime that `wrangler dev` provides. Run the two steps **in this order**:

```sh
# 1. Start the Worker — this provisions/serves the local D1 instance and the DB binding.
wrangler dev

# 2. In a second terminal, apply pending migrations against that binding.
bun run db:migrate
```

If you run `bun run db:migrate` without `wrangler dev` running, it fails because there is no
`DB` binding to connect to. The runner loads all `.sql` files from `migrations/`, checks which
have already been applied, and executes pending ones in order.

### Column Naming Conventions

To keep schema consistent across epics, follow these conventions:

- **Status/state columns:** lowercase, snake_case (e.g. `status`, `agent_symbol`, `reset_date`)
- **Timestamps:** UTC, ISO 8601 format using SQLite's `DATETIME` type with `DEFAULT CURRENT_TIMESTAMP`
- **IDs:** Integer primary keys with `AUTOINCREMENT` unless otherwise specified

The initial migration (`0001_init.sql`) creates the `_migrations` table.

## Architecture

- **Runtime:** Bun for package management and scripts.
- **Frontend:** SvelteKit with strict TypeScript and `@sveltejs/adapter-cloudflare`.
- **Worker/API:** Hono is mounted under `/api`; `GET /api/health` returns `{ "status": "ok" }`.
- **Data:** Cloudflare D1 binding named `DB` is configured only as a binding for now.
- **Quality:** ESLint, knip, Vitest coverage, Prettier defaults, and Bun audit gate local CI.

### Two-worker split (app vs cron)

The project deploys **two** Cloudflare Workers that share the same D1 database:

| Worker | Config | Entry | Deploy | Role |
|---|---|---|---|---|
| App | `wrangler.toml` | `.svelte-kit/cloudflare/_worker.js` (generated) | `bun run deploy` | the SvelteKit app + Hono `/api` (fetch handler) |
| Cron | `wrangler.cron.toml` | `worker/cron.ts` | `bun run deploy:cron` | the 15-minute scrape (`scheduled` handler) |

**Why a separate worker?** `@sveltejs/adapter-cloudflare` v7 owns the main `wrangler.toml` and
overwrites `main` with its own generated, fetch-only worker bundle — there is no supported way
to attach a `scheduled` (cron) handler to the app worker without fighting the adapter. The
scrape therefore lives in a standalone worker (`worker/cron.ts`) configured by
`wrangler.cron.toml`, which binds the same `DB` and is deployed independently with
`bun run deploy:cron`. All real scrape logic lives in the tested `scheduledScrape` seam
(`src/lib/scrape/scheduled.ts`); the cron worker is a thin wrapper. **Deploying the app does
not deploy the cron worker — run both deploy commands.**

### Logging

The project uses a lightweight structured logger (`src/logger.ts`) that:
- Emits JSON to stdout with explicit log levels (`debug`, `info`, `warn`, `error`)
- Is compatible with both Node.js and Cloudflare Workers (no file I/O)
- Is used by Hono middleware to log one canonical line per request

Each log entry includes:
- `level`: log level
- `timestamp`: ISO 8601 timestamp
- `message`: human-readable message
- `name`: logger name (e.g., "api")
- Optional metadata fields

**No direct `console.log` in API code.** All logging goes through the structured logger.

Example request log:
```json
{
  "level": "info",
  "timestamp": "2026-06-12T02:09:03.123Z",
  "message": "request",
  "name": "api",
  "method": "GET",
  "path": "/api/health",
  "status": 200,
  "duration": 5
}
```

### Error Shape

All API errors return a consistent shape via `src/errors.ts`:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

Error codes are machine-readable (e.g., `NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHORIZED`). Use `createErrorResponse(code, message)` to create error responses.

### Theming

- **CSS:** CUBE CSS + Open Props design tokens
- **Theme modes:** user-selectable Light / Dark / System (System = follow
  `prefers-color-scheme`, the default). The choice is persisted in a `theme` cookie and
  applied server-side to `<html data-theme>` (via `hooks.server.ts`), so there's no flash
  of the wrong theme on first paint. The control lives in the nav (user dropdown / drawer)
  and on `/settings`; pure mode/cookie logic is in `src/lib/theme`.
- **Layout:** Root `+layout.svelte` renders the nav shell — a horizontal bar on desktop
  (with Leagues + account dropdowns) that collapses into an accessible hamburger drawer on
  narrow viewports (≤640px).

### Rules / help pages

Public, unauthenticated help content lives as in-repo markdown and is rendered at build
time by [mdsvex](https://mdsvex.pngwn.io/) — no client-side markdown runtime is shipped.

- **Content:** one markdown file per topic in `src/content/rules/`, each with frontmatter
  `title`, `summary`, and `order`.
- **Routes:** `/rules` lists the topics; `/rules/[slug]` renders a topic (the slug is the
  filename without `.md`). Unknown slugs return a 404.
- **Loader:** pure, unit-tested helpers in `src/lib/content/rules.ts` build the topic index
  and resolve a slug; `src/lib/content/rules-registry.ts` globs the markdown modules.
- **Access:** the `/rules` prefix is not in `AUTHED_PREFIXES` (`src/lib/auth/guard.ts`), so
  these pages are public and readable while logged out.

**To add a page:** drop a new `src/content/rules/<slug>.md` with the three frontmatter
fields. It automatically appears on the `/rules` index (ordered by `order`) and renders at
`/rules/<slug>` — no route or code changes needed. Run `bunx svelte-kit sync` before
`svelte-check` when adding routes.

