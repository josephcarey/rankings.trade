# rankings.trade — v1 Codebase Audit

**Scope:** Read-only audit of the full v1 build (Epics A–O, all merged to `main` at `07e270e`).
**Method:** Source read against the studio `code-standards`, `backend-standards`, and `ui-standards` skills; claims verified against the code (file:line) and a clean `bun run ci` run.
**Nature:** Recommendations only. No source, tests, config, or migrations were modified.

---

## Executive summary

This is a genuinely strong v1. CI is green (`90` test files, `854` tests, `94.8%` line / `84.7%` branch coverage), the high-risk surfaces (bot auth, IDOR, Glicko-2 atomic apply, season-close, import) are carefully built with idempotency-by-construction, and the codebase is clean (no stray `console.log` outside the structured logger, almost no `any`, consistent Hono error envelopes, well-chosen indexes). The seam-interface architecture that let Epics build in parallel is a model worth codifying.

The findings below are mostly **polish and hardening**, not breakage. Nothing is launch-blocking in the "it's broken" sense, but four items are worth doing **before** a public launch with real bot traffic:

1. The **public read-API rate limiter is trivially bypassable** by randomizing the bearer token (§6.1).
2. **Open-season standings are recomputed from scratch on every read** — an O(N) full-table recompute on the busiest public surfaces, with no caching (§8.1).
3. **Zero Svelte component tests** — chart/badge/delta UI logic is invisible to CI (§7.1).
4. The **`svelte-kit sync` fresh-worktree gotcha** is undocumented and breaks first-run `bun run check` (§9.1 — hit during this audit).

### Findings by severity

| Severity | Count |
|---|---|
| Blocking | 0 |
| High | 4 |
| Medium | 16 |
| Low | 15 |
| Nit | 3 |

Severity = user/operator/maintenance impact. Effort = rough implementation size (S < ½ day, M ≈ 1–2 days, L > 2 days).

---

## 1. Simplification & duplication

**Strengths.** Good reuse where it counts: `buildLeaderboard` wraps `computeSeasonStandings` rather than re-deriving ranks (`src/lib/db/leaderboard.ts:52`); the competition-rank helper `rankByRatingDesc` is shared between the live leaderboard and `rating_history` so a leaderboard rank and a history rank for the same round agree *by construction* (`src/lib/seasons/standings.ts:54`, `src/lib/ratings/trigger.ts:109`). The read-service composes pure helpers and only SELECTs. This is the opposite of fork-drift and should be the template.

### 1.1 — Two near-duplicate inline-SVG chart components — Medium / M
`src/lib/components/credits-chart.svelte` and `src/lib/components/rating-chart.svelte` share identical SVG scaffolding (`viewBox`, `preserveAspectRatio="none"`, `aspect-ratio: 3/1`, axis math) but diverge ad hoc: credits is multi-series with a legend + `<figcaption>`, rating is single-series with a hardcoded `#7c3aed` stroke and no legend. Both are fed by the same `buildLineChart` (`src/lib/charts/line-chart.ts`).
**Recommendation:** Collapse into one `<LineChart>` with an optional `legend`/`multiSeries` prop and a tokenized stroke palette. Removes a whole component's worth of drift surface.

### 1.2 — Per-page table/badge/utility CSS duplicated across routes — Medium / M
`.ranks` / `table` / `.num` / `.eyebrow` / `.empty` and the `badge-*` classes are re-declared in nearly identical form in `src/routes/leaderboard/+page.svelte`, `src/routes/leagues/[id]/+page.svelte:307`, `src/routes/u/[symbol]/+page.svelte:212`, `src/routes/admin/seasons/+page.svelte:66`, and `src/routes/agents/+page.svelte:158`. ~150 lines of copy-paste.
**Recommendation:** Promote table, badge, `.eyebrow`, and `.empty` into the global composition/utility layer (per `ui-standards` CUBE model) and/or a `<DataTable>` block component. (Cross-references §3.1–3.2.)

