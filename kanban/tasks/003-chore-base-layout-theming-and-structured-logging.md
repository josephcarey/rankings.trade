---
id: 3
title: 'chore: base layout, theming, and structured logging'
status: backlog
priority: medium
created: 2026-06-11T10:04:55.788149-05:00
updated: 2026-06-11T10:04:55.788149-05:00
tags:
    - epic-a
    - infra
depends_on:
    - 1
class: standard
---

**Epic:** A — Project scaffold & infrastructure

**Goal**
Establish the shared app shell (nav/layout, CUBE CSS + Open Props theming) and a structured logger so cron/finalization/ingestion code logs consistently from day one.

**Acceptance criteria**
- [ ] A root `+layout.svelte` renders a nav shell + theme tokens (Open Props), dark-mode aware.
- [ ] A structured logger (pino or a Workers-compatible equivalent) emits JSON with explicit levels; no `console.log` in API code (lint-enforced).
- [ ] Hono emits one canonical log line per request (method, path, status, duration).
- [ ] A consistent API error shape `{ error: { code, message } }` helper exists and is unit-tested.

**Definition of done**
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] README "architecture overview" section describes the logging + error-shape conventions.

**Dependencies:** A1 (#1)

**Complexity:** S

**Notes**
Workers runtime: confirm pino works under Workers or pick a lightweight structured shim — a small spike inside this card, not a separate card. Use the Result pattern (`{ data, error }`) for expected failures per code standards.
