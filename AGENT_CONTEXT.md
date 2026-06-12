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

## Card #18 — snapshot store with chunked D1 batch upsert  ✅ DONE
Files:
- `src/lib/db/snapshots.ts` — `writeSnapshots(db, rows)`: empty input is a no-op (no
  batch issued); builds one prepared upsert and `.bind()`s per row; chunks into batches of
  `D1_MAX_BATCH = 100` via `db.batch()`. `ON CONFLICT(reset_date, observed_at,
  agent_symbol) DO UPDATE` refreshes credits/credit_rank/total_agents/ship_count/faction —
  idempotent retries.
- `src/lib/db/sqlite-d1-adapter.ts` — reusable executable sql.js D1 facade
  (prepare/bind/run/all/first/batch). `bind()` returns a NEW statement to match real D1
  immutability (so `rows.map(s => stmt.bind(...))` yields independent statements, not N
  aliases of the last binding). Shared by the store and (next) orchestrator suites.
- `src/lib/db/snapshots.test.ts` — 5 tests on the adapter: value persistence (rank/totals/
  ship_count/faction read-back), empty-input no-op (batch spy not called), chunk boundary
  (250 rows -> [100,100,50] via batch spy), idempotency (same triple updates in place, one
  row), distinct rows across observations.

Evidence: `bun run ci` -> exit 0; 143 tests passed; `snapshots.ts` 100% lines, adapter
95.83% lines; knip clean; `bun audit` clean; svelte-check 0 errors (1 pre-existing
warning). No network or Worker runtime — pure in-memory sql.js.

## Card #19 — scrape orchestrator  ✅ DONE
Files:
- `src/lib/scrape/run.ts` — `runScrape(deps)` where deps = { client, db, logger,
  scheduledTime }. Reads `resetDate` via the client, lists all agents (client returns them
  pre-sorted credits desc/symbol asc), assigns `credit_rank = index + 1`,
  `total_agents = agents.length`, buckets `scheduledTime` (epoch ms from
  `event.scheduledTime`) to the minute for `observed_at`, builds `AgentSnapshotRow[]`, and
  persists via `writeSnapshots`. Rows are built only after BOTH fetches succeed, so a
  thrown fetch aborts with zero DB writes. Returns a `ScrapeSummary`
  { agentsWritten, observedAt, resetDate, totalAgents } and logs "scrape complete".
- `src/lib/scrape/run.test.ts` — 5 end-to-end tests with a fake client + sql.js adapter:
  full capture (rank/reset/observed/ship_count/faction read-back), minute-bucketing of
  observed_at (drops seconds/ms), idempotency across re-runs of the same slot, abort with
  no writes when status fetch throws (asserts fetchAllAgents not called + batch spy unused),
  abort with no writes when agent fetch throws, and empty-agent-list no-op (no batch).

Evidence: `bun run ci` -> exit 0; 148 tests passed; `run.ts` 100% lines/branches; knip
clean; `bun audit` clean; svelte-check 0 errors (1 pre-existing warning). No network — fake
client injected.

## Card #20 — wire 15-min cron scheduled handler  ✅ DONE
Files:
- `src/lib/scrape/scheduled.ts` — `scheduledScrape(env, event, overrides?)` seam: builds the
  live SpaceTraders client from `globalThis.fetch`, runs `runScrape` against `env.DB` with
  `event.scheduledTime`, logs "scrape complete", and logs+rethrows on failure. Client/logger
  injectable for tests.
- `src/lib/scrape/scheduled.test.ts` — 3 tests: success path (rows stored + info logged),
  failure path (logs "scrape failed" + rethrows + no writes), and a real-client path using a
  stubbed global fetch (proves default wiring works).
- `worker/cron.ts` — dedicated cron Worker: `export default { async scheduled(event, env)
  { await scheduledScrape(env, event); } }`. Awaits so a thrown scrape marks the invocation
  failed.
- `wrangler.cron.toml` — NEW standalone Worker config: name `rankings-trade-cron`,
  `main = ./worker/cron.ts`, `[triggers] crons = ["*/15 * * * *"]`, `[[d1_databases]]`
  binding `DB` -> same `database_name`/`database_id` as the app.
- `package.json` — ONE added script `deploy:cron`. (`wrangler.toml`, `svelte.config.js`,
  `knip.json` UNTOUCHED.)

DESIGN PIVOT (validated with rubber-duck): the planned `worker/index.ts` wrapper at wrangler
`main` is impossible — adapter-cloudflare v7 overwrites `wrangler.main` with its own
generated fetch-only worker on every build (confirmed in adapter source: `worker_dest =
wrangler_config.main; rimraf; copy(template)`, and empirically — my wrapper got clobbered).
A dedicated cron Worker sharing the D1 binding sidesteps the adapter entirely and the app's
bundle.

PRE-EXISTING BLOCKER (flagged to orchestrator, OUT OF SCOPE for Epic D): `wrangler deploy` of
the SvelteKit app fails app-wide on a Clerk bundling error — `No matching export in
@clerk/shared/.../loadClerkJsScript.mjs for import "setClerkJSLoadingErrorPackageName"`
(casing drift between svelte-clerk and @clerk/shared). Reproduced with the DEFAULT config
(no cron), so it is not introduced by Epic D. The cron Worker imports only
`src/lib/scrape/*` + `src/logger.ts` (never SvelteKit/Clerk) and is therefore independently
deployable today.

Evidence:
- `bunx wrangler deploy --dry-run -c wrangler.cron.toml` -> exit 0; "Total Upload 26.45 KiB";
  bindings table lists `env.DB (rankings-trade-dev)  D1 Database`.
- `bun run ci` -> exit 0; 151 tests passed (24 files); `scheduled.ts` 100% lines; knip clean;
  `bun audit` clean; svelte-check 0 errors (1 pre-existing warning). No network in tests.

Caveats carried to closeout/ops: (1) prod needs the REAL D1 `database_id` in BOTH
`wrangler.toml` and `wrangler.cron.toml` (both currently the Epic-A placeholder); (2) run DB
migrations before deploying either Worker (two Workers, one D1 — keep schema-compatible).