### 1.3 — `title-badge` vs `season-badge` style divergence — Low / S
`src/lib/components/title-badge.svelte` (inline-block, no border on low tiers, tier bg/fg pairs) and `src/lib/components/season-badge.svelte` (inline-flex, explicit borders, box-shadow on some variants) implement "a small coloured pill" two different ways.
**Recommendation:** One `<Badge>` primitive with `variant` (`title` | `season` | `status`); keep tier colour maps as data.

### 1.4 — `D1_MAX_BATCH` lives in an epic module, imported cross-cuttingly — Nit / S
The generic D1 limit constant is defined in `src/lib/db/snapshots.ts:14` and imported by `src/lib/db/ratings.ts:23`. A platform constant coupled to one feature's module.
**Recommendation:** Move to `src/lib/db/constants.ts` (or similar) and import both places from there.

### 1.5 — Dead config: `ADMIN_KEY` — Low / S
`ADMIN_KEY` appears in `.dev.vars.example` but has **no reference** anywhere in `src/`, `worker/`, or `scripts/` (verified by grep).
**Recommendation:** Remove it, or annotate it as reserved with a reason. Dead required-looking secrets are an onboarding trap.

### 1.6 — `interface` used where `code-standards` prefers `type` — Nit / S
23 modules use `interface` (e.g. `src/lib/db/leaderboard.ts:16`, `src/lib/ratings/config.ts`). `code-standards` says prefer `type` unless declaration merging is needed; none here need it. Lint does not enforce this.
**Recommendation:** Either add a `perfectionist`/`@typescript-eslint` rule and convert, or relax the standard. Low value either way — listed for completeness.

---

## 2. Consistency across epics

**Strengths.** The Hono error envelope is uniform — every API router returns `createErrorResponse(code, message)` → `{ error: { code, message } }` (`src/errors.ts`, used in `admin.ts`, `ingestion.ts`, `public-read.ts`, `bot-auth.ts`, …). IDOR handling is consistent and correct: the read-service collapses "missing" and "forbidden" into a single `null → 404` so a private league's existence never leaks (`src/lib/read-api/read-service.ts:239`), and both bot-auth and the optional-viewer resolver **fail closed** on an owner-snapshot mismatch (`src/api/bot-auth.ts:93`, `src/api/public-read.ts:55`). Idempotency patterns rhyme across epics (marker rows, guarded single-winner updates, UPSERT-on-natural-key).

### 2.1 — Public leaderboard exposes numeric `agent_id`, not `symbol` — Medium / S
The agent endpoint is keyed by `symbol` (`GET /api/agents/:symbol`), but `LeaderboardRow` returns `agent_id` and omits `symbol` (`src/lib/read-api/read-service.ts:113`, `303`). A bot reading the leaderboard then has to make one `agents/:symbol`-shaped call *per row* to get a human-usable identity — and can't, because it only has the id. The UI path, by contrast, resolves symbols (`src/lib/db/leaderboard.ts:55`).
**Recommendation:** Include `agent_symbol` in the public leaderboard rows (and consider dropping the internal `agent_id` from the public contract entirely).

### 2.2 — API error `code`s are free-form strings — Low / S
Codes (`"not_found"`, `"unauthorized"`, `"rate_limited"`, `"invalid_text"`, …) are string literals scattered at call sites. Consistent in practice, but nothing prevents drift (`"not_found"` vs `"NOT_FOUND"` — the JSDoc in `src/errors.ts:15` even uses the upper-case form as the example while the code uses lower-case).
**Recommendation:** Centralise an `ErrorCode` union/const map; align the JSDoc example with the actual convention.

### 2.3 — Two error surfaces by design (no action) — informational
API routers use the Hono envelope; SvelteKit loads use `error()`/`fail()`. This is the correct split (machine vs page), noted so it isn't mistaken for inconsistency.

---

## 3. UI consistency

(See also §1.1–1.3. Adheres well to `ui-standards`: Open Props + CUBE, semantic tokens, `prefers-color-scheme` dark mode, Inter via Fontsource, superforms + valibot, SSR loads.)

### 3.1 — No shared table component — Medium / M
Covered in §1.2; called out separately because it's the single highest-leverage UI consolidation (every data page has a table).

