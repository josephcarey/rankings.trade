---
id: 2
title: 'feat: add D1 binding and forward-only migration runner'
status: backlog
priority: high
created: 2026-06-11T10:04:55.754328-05:00
updated: 2026-06-11T10:04:55.754328-05:00
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

**Acceptance criteria**
- [ ] `wrangler.toml` declares a D1 binding; local `wrangler dev` connects to a local D1.
- [ ] A migration runner applies numbered forward-only SQL files in order, exactly once each, recording applied migrations in a `_migrations` table.
- [ ] Re-running the runner is idempotent (already-applied files are skipped).
- [ ] An initial migration `0001_init.sql` creates the `_migrations` bookkeeping table (or equivalent) and the runner is covered by a unit test against a local D1 / in-memory SQLite.
- [ ] A `bun run` script (e.g. `db:migrate`) is documented in the README.

**Definition of done**
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] Migration files are append-only by convention; README documents "never edit a shipped migration."

**Dependencies:** A1 (#1)

**Complexity:** M

**Notes**
Forward-only, run-once files (no down-migrations) per brief Epic A hint. Later epics add their tables as new numbered migrations. Establish the `agent_symbol` / `reset_date` column-naming conventions here in a short README section so Epics D/E/G stay consistent. Part of the first product slice.
