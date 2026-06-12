# Implementation Brief — rankings.trade (SpaceJam Leagues v2)

> **Project:** rankings.trade — the multi-user evolution of the SpaceJam leaderboard.
> Handoff document for the **new** project. The board planner should decompose the
> epics below into cards. This brief captures scope, the domain model, cross-cutting
> concerns, locked decisions, and an initiative-level definition of done.

## 1. Background & motivation

The current `spacejam-leaderboard` is a single Cloudflare Worker + D1 database with no
framework. A cron job runs every 15 minutes, scrapes **all** public SpaceTraders.io
agents, and stores `snapshots` (credits, rank, ship count, etc.). It renders one global
"group" leaderboard (a hard-coded member list) plus historical graphs. There is no auth
beyond an admin key, and no concept of users.

It has been successful and we are expanding it into a multi-user product. Because the
expansion involves real accounts, multi-tenant "leagues," bot data ingestion, round
finalization, and relative ratings, we are **starting a fresh greenfield repo** rather
than retrofitting the bare Worker.

## 2. Goals

- Real user accounts with passwordless auth (Clerk magic email link, matching the
  **Steward** pattern).
- Users create **leagues** and invite friends via a shareable join link.
- Continue scraping the public SpaceTraders leaderboard; scraping remains the
  **authoritative source** for scores/ranks.
- Let users register their SpaceTraders agent(s) and let their **bots** submit
  supplementary **logs** and **milestones** via a scoped API token.
- Leagues compare the agents participating in that league.
- Public **profile pages** per user (credits graph, leagues they're in, optional
  user-supplied dashboard link).
- When a universe reset happens, **automatically finalize** the current round, archive
  final standings, and update relative ratings.
- Maintain a **global Universe rating** per agent using **Glicko-2**, organized into
  **seasons** that finalize and reset, with space-themed **titles/ranks** (Captain →
  Admiral, etc.) awarded from rating standing.
- Provide simple **rules/help pages rendered from markdown** so newcomers can learn the
  concepts (leagues, rounds, seasons, ratings, titles, bot tokens, logs/milestones).

## 3. Non-goals (for this initiative)

- **No net-worth estimate.** The previous "credits + 20,000/ship" heuristic is dropped;
  **credits** is the single ranking metric everywhere.
- **No agent-ownership verification in v1.** Start with trust + manual admin resolution
  of disputes; cryptographic/API-token ownership proof is a later phase.
- **No email invites in v1.** League invites are shareable links only; email is reserved
  for Clerk login. Email invites are a later phase.
- **No system-awarded achievements in v1.** Achievements are a **Phase 2** epic (see Epic
  P); the v1 data model should not preclude them.
- Bots do **not** submit authoritative scores — they only add logs/milestones.
- No mobile apps, no payments, no real-time websockets.

## 4. Personas

- **Player / league owner** — signs in, registers agents, creates leagues, invites
  friends, views graphs and ratings.
- **Invited member** — joins a league via a shareable link, registers their own agent(s).
- **Bot** — an automated SpaceTraders client acting on behalf of a registered agent;
  authenticates with a per-agent API token to POST logs/milestones.
- **Anonymous visitor** — can view public profiles and the global Universe leaderboard.

## 5. Domain model & glossary

- **User** — a Clerk-authenticated human. Owns zero or more agents. Has a public-by-default
  (configurable) profile.
- **Agent** — a SpaceTraders agent (callsign/symbol). **The competing entity.** A user may
  field multiple agents, each ranked individually. Profiles aggregate a user's agents.
- **League** — a persistent container of participating agents. Private/invite-only by
  default (configurable to public). Owned by the user who created it. Has an optional
  **description** (e.g. to frame an opt-in challenge). Accumulates a history of finalized
  rounds.
- **Universe league** — the implicit global "everyone" view: every scraped agent ranked
  by credits. Glicko-2 Universe ratings are computed over **registered** agents only.
