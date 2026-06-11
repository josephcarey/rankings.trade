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

Install dependencies with Bun:

```sh
bun install
```

Common scripts:

```sh
bun run dev      # SvelteKit dev server
bun run build    # Cloudflare Worker bundle via SvelteKit adapter
bun run check    # svelte-check, TypeScript, knip, ESLint, and bun audit
bun run test     # Vitest with coverage
bun run ci       # check + test
wrangler dev     # serve the Cloudflare Worker locally after a build/sync
```

Copy the placeholder environment files for local development when needed:

```sh
cp .env.example .env
cp .dev.vars.example .dev.vars
```

Do not commit real secrets. D1 is declared as a Cloudflare binding in `wrangler.toml`; migration
logic and schema management land in later cards.

## Architecture

- **Runtime:** Bun for package management and scripts.
- **Frontend:** SvelteKit with strict TypeScript and `@sveltejs/adapter-cloudflare`.
- **Worker/API:** Hono is mounted under `/api`; `GET /api/health` returns `{ "status": "ok" }`.
- **Data:** Cloudflare D1 binding named `DB` is configured only as a binding for now.
- **Quality:** ESLint, knip, Vitest coverage, Prettier defaults, and Bun audit gate local CI.
