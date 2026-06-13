# Migrations — numbering ledger

Forward-only, run-once SQL migrations applied by `scripts/db-migrate.ts` (`bun run db:migrate`),
recorded in the `_migrations` bookkeeping table and run in lexical filename order. See the
[root README — Database & Migrations](../README.md#database--migrations) for how to run them
locally (`wrangler dev` must be running to provide the `DB` binding).

## Why this ledger exists

Migration **numbers are allocated per epic** so that parallel epic work can write migrations
without colliding. That is a good parallel-work pattern, but it produces **gaps** when a
reserved number is never used (or an abandoned working number is skipped). Without a central
record, a future dev sees a "free" number and reuses it — producing two different migrations
with the same prefix across branches. **This file is that central record.** Before adding a
migration, take the next unused number **after** the highest one listed here, and add a row.

## Rules

- **Never edit or delete a shipped migration.** A deployed migration is permanent and immutable.
- **Append only.** New migrations take the next free number after the highest in this ledger.
- **Update this ledger** in the same change that adds a migration (filename → owning epic).
- **Do not reuse** any number listed as a gap below, even though it looks free.

## Ledger

| # | File | Owning epic | Notes |
|---|---|---|---|
| 0001 | `0001_init.sql` | A — scaffold | Creates the `_migrations` bookkeeping table. |
| 0002 | `0002_users.sql` | B — auth | Users linked to Clerk user IDs. |
| 0003 | `0003_agents.sql` | C — agents | Agents, per-agent API tokens, ownership audit trail. |
| 0004 | `0004_leagues.sql` | E — leagues | Leagues, temporal membership, shareable invites. |
| 0005 | `0005_seed_spacejam_league.sql` | E (E12) | Seeds the legacy SpaceJam crew as a starter league. |
| 0006 | `0006_bot_ingestion.sql` | F — ingestion | Freeform logs, tolerant milestones, milestone-type table. |
| 0007 | `0007_seed_milestone_types.sql` | F (DEC-4) | Seeds the six DEFAULT global milestone types. |
| 0008 | `0008_rounds.sql` | G — rounds | Rounds and their frozen final standings. |
| **0009** | — | — | **GAP — unexplained.** No 0009 migration was ever committed; the reason is undocumented. Do **not** reuse. (See the note comment at the top of `0010_snapshots.sql`.) |
| 0010 | `0010_snapshots.sql` | D — scrape | 15-min cron snapshots of each public agent's credits/rank per round. |
| 0011 | `0011_ratings.sql` | H — ratings | Season-scoped Glicko-2 ratings + rating-period idempotency marker. |
| 0012 | `0012_seasons.sql` | I — seasons | Universe seasons lifecycle (activates ranked rounds). |
| 0013 | `0013_season_standings.sql` | I — seasons | Per-season archived final standings (rating, rank, title). |
| **0014** | — | I / J — titles | **RESERVED, UNUSED.** Reserved for a `title_tiers` config table, but DEC-2 keeps the title ladder in `src/lib/titles/config.ts` instead, so no table shipped. Do **not** reuse. |
| **0015** | — | K — import/cutover | **RESERVED, UNUSED.** The Epic K legacy import needs no new migration (idempotency comes from existing keys — see `docs/runbooks/k-cutover.md` §2). Do **not** reuse. |
| **0016** | — | K — import/cutover | **RESERVED, UNUSED.** Same as 0015. Do **not** reuse. |
| 0017 | `0017_rating_history.sql` | O — history | Append-only per-round Glicko-2 rating history (deltas + rating-over-time). |
| 0018 | `0018_open_season_standings.sql` | Perf (audit §8.1) | Materialized cache of the OPEN season's live standings; written on ranked-round finalize, read by the leaderboard/profile paths instead of recomputing per request. |

### Gap summary

- **0009** — unexplained gap; never committed, origin undocumented.
- **0014** — reserved for title tiers, unused (DEC-2 put the ladder in config; see
  [`docs/decisions.md`](../docs/decisions.md)).
- **0015–0016** — reserved for Epic K, unused (the import adds no migration; see
  [`docs/runbooks/k-cutover.md`](../docs/runbooks/k-cutover.md)).

The next free migration number is **0019**.
