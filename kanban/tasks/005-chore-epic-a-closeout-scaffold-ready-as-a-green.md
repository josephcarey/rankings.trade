---
id: 5
title: 'chore: epic A closeout — scaffold ready as a green base'
status: done
priority: medium
created: 2026-06-11T11:06:41.60178-05:00
updated: 2026-06-12T04:06:01.731604-05:00
tags:
    - epic-a
    - closeout
depends_on:
    - 1
    - 2
    - 3
    - 4
class: standard
---

**Epic:** A — Project scaffold & infrastructure (closeout)

**Goal**
Verify the scaffold is a green, deployable base every later epic can build on.

**Dependencies:** A1 (#1), A2 (#2), A3 (#3), A4 (#4)
**Complexity:** XS

## Acceptance Criteria
- [ ] `bun run ci` green on `main`; the deployed Worker serves `/` and `/api/health`.
- [ ] Migration runner applies cleanly to a fresh D1; README setup steps reproduce a working dev env from scratch.
- [ ] Branch protection confirmed enabled (human gate from A4).

## Definition of Done
- [ ] All acceptance criteria met.
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] Epic A scope satisfied end-to-end: a deployable greenfield repo on the studio stack with migrations, CI, and conventions.

[[2026-06-12]] Fri 03:52
Committed-diff gate failed before checks:
no commits diverging from 'main'
committed tree is identical to 'main'
Retry 1/3.

[[2026-06-12]] Fri 03:57
Committed-diff gate failed before checks:
no commits diverging from 'main'
committed tree is identical to 'main'
Retry 2/3.
