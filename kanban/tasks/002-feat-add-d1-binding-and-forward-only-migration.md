---
id: 2
title: 'feat: add D1 binding and forward-only migration runner'
status: done
priority: high
created: 2026-06-11T11:06:41.509289-05:00
updated: 2026-06-12T02:47:40.281049-05:00
started: 2026-06-11T11:46:32.615516-05:00
tags:
    - epic-a
    - infra
depends_on:
    - 1
class: standard
---

**Epic:** A — Project scaffold & infrastructure

**Goal**
Give the Worker a D1 database with a run-once, forward-only migration workflow matching the legacy `migrations/` pattern.

**Dependencies:** A1 (#1)
**Complexity:** M

**Notes**
Forward-only, run-once files (no down-migrations). Later epics add their tables as new numbered migrations. Establish the `agent_symbol` / `reset_date` column-naming conventions here in a short README section so Epics D/E/G stay consistent. Part of the first product slice.

## Acceptance Criteria
- [ ] `wrangler.toml` declares a D1 binding; local `wrangler dev` connects to a local D1.
- [ ] A migration runner applies numbered forward-only SQL files in order, exactly once each, recording applied migrations in a `_migrations` table.
- [ ] Re-running the runner is idempotent (already-applied files are skipped).
- [ ] An initial migration `0001_init.sql` creates the `_migrations` bookkeeping table (or equivalent) and the runner is covered by a unit test against a local D1 / in-memory SQLite.
- [ ] A `bun run` script (e.g. `db:migrate`) is documented in the README.

## Definition of Done
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] Migration files are append-only by convention; README documents "never edit a shipped migration."

[[2026-06-11]] Thu 11:46
Dev agent exited 1.
opencode run errored: {"name":"APIError","data":{"message":"Unauthorized: unauthorized: unauthorized: AuthenticateToken authentication failed","statusCode":401,"isRetryable":false,"responseHeaders":{"content-length":"68","content-security-policy":"default-src 'none'; sandbox","content-type":"text/plain; charset=utf-8","date":"Thu, 11 Jun 2026 16:46:32 GMT","strict-transport-security":"max-age=31536000","x-content-type-options":"nosniff","x-copilot-service-request-id":"7971e8ec-554b-4b3b-9f69-7a22e3da355d","x-github-backend":"Kubernetes","x-github-request-id":"ED8E:9E81B:113ED5:12817C:6A2AE658"},"responseBody":"unauthorized: unauthorized: AuthenticateToken authentication failed\n","metadata":{"url":"https://api.githubcopilot.com/chat/completions"}}}

[[2026-06-11]] Reset blocked→ready: prior block was a spurious opencode↔Copilot 401 auth failure (env), not a dev failure. $0 spent.

[[2026-06-11]] Thu 12:00
Base branch not green: gate "check" exited 1.

[[2026-06-12]] Fri 02:21
scripts/db-migrate.ts is a non-functional stub: it imports only `resolve` from node:path, prints three placeholder log lines, and exits without importing or calling `loadMigrations` or `runMigrations`. Running `bun run db:migrate` applies no migrations at all.
The migration runner functions (`runMigrations`, `loadMigrations`) are never called from any application entry point or from the db:migrate CLI script — they exist only as library code exercised by tests. The acceptance criterion requiring a working runner invoked via `bun run db:migrate` is not met.
SQL conflict: `runMigrations` pre-creates `_migrations` with `CREATE TABLE IF NOT EXISTS _migrations` before executing migration files, but `0001_init.sql` contains `CREATE TABLE _migrations` (without IF NOT EXISTS). In a real D1/SQLite environment the first migration run would throw 'table _migrations already exists'. The mock test does not detect this because `MockD1Statement.run()` silently ignores duplicate CREATE TABLE calls.
Unit tests use a hand-rolled `MockD1Database` JavaScript mock rather than an actual SQLite / local D1 database. The acceptance criterion calls for 'a unit test against a local D1 / in-memory SQLite', and the mock's inability to enforce SQL semantics allows the SQL conflict above to go undetected.
Retry 1/3.
