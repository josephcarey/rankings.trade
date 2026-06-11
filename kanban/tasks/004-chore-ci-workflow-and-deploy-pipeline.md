---
id: 4
title: 'chore: CI workflow and deploy pipeline'
status: ready
priority: medium
created: 2026-06-11T11:06:41.570678-05:00
updated: 2026-06-11T11:28:06.854556-05:00
tags:
    - epic-a
    - infra
depends_on:
    - 1
class: standard
---

**Epic:** A — Project scaffold & infrastructure

**Goal**
Run `bun run ci` on every PR and deploy the Worker on merge to the default branch.

**Dependencies:** A1 (#1)
**Complexity:** S

**Notes**
Branch protection cannot be set by an agent — the closeout card (#5) surfaces it as a human gate.

## Acceptance Criteria
- [x] A GitHub Actions workflow runs `bun run ci` (check + test with coverage) on PRs; high/critical `bun audit` findings fail the build.
- [x] Coverage gate set at the 80% line floor.
- [x] A deploy job publishes the Worker on merge to `main` (Wrangler), reading secrets from CI env (Clerk keys, admin key) — never hardcoded.
- [x] Renovate config added for weekly patch/minor dependency PRs.

## Definition of Done
- [x] All acceptance criteria met.
- [x] Tests written and passing (`bun run ci` green).
- [x] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] **Human action flagged:** enable branch protection on `main` (require PR, no direct/force push) — recorded as a maintainer to-do.