### 3.2 — Badge colour classes redefined per page — Medium / S
`badge-public` / `badge-private` / `badge-verified` / `badge-recognized` carry identical declarations in `src/routes/leagues/[id]/+page.svelte:382`, `src/routes/agents/[symbol]/+page.svelte:285`, and `src/routes/agents/+page.svelte:158`.
**Recommendation:** One global `_badges` partial or utility layer.

### 3.3 — Chart components diverge (legend/colour) — Medium / S
Same root as §1.1; from the UI lens, the user-visible inconsistency is "credits chart has a legend, rating chart doesn't."

### 3.4 — `.eyebrow` / `.empty` repeated per page — Low / S
Defined identically in `leaderboard`, `hall-of-fame`, and the home `+page.svelte`.
**Recommendation:** Move to the global layer.

### 3.5 — `ui-standards` library divergences (icons, toasts) — Low / informational
No Lucide/Bits-UI; UI uses inline SVGs, an emoji medal in `season-badge`, and text symbols (`▲ ▼ ▬`) in `delta-indicator`. No `svelte-sonner` — feedback is inline `role="status"` text. Acceptable for v1's surface area, but it's a documented standard the project silently opts out of.
**Recommendation:** Note the deviation in the project `AGENTS.md`, or adopt Lucide for the delta arrows (also helps §5).

---

## 4. Mobile & responsive

### 4.1 — Wide tables have no small-screen reflow — Medium / M
All three table pages wrap the table in `.table-scroll { overflow-x: auto }` (`leaderboard`, `leagues/[id]`, `u/[symbol]`), so there is **no overflow/clipping hazard** — but there is no media-query strategy to drop low-priority columns or reflow to cards. The 6-column leaderboard (`# · Δ · Agent · Title · Rating · Rounds`) is cramped under ~375px and degrades to horizontal scrolling.
**Recommendation:** Add a `@media (max-width: 640px)` rule to hide `Δ`/`Rounds` (or reflow to a card list). (Not "blocking" — the scroll wrapper prevents breakage.)

### 4.2 — Charts locked to 3:1 aspect on narrow screens — Low / S
`aspect-ratio: 3 / 1` with `inline-size: 100%` makes charts very short on phones (`credits-chart.svelte`, `rating-chart.svelte`).
**Recommendation:** `@media (max-width: 480px) { svg { aspect-ratio: 2 / 1 } }`.

### 4.3 — Nav links below 44px tap target — Medium / S
`.nav-link` in `src/routes/+layout.svelte` relies on font size + minimal padding; no `min-block-size`. Fails the 44×44 guidance (also an a11y concern).
**Recommendation:** `min-block-size: 44px; display: inline-flex; align-items: center`.

### 4.4 — Text inputs lack `inputmode` / iOS zoom guard — Low / S
Agent/league create inputs have no `inputmode`; if any input renders < 16px, iOS Safari auto-zooms on focus (`src/routes/agents/+page.svelte:29`, `src/routes/leagues/+page.svelte:28`). Settings already does the right thing (`inputmode="url"`).
**Recommendation:** Add `inputmode`; ensure input `font-size ≥ 16px` on mobile.

---

## 5. Accessibility

**Strengths.** `:focus-visible` outline with offset and no banned `outline: none` (`src/styles/app.css:46`); viewport meta present (`src/app.html:5`); form messages use `role="status"`; charts carry `role="img"` + `aria-label`; the delta indicator has an sr-only direction span.

### 5.1 — Charts have no non-visual data alternative — Medium / M
`role="img"` + `aria-label` give a one-line summary, but there is no `<title>`/`<desc>` inside the SVG and no adjacent data table, so the actual series values are unavailable to assistive tech and lost if the SVG fails (`credits-chart.svelte:28`, `rating-chart.svelte:20`).
**Recommendation:** Add an in-SVG `<title>` + `aria-describedby` pointing at a visually-hidden data table (or reuse the existing visible legend for credits).

### 5.2 — Dark-mode muted badge text fails AA — Medium / S
Muted badge text maps to `--gray-4` on a `--gray-10` surface in dark mode ≈ 2.5:1 (below the 4.5:1 AA floor); the Commodore yellow tier is borderline in light mode (~4.8:1) (`src/styles/app.css:16` token remap; `title-badge.svelte:33`).
**Recommendation:** Use a lighter muted token (`--gray-2`/`--gray-1`) for badge text in dark mode; re-check the yellow/lime tiers with a contrast checker.

