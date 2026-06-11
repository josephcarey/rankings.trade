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

Scripts land in card **A1** (`bun install`, `bun run check`, `bun run test`, `bun run ci`,
`bun run build`, `wrangler dev`). See the README updates that A1–A4 will add.
