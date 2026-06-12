# AGENT_CONTEXT — Epic D (Scraping & snapshots)

Working branch: `josephcarey/epic-d-scraping-snapshots`. One commit per card; one PR to
`main` at closeout (main is checked out in the protected main checkout, so the local
checkout-main/merge flow is not possible from this worktree).

## Foundational: esbuild audit fix (commit 80c7ce8)
`bun run ci` was red on `main` solely from `bun audit` (GHSA-gv7w-rqvm-qjhr, esbuild
< 0.28.1, transitive via vite ^0.28.0 vs wrangler's exact 0.27.3 pin). Added
`overrides.esbuild = "^0.28.1"`. Verified: build OK, `bun audit` clean, full CI green.
Recommended the orchestrator land the same override on `main` for Epic C.

## Card #16 — snapshots schema migration + port-boundary types  ✅ DONE
Files:
- `migrations/0010_snapshots.sql` — `snapshots` table (id, reset_date, observed_at,
  agent_symbol, credits, credit_rank, total_agents, ship_count, faction; UNIQUE triple)
  + `idx_snapshots_agent_time`, `idx_snapshots_reset_time`. Dropped net-worth + chart_*;
  kept ship_count; added faction. Migration number 0010 claimed (0003-0009 left for Epic C).
- `src/lib/db/snapshots-types.ts` — `AgentSnapshotRow`, `PublicAgent`, `SpaceTradersClient`
  (the port boundary). The two not-yet-consumed exports are tagged `@public` for knip.
- `src/lib/db/snapshots-migration.test.ts` — loads the real migrations dir, runs the
  runner, and asserts: full-row round-trip, UNIQUE enforcement, multi-observation allowed,
  ship_count/faction present & net-worth/chart columns absent, both indexes created.

Evidence:
- `bunx vitest run src/lib/db/snapshots-migration.test.ts` -> 5 passed.
- `bun run ci` -> exit 0; svelte-check 0 errors (1 pre-existing warning); knip clean;
  `bun audit` clean; 129 tests passed; coverage >= 80% floor held.

## Card #17 — SpaceTraders API client  ✅ DONE
Files:
- `src/lib/scrape/spacetraders-client.ts` — `createSpaceTradersClient({ fetch })`
  implementing `SpaceTradersClient`. `fetchStatus()` returns the round `resetDate`
  (throws on non-OK / missing). `fetchAllAgents()` paginates `/agents?limit=20&page=N`,
  maps symbol/credits/shipCount/faction (startingFaction), terminates on a short page or
  when `meta.total` is reached, sorts credits desc then symbol asc. Throws (no partial
  list) on any non-OK page.
- `src/lib/scrape/spacetraders-client.test.ts` — 9 tests with a fake `fetch`: status
  happy/abort paths, single-page mapping, tie-break sort, short-page + meta.total
  termination (asserts page-2 stop), non-OK page abort.

Evidence: `bun run ci` -> exit 0; 138 tests passed; `src/lib/scrape` 100% lines; no
network calls (injected fake fetch).