- **Round** — one universe-reset cycle (keyed by SpaceTraders `resetDate`). Finalized
  automatically when a new reset is detected. Belongs to a **season** and may be flagged
  **unranked**.
- **Season** — a span of one or more Universe rounds. Closes at the **first universe reset
  on/after an admin-configured cutoff date**; on close, season standings and final ratings
  are archived and all Universe ratings reset to baseline. An optional **unranked gap**
  (e.g. 1–2 weeks) may follow, during which rounds don't affect ratings.
- **Snapshot** — a periodic (15-min) capture of an agent's credits/rank for a round.
- **Standings** — the ranking of a league's agents at a point in time; **final standings**
  are the standings captured at round finalization.
- **Log** — freeform, timestamped text journal entry submitted by a bot for an agent.
- **Milestone** — a bot-reported, narrative event (typed, tolerant ingestion). _Distinct
  from achievements._
- **Achievement (Phase 2)** — a **system-awarded**, verifiable accomplishment derived from
  our own data (e.g. "reached Admiral," "won a season," "top-10 finish"), as opposed to
  bot-reported milestones.
- **Title / Rank** — a space-themed tier (e.g. Captain, Colonel, Admiral) awarded from an
  agent's current-season Universe rating via a **hybrid** scheme (fixed thresholds for
  lower tiers, percentile bands for elite tiers), gated by an established-rating floor.
- **Rating** — a Glicko-2 rating (rating, deviation/RD, volatility) per agent, global
  ("Universe"), updated once per finalized **ranked** round and reset each season.

## 6. Locked decisions (from stakeholder Q&A)

1. **Stack:** new repo — SvelteKit + Hono + Cloudflare Workers/D1 + Clerk auth.
2. **Leagues are persistent**; each round is finalized and archived within the league.
3. **Relative scoring uses Glicko-2.**
4. **A "match" = a finalized round's final standings**, expanded to pairwise win/loss
   results, producing **one rating update per agent per round**.
5. **One global Universe rating per agent**, computed over **registered/opted-in agents
   only** (the global "everyone" leaderboard stays a pure credits ranking; ratings are not
   computed over all scraped agents). **Per-round participation is explicitly tracked**
   (a participant = a **registered** agent that had ≥1 snapshot in the round; for a league,
   also a member of that league at finalization). Non-participants are excluded from that
   round's match and have their **RD inflated for each missed finalized round** (eagerly at
   finalization or lazily on read).
6. **Scraping is the source of truth** for credits/ranks; **logs & milestones are
   supplementary** narrative/events and never affect ranking.
7. **Bot auth = per-agent API token**: generated in the UI, **shown once**, stored
   **hashed**, sent as a Bearer token on bot endpoints; revocable/rotatable.
8. **Ownership verification deferred** — v1 trusts the claim; admins resolve disputes
   manually.
9. **Visibility:** leagues private/invite-only by default, profiles public by default —
   **both configurable** per league / per user.
10. **The agent is the competitor**; users may field multiple agents; ranks/ratings are
    per-agent; profiles aggregate a user's agents.
11. **Round finalization is fully automatic** on reset detection (no human in the loop).
12. **Logs = freeform timestamped text.** **Milestones = tolerant ingestion + curated
    display:** the API accepts any `type` string + optional metadata and never rejects;
    a default enum of recognized types exists, leagues may add custom recognized types,
    recognized types render with rich styling/icons, unknown types are still stored and
    shown generically.
13. **Import the existing D1 snapshot history** for graph/rating continuity.
14. **Credits is the only metric** (net-worth estimate removed).
15. **The current hard-coded callsign list becomes a seeded starter league.**
16. **Global "everyone" page** graphs only the top 5–10 by credits (full ranked table
    below); **league pages graph all participants.**
