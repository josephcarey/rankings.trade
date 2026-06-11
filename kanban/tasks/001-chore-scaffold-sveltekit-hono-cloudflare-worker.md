---
id: 1
title: 'chore: scaffold SvelteKit + Hono + Cloudflare Worker repo'
status: backlog
priority: high
created: 2026-06-11T10:04:55.719176-05:00
updated: 2026-06-11T10:04:55.719176-05:00
tags:
    - epic-a
    - infra
class: standard
---

**Epic:** A — Project scaffold & infrastructure

**Goal**
Stand up the empty greenfield repo on the studio stack so the app builds, runs locally, and deploys a hello-world Worker.

**Acceptance criteria**
- [ ] `bun install` succeeds; repo uses Bun + TypeScript strict (`"strict": true`).
- [ ] SvelteKit app builds with the Cloudflare adapter and serves a placeholder home page.
- [ ] A Hono router is mounted under `/api` and `GET /api/health` returns `{ status: "ok" }`.
- [ ] `wrangler dev` serves the Worker locally; `bun run build` produces a deployable bundle.
- [ ] `package.json` defines `check` (`tsc --noEmit && knip && eslint . && bun audit`), `test` (vitest + coverage), and `ci` (`check && test`) per studio standards.
- [ ] ESLint (unicorn/svelte/perfectionist/depend/security) + Prettier configured; `bun run check` passes on the empty scaffold.

**Definition of done**
- [ ] All acceptance criteria met.
- [ ] Tests written and passing (`bun run ci` green).
- [ ] Evidence (commands run + output) captured in the task context file.
- [ ] PR opened, reviewed, and merged.
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` present; `README.md` covers setup/scripts/architecture.
- [ ] `.gitignore` includes the secrets block (`.env`, `.env.*`, `!.env.example`, `.dev.vars`, `.dev.vars.*`, `!.dev.vars.example`); `.dev.vars.example` + `.env.example` committed.

**Dependencies:** none

**Complexity:** M

**Notes**
Recommended first Trellis card. Mirrors the Steward/standard stack. Do not wire Clerk or D1 logic here beyond bindings — that is A2/Epic B. Part of the first product slice.