### 5.3 — No skip-to-content link — Low / S
`src/routes/+layout.svelte` has no skip link ahead of the nav.
**Recommendation:** Standard visually-hidden `Skip to main content` anchor → `<main id="main-content">`.

### 5.4 — Create forms lack `fieldset`/`legend` — Low / S
Agents/leagues create forms group fields with bare `.field` divs; settings correctly uses a `fieldset`.
**Recommendation:** Wrap each form group in `fieldset`/`legend`.

### 5.5 — Submitting state not exposed via `aria-busy` — Low / S
Async forms disable the button and change its text but don't set `aria-busy`.
**Recommendation:** `aria-busy={$submitting}` on the form/button.

---

## 6. Correctness / security spot-checks

**Strengths.** The Glicko-2 atomic apply is excellent: N upserts + one multi-row `rating_history` insert + the marker, all in a single `db.batch()`, with a runtime assertion that history covers exactly the updated agent set, and `season_id`/`round_id` bound server-side rather than trusted from caller rows (`src/lib/db/ratings.ts:156`, `:206`). Season-close is replay-safe: archive UPSERT first, then a guarded single-winner stamp (`closed_at IS NULL`) last (`src/lib/seasons/close.ts:68`). Bot auth fails closed on owner mismatch and throttles `last_used_at` writes (`src/api/bot-auth.ts`). IDOR is handled by forbidden→404 collapse (§2).

### 6.1 — Public read-API rate limiter is bypassable by token randomisation — High / S
`clientKey` buckets by the **raw bearer token whenever one is present, before it is validated** (`src/api/public-read.ts:60`): `return raw ? `token:${raw}` : `ip:${ip}``. A caller that sends a *fresh random* `Authorization: Bearer <junk>` on each request lands in a new bucket every time → `count` is always 1 → always `allowed`, completely evading the per-IP fallback. The per-isolate `Map` simply grows to `MAX_TRACKED_KEYS` and resets (`src/lib/read-api/rate-limit.ts:76`). Combined with §8.1 (each request triggers a full season-standings recompute), this is a cheap amplification/DoS vector, not just a quota nuisance.
**Recommendation:** Only key by token **after** the token validates (resolve the viewer first, then `token:${tokenId}`); otherwise key by IP. Optionally hash the bucket key so raw tokens never sit in memory as map keys.

### 6.2 — Hard D1-batch ceiling on the rating apply — Medium / L
`applyRatingPeriod` throws (deliberately, loudly, documented) once a rating period needs more than `D1_MAX_BATCH` (100) statements — i.e. roughly **> ~98 rated agents in a season** (`src/lib/db/ratings.ts:171`). Fail-loud is the right call over silent corruption, but this is a real ceiling that a growing universe *will* hit, and the failure mode is "ranked rounds stop applying."
**Recommendation:** Before launch scale, design the multi-batch-safe apply the comment promises (pre-period snapshot / staging table so a replay recomputes from un-mutated state). Track it as a known scaling limit.

### 6.3 — `touchLastUsed` failure would reject an otherwise-valid auth — Low / S
The advisory `last_used_at` write is `await`ed outside any try/catch (`src/api/bot-auth.ts:97`); a transient D1 write error throws and 500s a request that was correctly authenticated.
**Recommendation:** Wrap the advisory write in a try/catch (log + continue). It must never gate auth.

---

## 7. Tests & coverage

**Strengths.** 854 tests, 94.8% line coverage; idempotency/replay paths are explicitly tested; Glicko-2 is checked against published reference vectors; ~81 of 90 suites execute against the real `sql.js`-backed adapter (`src/lib/db/sqlite-d1-adapter.ts`) rather than stubs, so they exercise real SQLite semantics.

### 7.1 — Zero Svelte component tests — High / M
There is **no component-test harness** at all (no `@testing-library/svelte`, no vitest browser mode, no `*.svelte.test.ts` — verified). The six components — both charts, both badges, `delta-indicator`, nav — have no coverage, so high-consequence presentational bugs (an inverted delta arrow, a wrong tier colour, SVG path math) cannot be caught by CI.
**Recommendation:** Stand up a component harness and start with `delta-indicator` (direction logic is the riskiest), then the charts and badges. This is the single biggest coverage gap relative to risk.

