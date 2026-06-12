---
id: 4
title: 'chore: CI workflow and deploy pipeline'
status: done
priority: medium
created: 2026-06-11T11:06:41.570678-05:00
updated: 2026-06-12T03:46:19.652727-05:00
started: 2026-06-12T03:00:17.629743-05:00
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
- [ ] A GitHub Actions workflow runs `bun run ci` (check + test with coverage) on PRs; high/critical `bun audit` findings fail the build.
- [ ] Coverage gate set at the 80% line floor.
- [ ] A deploy job publishes the Worker on merge to `main` (Wrangler), reading secrets from CI env (Clerk keys, admin key) — never hardcoded.
- [ ] Renovate config added for weekly patch/minor dependency PRs.

## Definition of Done
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] **Human action flagged:** enable branch protection on `main` (require PR, no direct/force push) — recorded as a maintainer to-do.

[[2026-06-12]] Fri 02:25
The deploy workflow (.github/workflows/deploy.yml) does not pass Clerk keys or an admin key from CI secrets. The acceptance criterion explicitly requires: 'A deploy job publishes the Worker on merge to `main` (Wrangler), reading secrets from CI env (Clerk keys, admin key) — never hardcoded.' Only CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are present in the deploy step's env block. At minimum, the workflow should reference CLERK_SECRET_KEY (or equivalent) and ADMIN_KEY (or equivalent) via `${{ secrets.* }}` — either in the env block for `wrangler secret put` steps or however the worker runtime receives them — so that the wiring pattern is established and the secrets are never hardcoded.
Retry 1/3.

[[2026-06-12]] Fri 02:42
Committed-diff gate failed before checks:
worktree has uncommitted changes:
?? IMPLEMENTATION_SUMMARY.md
Retry 1/3.

[[2026-06-12]] Fri 03:00
Merge to main failed: bringing card branch up to date with 'main' conflicts:
merge conflict.

[[2026-06-12]] Fri 03:28
This card's branch could not be merged into 'main' because it conflicts with changes another card already merged. Integrate the latest 'main' into your branch and resolve the conflicts: run `git merge main` (or rebase), resolve every conflicted file, commit the resolution, and make sure the project check/test command still passes.
bringing card branch up to date with 'main' conflicts:
conflicting paths:
package.json
Retry 1/3.

[[2026-06-12]] Fri 03:39
This card's branch could not be merged into 'main' because it conflicts with changes another card already merged. Integrate the latest 'main' into your branch and resolve the conflicts: run `git merge main` (or rebase), resolve every conflicted file, commit the resolution, and make sure the project check/test command still passes.
bringing card branch up to date with 'main' conflicts:
conflicting paths:
knip.json
package.json
Retry 2/3.
