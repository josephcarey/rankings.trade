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

---

## Evidence: `bun run ci` Output

```
$ bun run check && bun run test
$ svelte-check --tsconfig ./tsconfig.json && tsc --noEmit && knip --include dependencies,exports,types,files && eslint . && bun audit
Loading svelte-check in workspace: /Users/josephcarey/rankings.trade/.trellis/worktrees/4
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
[0m[1mbun audit [0m[2mv1.3.14 (0d9b296a)[0m
No vulnerabilities found
$ vitest run --coverage

 RUN  v4.1.8 /Users/josephcarey/rankings.trade/.trellis/worktrees/4
      Coverage enabled with v8


 Test Files  2 passed (2)
      Tests  3 passed (3)
   Start at  16:40:00
   Duration  378ms (transform 74ms, setup 0ms, import 172ms, environment 1ms)

 % Coverage report from v8
------------------|---------|----------|---------|---------|-------------------
File              | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
------------------|---------|----------|---------|---------|-------------------
------------------|---------|----------|---------|---------|-------------------

=============================== Coverage summary ===============================
Statements   : 100% ( 7/7 )
Branches     : 100% ( 2/2 )
Functions    : 100% ( 2/2 )
Lines        : 100% ( 6/6 )
================================================================================
```

✅ All checks pass. Coverage exceeds 80% threshold (100% achieved).

## Implementation Details

### Workflows Created
1. **`.github/workflows/ci.yml`** — Runs on PR and push to `main`:
   - Checks (tsc, knip, eslint, svelte-check, bun audit) with failure on high/critical vulns
   - Tests with coverage reporting to Codecov
   - 80% line coverage gate set in `vite.config.ts`

2. **`.github/workflows/deploy.yml`** — Runs on push to `main`:
   - Builds Worker with `bun run build`
   - Deploys via `wrangler deploy`
   - Reads Clerk keys and ADMIN_KEY from CI secrets (never hardcoded)

3. **`.github/workflows/release.yml`** — Already exists for changelogithub on version tags

### Configuration Updates
- **`renovate.json`** — Configured for weekly patch/minor PRs only (majors disabled via `packageRules`)
- **`vite.config.ts`** — Coverage threshold set to 80% lines
- **`package.json` scripts** — `check` and `test` already in place from card #1

## ⚠️ Human Action Required

**Branch Protection:** Enable on `main` branch:
1. Go to GitHub repo Settings → Branches
2. Add rule for `main`
3. Check: ✓ Require a pull request before merging
4. Check: ✓ Do not allow bypassing the above settings
5. Save rule

This prevents direct pushes and force pushes to `main`, ensuring all changes flow through reviewed PRs.