### 7.2 — `unrankedUntilFor` date math lacks dedicated boundary tests — Medium / S
`unrankedUntilFor` (`src/lib/seasons/close.ts:39`) does UTC date arithmetic but is only exercised indirectly via `src/lib/seasons/seasons-pipeline.test.ts`. No dedicated cases for `gap=0`, year-wrap (Dec 31 → Jan), or leap-day boundaries.
**Recommendation:** Add `close.test.ts` with explicit boundary cases.

### 7.3 — Batch-overflow throw path untested — Low / S
The `> D1_MAX_BATCH` throw in `applyRatingPeriod` (§6.2) has no test asserting it fires with the descriptive message.
**Recommendation:** One test with a synthetic > 98-agent period.

### 7.4 — Test-double atomicity gap + mixed DB doubles — Medium / M
Two related issues: (a) ~6 API suites use hand-rolled D1 stubs instead of the shared `sqlite-d1-adapter`, an avoidable divergence; (b) more importantly, the shared adapter's `batch()` runs statements **sequentially with no transaction/rollback** (`src/lib/db/sqlite-d1-adapter.ts:67`). Real D1 `batch()` is atomic — and atomicity is the core guarantee of `applyRatingPeriod` and season-close — so the very property those modules are built around is **assumed, never tested**. A partial-batch bug would pass CI.
**Recommendation:** Make the adapter's `batch()` wrap a `SAVEPOINT`/transaction and roll back on any statement failure; then add a partial-failure test. Standardise the API suites on the shared adapter.

### 7.5 — ~435 hard-coded `202x` dates make the suite year-brittle — Medium / M
Literal dates like `"2026-06-01"` appear ~435 times across the test suite; some assertions are implicitly year-relative and will rot.
**Recommendation:** Introduce a relative-date test helper (`addDays(today, n)`) and migrate the date-heavy integration suites first.

---

## 8. Performance

**Strengths.** Index coverage is thoughtful and matches the hot queries: `ratings(season_id)`, `rating_history(agent_id, season_id)` and `(round_id)`, `rounds(season_id)`, `season_standings(season_id, final_rank)`, snapshot time indexes, and a partial unique index enforcing a single open season (`migrations/0011`, `0017`, `0008`, `0013`, `0012`).

### 8.1 — Open-season standings recomputed on every read — High / M–L
`computeSeasonStandings` (`src/lib/seasons/standings.ts`) loads **all** rated agents for the season, counts ranked rounds per agent, computes the full title ladder, and ranks the whole field — and it is called *per request* on the busiest surfaces: the public read leaderboard (`read-service.ts:302`), the public agent profile (`:166`), the UI leaderboard (`leaderboard/+page.server.ts:28` via `buildLeaderboard`), and the UI profile (`u/[symbol]/+page.server.ts:54`). There is **no caching or materialisation** for the *open* season — `season_standings` is only populated at close. The public leaderboard additionally computes the entire field and paginates **in memory** (`read-service.ts:313`), so `limit`/`offset` can't be pushed to SQL. At the public limiter's 120 req/min this is O(N) recompute per hit (and §6.1 removes even that ceiling).
**Recommendation:** Materialise open-season standings — recompute on round finalize (where ratings already change) into a cache table the read paths SELECT from — or, as a smaller first step, add a short-TTL in-isolate memo keyed by `(season_id, last_round_id)` and push leaderboard pagination into SQL.

### 8.2 — N+1 visibility check in the profile load — Low / S
`u/[symbol]/+page.server.ts:76` calls `getViewableLeague` in a loop, once per active league.
**Recommendation:** Batch the visibility filter into a single query, or fetch viewable league ids in one pass.

---

## 9. Docs & DX

**Strengths.** `DEC-*` decisions are documented in `docs/decisions.md` and genuinely referenced from code; the Epic-K cutover runbook (`docs/runbooks/k-cutover.md`) is detailed and matches the shipped `import-*` modules and `scripts/import-legacy.ts`; secrets hygiene matches `code-standards` (`.gitignore` excludes `.env`/`.dev.vars`, examples are tracked, no secrets committed).