17. **Invites (v1 = link only):** a reusable, **revocable/rotatable shareable join link**
    per league. **Email invites are deferred to a later phase** to keep transactional email
    usage limited to logins (Clerk). Joining always requires an account.
18. **Universe seasons:** an admin configures a season **cutoff date**; the season closes
    at the **first universe reset on/after that date** (no need to time the reset exactly).
    On close: archive season standings + final ratings, then **reset all Universe ratings
    to baseline**. An **optional unranked gap** (e.g. 1–2 weeks) may follow, during which
    rounds are flagged unranked and **do not affect ratings**.
19. **Titles/ranks:** space-themed tiers (Captain → Admiral, etc.) from current-season
    Universe rating via a **hybrid** scheme — fixed rating thresholds for lower tiers, and
    for the **top ~2–3 elite tiers, percentile bands that expand/contract with the number
    of players** _combined with_ an **absolute minimum rating gate** (so a small or weak
    field doesn't mint elite titles — those slots stay empty until someone clears the
    threshold). All titles also require an **established-rating floor** (RD below a
    threshold / minimum ranked rounds played). Titles archived per season.
20. **Leagues have an optional description** (for framing opt-in challenges, rules, etc.).
21. **Achievements are Phase 2** (system-awarded, verifiable; distinct from bot milestones).
    v1 ships without them but the data model must not preclude them.

## 7. Epics

> Each epic lists a scope statement, decomposition hints, and dependencies. The board
> planner should add a closeout card per epic per studio card standards.

### Epic A — Project scaffold & infrastructure

**Scope:** Stand up the greenfield repo on the standard stack: SvelteKit front end, Hono
API on Cloudflare Workers, D1 database with a migrations workflow, environment/secrets
config, CI, and deploy. Establish project conventions (TypeScript strict, logging, error
handling) per studio code standards.
**Hints:** Wrangler config + D1 binding; Hono router mounted under `/api`; SvelteKit
adapter for Cloudflare; migration runner (forward-only, run-once files like today's
`migrations/`); base layout/theming.
**Depends on:** —

### Epic B — Authentication & user accounts

**Scope:** Integrate Clerk magic-link auth (Steward pattern). Persist a local `users`
record keyed to the Clerk user. Profile settings including visibility (public/private)
and an optional user-supplied dashboard link. Session/route protection for authed pages
and API.
**Hints:** Clerk SvelteKit middleware; Hono auth middleware that validates Clerk session;
`users` table; profile edit form; visibility flag.
**Depends on:** A

### Epic C — Agents & per-agent API tokens

**Scope:** Let a signed-in user register/claim SpaceTraders agent callsigns (trust-based,
no verification in v1). **One active owner per agent**; provide an admin transfer flow
that revokes the prior owner's tokens and keeps an audit trail; show an "unverified"
status on claims. Generate per-agent API tokens (shown once, stored hashed), with label,
created/last-used timestamps, listable/revocable/rotatable. Token-auth middleware for bot
endpoints.
**Hints:** `agents` table (symbol unique, **nullable** owner user to allow unclaimed
participants, display name, verified flag); `agent_tokens` table (hashed token, label,
created/last-used, revoked); secure token generation; admin escape hatch + audit log for
disputed claims/transfers.
**Depends on:** B

### Epic D — Scraping & snapshots (port)

**Scope:** Port the 15-min cron scrape of all public SpaceTraders agents into the new
worker, storing credits/rank/total-agents per round (`resetDate`). Drop net-worth fields;
keep credits as the metric. (Legacy history import lives in Epic K, not here.)
**Hints:** Reuse `fetchAllAgents` + status `resetDate` logic; `snapshots` schema (credits,
credit_rank, total_agents, reset_date, observed_at, agent_symbol); chunked D1 batch writes
(100/stmt limit); upsert idempotency.
**Depends on:** A (can proceed in parallel with B/C)

### Epic E — Leagues, membership & invites

