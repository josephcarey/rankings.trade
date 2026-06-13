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

Install dependencies with Bun:

```sh
bun install
```

Copy placeholder environment files for local development:

```sh
cp .env.example .env
cp .dev.vars.example .dev.vars
```

### Common scripts

```sh
bun run dev      # SvelteKit dev server
bun run build    # Cloudflare Worker bundle via SvelteKit adapter
bun run check    # svelte-check, TypeScript, knip, ESLint, and bun audit
bun run test     # Vitest with coverage
bun run ci       # check + test
bun run db:migrate  # Run pending D1 migrations (note: requires local development setup)
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
numeric prefixes (e.g. `0001_init.sql`, `0002_add_users.sql`). The migration runner:

1. Applies migrations in lexical order (sorted by filename)
2. Records applied migrations in a `_migrations` bookkeeping table
3. Skips already-applied migrations (idempotent)
4. Fails fast if any migration errors

**Important:** Never edit or delete a shipped migration. Only append new numbered migrations.
A deployed migration is permanent and immutable.

### Running Migrations

To manually run pending migrations during development:

```sh
bun run db:migrate
```

The runner loads all `.sql` files from `migrations/`, checks which have already been applied,
and executes pending ones in order. Each migration may contain multiple SQL statements
(separated by `;`).

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
- **Dark mode:** Respects `prefers-color-scheme` media query
- **Layout:** Root `+layout.svelte` renders nav shell with theme-aware styles

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

