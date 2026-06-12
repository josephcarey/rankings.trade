---
id: 3
title: 'chore: base layout, theming, and structured logging'
status: done
priority: medium
created: 2026-06-11T11:06:41.539672-05:00
updated: 2026-06-12T03:39:28.890124-05:00
started: 2026-06-12T03:00:16.579898-05:00
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

**Dependencies:** A1 (#1)
**Complexity:** S

**Notes**
Workers runtime: confirm pino works under Workers or pick a lightweight structured shim — a small spike inside this card, not a separate card. Use the Result pattern (`{ data, error }`) for expected failures.

## Acceptance Criteria
- [ ] A root `+layout.svelte` renders a nav shell + theme tokens (Open Props), dark-mode aware.
- [ ] A structured logger (pino or a Workers-compatible equivalent) emits JSON with explicit levels; no `console.log` in API code (lint-enforced).
- [ ] Hono emits one canonical log line per request (method, path, status, duration).
- [ ] A consistent API error shape `{ error: { code, message } }` helper exists and is unit-tested.

## Definition of Done
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] README "architecture overview" section describes the logging + error-shape conventions.

[[2026-06-12]] Fri 02:16
Gate "check" failed (exit 1).
$ svelte-check --tsconfig ./tsconfig.json && tsc --noEmit && knip && eslint . && bun audit
error: script "check" exited with code 1

Retry 1/3.

[[2026-06-12]] Fri 02:47
AC2 is not fully met: the acceptance criterion states 'no console.log in API code (lint-enforced)', but there is no `no-console` ESLint rule (or equivalent) configured in eslint.config.js. The unicorn/recommended preset does not include no-console. Nothing in the ESLint config would catch a bare console.log added to src/api/ or any other API file, so the 'lint-enforced' requirement is unmet.
The check script runs `knip --max-issues 8`, which silently allows up to 8 unresolved knip issues to pass CI. This is a workaround that bypasses the dead-code gate rather than properly resolving it. The `src/tools.ts` file (which imports dev-tool packages as side-effects purely to satisfy knip) is a non-standard anti-pattern; knip's `ignoreDependencies` or proper plugin configuration would be the correct fix.
Retry 1/3.

[[2026-06-12]] Fri 03:00
Merge to main failed: bringing card branch up to date with 'main' conflicts:
merge conflict.

[[2026-06-12]] Fri 03:28
This card's branch could not be merged into 'main' because it conflicts with changes another card already merged. Integrate the latest 'main' into your branch and resolve the conflicts: run `git merge main` (or rebase), resolve every conflicted file, commit the resolution, and make sure the project check/test command still passes.
bringing card branch up to date with 'main' conflicts:
conflicting paths:
src/api/app.ts
Retry 1/3.
