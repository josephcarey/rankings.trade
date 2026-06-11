---
id: 5
title: 'chore: epic A closeout — scaffold ready as a green base'
status: backlog
priority: medium
created: 2026-06-11T10:04:55.852236-05:00
updated: 2026-06-11T10:04:55.852236-05:00
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

**Acceptance criteria**
- [ ] `bun run ci` green on `main`; the deployed Worker serves `/` and `/api/health`.
- [ ] Migration runner applies cleanly to a fresh D1; README setup steps reproduce a working dev env from scratch.
- [ ] Branch protection confirmed enabled (human gate from A4).

**Definition of done**
- [ ] All acceptance criteria met.
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] Epic A scope statement satisfied end-to-end: a deployable greenfield repo on the studio stack with migrations, CI, and conventions.

**Dependencies:** A1 (#1), A2 (#2), A3 (#3), A4 (#4)

**Complexity:** XS