**Scope:** Create/manage leagues with name + **optional description** (e.g. to frame an
opt-in challenge); private-by-default with configurable visibility; add agents as
participants (**including unclaimed agents** — owner nullable); invite via a reusable,
revocable/rotatable **shareable join link** (no email invites in v1). Seed the legacy
callsign list as a starter league. Membership must be **temporal** so archived rounds stay
stable.
**Hints:** `leagues` (name, **description**, visibility, owner), `league_members`
(agent ↔ league with **joined_at/left_at**), `league_invites` (shareable link tokens with
revoke/rotate), owner role; invite acceptance flow; seed migration. (No transactional email
dependency in v1 — email is used only for Clerk login.)
**Depends on:** B, C

### Epic F — Bot ingestion API (logs & milestones)

**Scope:** Token-authenticated endpoints for bots to submit freeform logs and tolerant
milestones. Never reject milestones; store unknown types. Recognized-type registry
(default enum + per-league custom types). Guard against abuse from a leaked token.
**Hints:** `POST /api/agents/:symbol/logs`, `POST /api/agents/:symbol/milestones`;
`logs` table (agent, ts, text); `milestones` table (agent, ts, type, metadata JSON);
`milestone_types` registry (default + league-scoped custom); **per-token rate limits,
request body-size caps, last-used auditing, and an owner/admin moderation+delete path**
for logs/milestones.
**Depends on:** C (and E for league-scoped custom milestone types)

### Epic G — Rounds & automatic finalization

**Scope:** Detect universe resets (status `resetDate` change). On detection, capture final
standings for the Universe league and each league, **freeze per-round participant
membership**, **tag the round with its season and ranked/unranked flag**, archive the
round, and trigger rating updates (for ranked rounds only). Also evaluate the **season-close
condition** (first reset on/after the configured cutoff). Idempotent and safe to re-run.
**Hints:** `rounds` table (reset_date, started/finalized timestamps, **season_id**,
**is_ranked**); `round_standings` (round, agent, final credits, final rank, league_id
nullable for Universe, participated flag) which **snapshots league membership at
finalization** so later joins/leaves don't rewrite history; final standings = the last
snapshot before the `resetDate` changed; ordering: finalize standings → (if ranked) compute
ratings (Epic H) → (if season-close condition met) run season close (Epic I).
**Depends on:** D, **E** (per-league finalization needs membership state)

### Epic H — Glicko-2 ratings

**Scope:** Implement Glicko-2. At finalization of a **ranked** round, treat final standings
as one rating period; expand to pairwise outcomes (higher final credits beats lower; equal
= draw) and update each participating agent's current-season Universe rating once.
Non-participants get an RD-inflation update for the missed period. **Unranked rounds (during
a season gap) do not update ratings.** **Ratings are computed over registered/opted-in
agents only** (not all scraped agents). **Compute pairwise outcomes in-memory — do NOT
materialize O(n²) pairwise rows.**
**Hints:** Glicko-2 implementation w/ unit tests against published reference vectors;
`ratings` table (agent, **season_id**, rating, rd, volatility, last_round); pairwise
expansion from final ranks; **lock the system constants** (initial rating/RD/volatility, τ,
rating-period granularity) and **tie policy** as an early design card; RD inflation applied
per missed ranked round; ratings are **season-scoped** (reset to baseline each season —
see Epic I).
**Depends on:** G

### Epic I — Universe seasons, titles & ranks

**Scope:** Season lifecycle and the title/rank system.

- **Seasons:** admin creates a season with a **cutoff date**; the open season closes at the
  **first universe reset on/after that date**. On close: archive season standings + each
  agent's final rating/title, then **reset all Universe ratings to baseline** for the next
  season. Support an **optional unranked gap** (admin-set length, e.g. 1–2 weeks) after a
  close, during which rounds are tagged unranked and excluded from ratings (Epic H).