### 9.1 — `svelte-kit sync` / fresh-worktree gotcha is undocumented — High / S
On a clean worktree, `bun run check` fails immediately with `svelte-check: command not found` / missing `.svelte-kit` types until `bun install` runs (which triggers the `prepare: svelte-kit sync` script). **Hit during this audit.** README mentions `svelte-kit sync` only in the context of *adding routes*, not first-run setup.
**Recommendation:** Add an explicit "run `bun install` first; if `check` still fails, run `bunx svelte-kit sync`" note to the README setup section (and ensure CI ordering does the same).

### 9.2 — Clerk auth setup absent from README — Medium / S
The app depends on Clerk (`@clerk/backend`, `svelte-clerk`, `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) but the README never explains creating a Clerk app or wiring local keys.
**Recommendation:** Add a short "Authentication — Clerk" setup section.

### 9.3 — Cron worker architecture undocumented — Medium / S
The 15-minute scrape runs as a **separate** Worker (`worker/cron.ts`, `wrangler.cron.toml`, `deploy:cron`) because the Cloudflare adapter owns the main `wrangler.toml`. The README explains neither the two-worker split nor `bun run deploy:cron`.
**Recommendation:** Document the split and its rationale in the architecture section.

### 9.4 — Local D1 / `db:migrate` sequence is vague — Medium / S
`scripts/db-migrate.ts` needs a `DB` binding (i.e. `wrangler dev` running), but the README just says "requires local development setup."
**Recommendation:** Spell out the `wrangler dev` → `bun run db:migrate` ordering.

### 9.5 — Only one runbook exists — Medium / M
`docs/runbooks/` contains only the import cutover. No deploy, season-close/finalization, or rollback runbook.
**Recommendation:** Add `deploy.md` (app vs cron, verify, rollback) and `season-close.md`.

### 9.6 — Migration numbering gaps only partly documented — Low / S
Numbers jump `0008 → 0010` and `0013 → 0017`. `0014–0016` are noted as reserved/unused in `docs/decisions.md` / the cutover runbook, but **`0009` is unexplained**. Per-epic range allocation is a good parallel-work pattern but needs a central ledger or future devs will reuse a "free" number.
**Recommendation:** Add a one-paragraph migration-numbering note (or a `migrations/README.md` ledger) and a comment in `0010` explaining the `0009` gap.

---

## Top 10 things I'd do next

1. **Close the rate-limit bypass** — key the public limiter by validated token-id or IP, never the raw unvalidated bearer (§6.1). *High / S.*
2. **Stop recomputing open-season standings per request** — materialise on round-finalize (or TTL-memoise) and push leaderboard pagination into SQL (§8.1). *High / M–L.*
3. **Stand up a Svelte component-test harness** and cover `delta-indicator`, the charts, and badges (§7.1). *High / M.*
4. **Fix first-run DX docs** — `svelte-kit sync` gotcha, plus Clerk, cron worker, and local-D1 setup in the README (§9.1–9.4). *High / S–M.*
5. **Make the test D1 adapter's `batch()` transactional** so the atomicity guarantee is actually tested, and standardise suites on it (§7.4). *Medium / M.*
6. **Design the multi-batch-safe rating apply** before the universe outgrows ~98 agents (§6.2). *Medium / L.*
7. **Extract shared UI primitives** — `<DataTable>`, global badge/`.eyebrow`/`.empty` utilities, and one unified `<LineChart>` (§1.1–1.2, §3.1–3.4). *Medium / M.*
8. **Add mobile polish** — small-screen column reflow for wide tables and 44px nav tap targets (§4.1, §4.3). *Medium / M.*
9. **Fix the AA failures** — dark-mode muted badge contrast, a non-visual chart data alternative, and a skip link (§5.1–5.3). *Medium / S–M.*
10. **Harden the test suite** — `close.test.ts` boundary cases, the batch-overflow throw, and a relative-date helper to de-brittle the ~435 hard-coded dates (§7.2, §7.3, §7.5). *Medium / S–M.*

---

## Global / studio learnings

Durable, reusable takeaways from a project built by many parallel autonomous epic-sessions. Framed as candidate additions to studio standards / `AGENTS.md` / `IDEAS.md`.

### Patterns that worked — promote to standards

- **Seam interfaces with inert defaults for parallel-safe epics.** `src/lib/rounds/seams.ts` declares `RatingTrigger` / `SeasonCloseEvaluator` / `SeasonCloseTrigger` with no-op defaults; production wires the real Glicko/season implementations in one composition root (`scheduled.ts`). This let Epics G/H/I land independently with no import cycles and a single integration point. **Codify as the default pattern** when epics must fan out around a shared pipeline.
- **Invariants enforced by a shared pure helper, not by convention.** The same `rankByRatingDesc` feeds both the live leaderboard and `rating_history`, so "the history rank equals the leaderboard rank" is true *by construction* and the rank-delta feature is exact. **Rule:** when two surfaces must agree on a derived value, give them one pure function, don't let each compute its own.
- **Idempotency-by-construction everywhere.** Marker rows (`rating_periods`), guarded single-winner updates (`closed_at IS NULL`), UPSERT-on-natural-key (snapshots), append-only history with a `UNIQUE(agent_id, round_id)`. Replays after a mid-pipeline crash are no-ops. **Worth a backend checklist item:** every write step in a retried pipeline must define its replay semantics.
- **Single config modules over scattered magic numbers — and config-in-code over config-in-DB.** `ratings/config.ts`, `titles/config.ts`, and the rate-limit configs centralise every tunable; DEC-I4 deliberately kept the title ladder in code rather than a `title_tiers` table, so tuning changes are reviewable in PR diffs. Good default for studio tools.
- **Reuse-not-fork pipelines.** The legacy import path reuses the same finalize/rating machinery rather than a parallel importer; `buildLeaderboard` wraps `computeSeasonStandings`. Minimal divergence surface.
- **Fail-closed authz that doesn't rely on cleanup having run.** Tokens snapshot their owner and re-check it on every request (`token.owner_user_id !== agent.owner_user_id`), so authorization holds even if a revocation hasn't propagated.

### Pitfalls — candidate cautions for `AGENTS.md` / `IDEAS.md`

- **Test-double fidelity is a correctness risk, not a convenience.** The in-memory D1 `batch()` runs sequentially with no rollback, so the *atomicity* that several modules are architected around is untested. **Rule:** when you build a fake for a primitive whose defining property is X (atomicity, ordering, uniqueness), the fake must model X or the tests that depend on X are theatre.
- **D1's single-batch atomicity ceiling (100 statements) is a design constraint, not an edge case.** Anything that must be all-or-nothing across a population that grows with users needs a multi-batch-safe strategy (pre-snapshot / staging) decided up front — not discovered when a fail-loud `throw` ships. Add to backend-standards.
- **The `svelte-kit sync` fresh-worktree gotcha bites agents specifically.** A new worktree has no `.svelte-kit` types until `bun install`/`prepare` runs, so any agent that runs `bun run check` before installing sees spurious failures. **Put "run `bun install` first; if check fails, `svelte-kit sync`" in every SvelteKit project's `AGENTS.md`.** (Hit in this very audit.)
- **Cross-cutting concerns need an owner; per-epic autonomy silently drops them.** Each epic wired its read path straight to `computeSeasonStandings`; nobody owned caching, so an O(N) recompute landed on every public surface (§8.1). Similarly, parallel epics each re-authored badge/table CSS on shared pages, producing copy-paste drift (§1.2). **Allocate ownership of shared files and cross-cutting concerns (caching, pagination, design primitives) before fan-out — or run a consolidation pass at epic close.**
- **Coordinate on git ground truth, not cross-session chat.** Session-to-session status messages lag merged reality; treat merged commits/PRs as the source of truth for "is epic X done."
- **Migration-range allocation works but needs a ledger.** Per-epic numeric bands prevented collisions across parallel sessions, but undocumented gaps (`0009`) become future-collision traps. Ship a `migrations/README.md` ledger as part of repo scaffolding.

---

*Prepared as a read-only audit. No application code, tests, configuration, or migrations were modified — only this report was added.*