- **Titles/ranks:** derive a space-themed tier from current-season Universe rating via a
  **hybrid** scheme: fixed rating thresholds for lower tiers; the **top ~2–3 elite tiers
  use percentile bands that expand/contract with the player count** _and_ require an
  **absolute minimum-rating gate** (elite slots stay empty in a small/weak field until
  someone clears the threshold). All tiers require an **established-rating floor** (RD below
  threshold / min ranked rounds). Recompute on each ranked finalization; archive per season.
  **Hints:** `seasons` table (label, cutoff_date, opened_at, closed_at, **unranked_until**);
  `season_standings`/archive (season, agent, final rating, final rank, **title**);
  `title_tiers` config (ordered tiers: name, **lower rating threshold**, **percentile band**,
  and per-tier flags for whether it's threshold-based or percentile+gate); compute percentile
  over the **established, ranked** population only; season-close logic invoked from Epic G's
  finalization; admin UI to configure seasons + cutoff + gap length. Proposed title ladder
  (planner to confirm): Cadet → Ensign → Lieutenant → Commander → Captain → Commodore →
  Colonel → Admiral → Fleet Admiral (elite = top 2–3).
  **Depends on:** G, H

### Epic J — UI: public, profiles, leagues

**Scope:** Global "everyone" Universe leaderboard (full ranked table + top 5–10 credits
graph + Universe ratings **with title/badge**). League pages (name + **description**,
standings, all-participants credits graph, milestone/log display, invite-link management
for owners). Public profile pages (a user's agents, aggregated credits graph, leagues
they're in, **current title/badge per agent**, **season history** with archived
placements/titles, optional dashboard link). Curated milestone rendering (recognized vs
generic); title-badge component.
**Hints:** Chart rendering (Chart.js or equivalent); responsive tables; visibility-aware
rendering; owner-only controls; archived round + **archived season** history views;
title-badge styling per tier.
**Depends on:** D, E, F, G, H, I (build incrementally as data sources land)

### Epic K — Data migration & cutover

**Scope:** **Sole owner of legacy import.** One-time import of legacy snapshot history,
deterministic historical round/rating backfill, seeding of the starter league, continuity
verification, and production cutover.
**Hints:** Export from old D1 → transform (drop net-worth) → import; reconstruct `rounds`
from historical `reset_date`s **processed strictly in chronological order**; final
standings per round = last snapshot before each reset change; document behavior for
missing/incomplete final snapshots; decide whether ratings are **recomputed from genesis**
over imported rounds (recommended) or only seeded; treat the imported pre-launch history as
an initial archived "**Season 0**" so current-season ratings start clean at launch;
smoke-test ratings across historical rounds.
**Depends on:** D, E, G, H, I

### Epic L — Rules / help pages (markdown)

**Scope:** A lightweight set of **rules/help pages rendered from markdown** that explain the
concepts to newcomers: leagues & visibility, rounds & finalization, seasons & the unranked
gap, Glicko-2 ratings, the title/rank ladder and how tiers are earned, registering agents &
bot API tokens, and logs vs milestones. Content lives in-repo as markdown; pages are
server-rendered to HTML with the app's styling.
**Hints:** Store markdown under e.g. `content/rules/*.md`; render with a vetted markdown
library (sanitize output); a simple `/rules` index + per-topic routes; link from the nav
and from relevant UI surfaces (e.g. a "?" next to titles). Content is editable by editing
markdown — no CMS. Keep the copy in sync with the locked decisions in this brief.
**Depends on:** A (content can be drafted any time; wire-up needs the scaffold)

### Epic M — Public read API for bots

**Scope:** A documented, read-only HTTP API so bots/tools can fetch their own and public
data: an agent's current rank/credits/rating/title, a league's standings, Universe
leaderboard slices, and current season state. Public (or token-scoped where it touches
private leagues), with sane pagination and rate-limit headers.
**Hints:** `GET /api/agents/:symbol`, `GET /api/leagues/:id/standings`,
`GET /api/universe/leaderboard`, `GET /api/seasons/current`; respect league visibility
(private leagues require the agent's token or membership); emit `X-RateLimit-*` headers;
publish an **OpenAPI spec** and a short section in the Epic L rules pages. Read-only — never
mutates.
**Depends on:** D, E, G, H, I

### Epic N — End-of-season recognition & hall of fame

**Scope:** Turn season closes into a moment: crown a **Season Champion** (top Universe
agent), render a podium, award a persistent **per-season champion badge**, and maintain a
**hall of fame** page listing every past season's winners/top finishers.
**Hints:** Derive from the season archive written at close (Epic I); `season_results` already
holds final rank/title — add champion/podium flags or derive on read; profile + nav surfaces
to display earned season badges; immutable once a season is closed.
**Depends on:** I, J

### Epic O — Rank & rating deltas + rating-over-time

**Scope:** Make movement legible: show **rank/rating deltas** ("▲3 since last round") on
leaderboards and profiles, and a **rating-over-time graph** alongside the existing credits
graph.
**Hints:** Compute deltas from consecutive `round_standings`/rating snapshots; store or
derive per-round rating history (per season); add a Glicko-2 line chart; show promotion/
demotion arrows on the Universe leaderboard and profile.
**Depends on:** G, H, J

### Epic P — Achievements (Phase 2)

**Scope:** _Deferred to Phase 2 — listed so the v1 data model accommodates it._
System-awarded, verifiable achievements derived from our own data (distinct from
bot-reported milestones), e.g. "reached Admiral," "won a season," "top-10 season finish,"
"first to 1B credits in a league." Evaluated at round/season finalization and displayed on
profiles/leagues alongside milestones.
**Hints:** `achievements` catalog (key, name, description, criteria) + `agent_achievements`
(agent, achievement, awarded_at, context); an evaluator hooked into finalization (Epics
G/I); reuse the milestone display surface. **v1 requirement:** keep finalization/standings
data rich enough (per-round standings, season archives, titles) that these can be computed
retroactively without schema upheaval.
**Depends on:** G, H, I, J (Phase 2)

## 8. Cross-cutting concerns

- **Security:** API tokens stored hashed; tokens shown once; Clerk session validation on
  all authed routes; least-privilege token scope (one agent); **one active owner per
  agent**, admin transfer flow that revokes prior tokens with an audit trail.
- **Abuse/moderation:** per-token rate limits + request body-size caps on ingestion;
  owner/admin path to delete logs/milestones; "unverified" badge on trust-claimed agents.
- **Privacy/visibility:** enforce league/profile visibility at both API and UI layers;
  default league=private, profile=public; both user-configurable.
- **Idempotency:** scraping upserts (as today) and finalization must be safe to re-run.
- **Data integrity:** credits-only metric; **temporal league membership** and per-round
  `round_standings` snapshots so archived rounds are immutable; participation explicitly
  recorded per round; RD inflation applied for missed rounds.
- **Performance:** D1 batch limits (100 statements); paginate the global leaderboard;
  graph only top-N globally; **no materialized O(n²) pairwise rows** for ratings.
- **Observability:** structured logs for cron, finalization, and ingestion.

## 9. Open questions / assumptions to confirm during planning

- **Universe rating scope:** ✅ Resolved — ratings cover registered/opted-in agents only;
  the global "everyone" page is a pure credits ranking.
- **Glicko-2 constants & tie policy:** initial rating/RD/volatility, τ, rating-period
  granularity, and equal-credits tie handling (proposed: equal credits → draw).
- **Title ladder & thresholds:** confirm the tier names (proposed Cadet → … → Fleet
  Admiral), the fixed rating thresholds for lower tiers, the percentile bands **and
  absolute minimum-rating gate** for the top ~2–3 elite tiers, and the established-rating
  floor (RD/min-rounds) values.
- **Default unranked-gap length** between seasons (proposed: 1–2 weeks, admin-configurable;
  default may be 0 = no gap).
- Exact default milestone enum (proposed seeds: `first-jump`, `first-ship`,
  `fleet-size-10`, `credits-1M`, `credits-10M`, `system-charted`). Leagues extend this.
- Whether archived rounds expose per-snapshot history or only final standings (proposed:
  keep snapshots; surface final standings prominently).
- Email-invite delivery: ✅ Resolved — **deferred**. v1 ships link-only invites; email is
  reserved for Clerk login. Email invites can be added in a later phase.
- Whether a user can register an agent that is **not** yet in the scrape (proposed: allow;
  it simply has no snapshots until it appears publicly).

## 10. Initiative-level definition of done

- A new user can sign in via Clerk magic link, register an agent, and see it on a public
  profile with a credits graph.
- A user can create a private league, invite a friend via a shareable link, and
  both see league standings comparing their agents by credits.
- A registered agent's bot can authenticate with a per-agent token and submit logs and
  milestones; recognized milestones render richly, unknown ones render generically, and
  none are rejected.
- The 15-min scrape populates snapshots; the global Universe page shows the full ranked
  table with a top 5–10 credits graph.
- Legacy snapshot history is imported and the legacy callsign list exists as a seeded
  starter league.
- When a universe reset is detected, the prior round finalizes automatically: final
  standings are archived and current-season Glicko-2 Universe ratings update once per
  participant, with non-participants correctly excluded.
- An admin can set a season cutoff date; the season closes at the first reset on/after it,
  standings/ratings/titles are archived, ratings reset to baseline, and an optional unranked
  gap is honored (those rounds don't affect ratings).
- Each rated agent shows a space-themed title/badge derived from its current-season rating
  (lower tiers by fixed threshold; top ~2–3 elite tiers by population-scaled percentile +
  an absolute minimum-rating gate; all gated by the established-rating floor), visible on
  profiles and the Universe leaderboard, with archived per-season titles in season history.
- Leagues support an optional description shown on the league page.
- Markdown-rendered rules/help pages explain leagues, rounds, seasons, ratings, titles, and
  bot tokens/logs/milestones, linked from the nav.
- A read-only bot API (with OpenAPI docs and rate-limit headers) returns an agent's
  rank/credits/rating/title, league standings, Universe slices, and current season state,
  honoring league visibility.
- Season close crowns a champion and records it; a hall-of-fame page lists past seasons'
  winners, and champion badges appear on profiles.
- Leaderboards and profiles show rank/rating deltas vs the prior round and a rating-over-time
  graph beside the credits graph.
- League and profile visibility settings are enforced in API and UI.
- All shipped behavior is covered by tests appropriate to the studio standards (notably a
  Glicko-2 unit suite, season-close/finalization integration tests, and title-derivation
  tests), and CI is green.

## 11. Future enhancements (backlog — not in v1)

Captured for later prioritization; intentionally out of v1 scope.

- **League roles & moderation:** co-owners/mods, join-by-approval, member caps, remove/ban.
- **In-app notifications:** promoted/demoted, season ending soon, someone joined your league
  (works without the deferred email provider).
- **Public league directory:** browse/discover public leagues (pairs with public visibility).
- **OpenGraph share cards:** rich link previews (rank + title + graph thumbnail) for profiles
  and league/invite links.
- **Head-to-head comparison:** compare two agents' credits/ratings/history side by side.
- **Inactivity decay/demotion made legible:** surface RD-driven decay and demotion warnings.
- **Provisional/placement badge:** mark agents still under the established-rating floor.
- **Secondary leaderboards:** revive the old "most charts submitted" metric as a side board.
- **Data export:** CSV export of standings/snapshots.
- **Embeddable league widget:** an iframe/script badge to show a league's standings off-site.
- _(Considered and deliberately skipped for now: league chat, smurf detection, payments.)_
