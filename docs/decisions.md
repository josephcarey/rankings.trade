# Resolved design decisions

The brief flagged several values as "early design cards." These were resolved with the
stakeholder on 2026-06-11. Implementation epics inherit these as locked inputs.

## DEC-1 — Glicko-2 system constants & tie policy → Epics G, H

- Baseline **1500** / RD **350** / σ **0.06**.
- **One rating period per finalized round.**
- **Equal credits → draw.**
- Tuned for infrequent rounds: RD inflation between rare rounds is the primary
  "long gap → bigger swing" mechanism. Additionally bump the system constant **τ from 0.5 → 0.6**
  for slightly more reactivity to upsets, and expose an **RD floor** so established players don't
  freeze between rounds.
- **All constants live in one editable config module.** Recalibrate after the first live season
  with real data.

## DEC-2 — Title ladder → Epics I, J

- Brief's ladder (tier names, fixed lower-tier rating thresholds, elite percentile bands +
  absolute min-rating gate) plus an established-rating floor (RD / min-rounds).
- **Ladder, thresholds, percentile bands, and floor live in a single easy-to-edit config file**
  so tiers are tweakable without code changes.

## DEC-3 — Unranked gap between seasons → Epic I, G3

- Default unranked gap = **0**; admin-configurable.

## DEC-4 — Default milestone enum → Epic F3

- Seed the six default milestone types (`first-jump`, `first-ship`, `fleet-size-10`,
  `credits-1M`, `credits-10M`, `system-charted`); leagues may extend with custom types.

## DEC-5 — Archived-round history → Epics J, K (+ new card D4)

- **Keep raw snapshots and make them viewable.**
- **New card D4 — snapshot retention/compaction:** after a round finalizes, downsample its 15-min
  series to a bounded long-term shape (≈ one point per few hours/day) + the frozen final standing,
  so long-term storage stays flat; the live/active round keeps full resolution for graphs. The
  schema is designed so compaction is non-destructive.

## DEC-6 — Legacy ratings → Epic K

- **Recompute ratings from genesis** over imported rounds into an archived **"Season 0"**, then
  **reset to baseline** for the live season (continuity without a launch head-start).

## DEC-7 — Clerk app / magic-link config → Epic B1

- **New Clerk app** for rankings.trade (own user pool + keys); operational setup only, no
  architectural impact. Clerk keys are handed over at card B1.

## Pre-accepted (no decision card)

- Registering an agent not yet in the scrape is **allowed** — it simply has no snapshots until it
  appears publicly. Baked into card C1's acceptance criteria.

---

# Epic C — Agents & per-agent API tokens (design lock, card #16)

Locked with the stakeholder before implementing Epic C. Cards #17–#23 inherit these as
fixed inputs. A rubber-duck critique of the token crypto and the transfer/revocation flow
was run during planning; its findings are folded into the decisions below.

## DEC-C1 — Admin identification

- Admins are identified by an **env allowlist**: `ADMIN_CLERK_USER_IDS`, a comma-separated
  list of Clerk user IDs. A helper `isAdmin(clerkUserId, env)` returns true iff the id is in
  the (trimmed, non-empty) list. Empty/unset ⇒ nobody is admin.
- No role table and no role-management UI in v1. The var is added to `CloudflareBindings`
  and documented in the env example; it holds IDs, not secrets.

## DEC-C2 — Admin transfer surface

- The ownership-transfer escape hatch is an **admin-only API endpoint plus a minimal
  SvelteKit form action**. No dedicated `/admin` page in v1 (disputes are rare and handled
  manually per the brief's trust model).

## DEC-C3 — Token format, storage, and lifecycle

- Token string: `rtbot_` + `base64url(32 random bytes)` from a **CSPRNG** (Web Crypto
  `crypto.getRandomValues`; the Workers runtime has no Node `crypto`).
- Stored as a **SHA-256 hex digest** in `agent_tokens.token_hash` with a **UNIQUE** index for
  O(1) lookup. SHA-256 (not bcrypt) is appropriate because the secret is full-entropy random,
  not a human password; the unique-hash equality lookup also sidesteps timing concerns.
- A non-secret `token_prefix` (`rtbot_` + first 6 chars) is stored for display/identification.
- The raw token is **shown exactly once** at creation and never persisted or logged.
- **Rotate** = revoke the selected token and issue exactly one replacement carrying the same
  label, returned once. **Revoke** sets `revoked_at`; a revoked token never authenticates.

## DEC-C4 — Data model

- `agents`: `id`, `symbol` (UNIQUE, normalized uppercase, `^[A-Z0-9_-]{3,20}$`),
  `display_name` (NULL), `owner_user_id` (**NULL** → unclaimed scraped participants allowed),
  `verified` (INTEGER, default 0 — claims are "unverified" in v1), `created_at`, `updated_at`.
- `agent_tokens`: `id`, `agent_id`, `owner_user_id` (**creation-time owner snapshot** so a
  transfer can revoke exactly the prior owner's tokens), `token_hash` (UNIQUE), `token_prefix`,
  `label`, `last_used_at` (NULL), `revoked_at` (NULL), `created_at`.
- `agent_ownership_events` (audit): `id`, `agent_id`, `event_type`
  (`claim` | `transfer` | `admin_release`), `actor_user_id` (NULL), `prior_owner_user_id`
  (NULL), `new_owner_user_id` (NULL), `reason` (NULL), `created_at`.

## DEC-C5 — Invariants & concurrency (from the rubber-duck critique)

- **One active owner per agent**, enforced atomically at the DB, not only in app code:
  claim is `UPDATE agents SET owner_user_id = ? WHERE symbol = ? AND owner_user_id IS NULL`
  (creating the row first if the symbol is unseen). A claim that affects 0 rows on an
  already-owned symbol resolves to an "already claimed" outcome — never a silent overwrite.
- **Transfer is transactional**: setting the new owner, revoking the **prior** owner's active
  tokens (`owner_user_id = priorOwner`), and writing the audit event happen together. The new
  owner's own (post-transfer) tokens are never caught by the revocation because revocation is
  scoped to the prior owner's snapshot.
- **`last_used_at` write throttling**: the bot middleware updates `last_used_at` only when the
  stored value is older than ~10 minutes, avoiding a per-request write hotspot.
- Rate limiting and request body-size caps remain in **Epic F** (out of Epic C scope).

---

# Epic H — Glicko-2 ratings (design lock)

Locked with the stakeholder before implementing Epic H. Builds on DEC-1; the cards inherit
these as fixed inputs. The single source of truth in code is `src/lib/ratings/config.ts`
(`GLICKO2_CONFIG`) — recalibrate there after the first live season.

## DEC-H1 — Concrete Glicko-2 constants, RD band & idempotency model

- **Constants (one editable config module, per DEC-1):** baseline rating **1500**, RD **350**,
  volatility σ **0.06**, system constant **τ = 0.6**, convergence tolerance ε **1e-6**, scale
  factor **173.7178**.
- **RD floor = 30** (DEC-1 left the number open). RD is clamped to **[30, 350]** after every
  update: the floor stops an established rating from freezing between the infrequent rounds;
  the cap (= initial RD) bounds idle/unrated inflation. Recalibrate after season 1.
- **Rating-period granularity:** one period = one finalized **ranked** round (DEC-1). Standings
  are expanded to an in-memory **round-robin** of pairwise outcomes; **no O(n²) rows are
  materialized**. Each agent receives exactly **one** update per round.
- **Tie policy:** equal `final_credits` ⇒ a **draw** (score 0.5), per DEC-1.
- **Non-participants:** registered agents who already hold a current-season rating but did not
  participate get the Glicko-2 "did not compete" **RD-inflation** update (φ* = √(φ²+σ²),
  rating/σ unchanged), once per missed ranked round.
- **Population:** ratings cover **registered/opted-in** agents only (standings with a non-null
  `agent_id`), never raw scraped participants.
- **Season scope:** `ratings` is keyed by `(agent_id, season_id)`; `season_id` is taken from
  `round.season_id`. The per-season baseline reset is Epic I's job — H only keys by season.
- **Idempotency:** the trigger applies the whole period in a single atomic D1 `batch()` that
  upserts every rating row **and** inserts a dedicated `rating_periods` marker row
  (`round_id` PRIMARY KEY) together. A re-invocation before `rounds.ratings_applied_at` is set
  detects the marker (`isRatingPeriodApplied`) and is a no-op — so a crash/replay never
  double-applies. A separate marker table is used instead of inspecting `ratings.last_round_id`
  because a later round can overwrite `last_round_id`, which would make a last-round-based
  check unsafe. (`last_round_id` is still stamped, but only as provenance, not the dedupe key.)
  The single-batch apply is size-bounded by D1's 100-statement limit; `applyRatingPeriod`
  **throws** rather than splitting a larger period across non-atomic batches (a multi-batch-safe
  apply is a roadmap follow-up).
- **Ordering (chronological barrier):** Glicko-2 updates are order-dependent, and the Epic G
  orchestrator can finalize+apply a *later* ranked round before replaying an earlier pending
  one after a crash. The trigger therefore refuses (throws) to apply a round while an earlier
  ranked round in the same season is still unapplied (`hasEarlierUnappliedRankedRound`); since
  the pending-trigger sweep runs in id order, it heals the ordering on its next pass.

---

# Epic I — Universe seasons, titles & ranks (design lock)

Implemented for Epic I, building on DEC-2 (title ladder lives in a config file) and DEC-3
(default unranked gap = 0). The concrete title thresholds, percentile bands, gates, and the
established-rating floor were left open by DEC-2; they are locked here. The single source of
truth in code is `src/lib/titles/config.ts` (`TITLE_CONFIG`) — recalibrate after season 1.

## DEC-I1 — Title ladder: concrete tiers, bands, gates & established floor

- **Ladder (bottom → top), per the brief and confirmed:** Cadet → Ensign → Lieutenant →
  Commander → Captain → Commodore → Colonel → Admiral → Fleet Admiral.
- **Lower six tiers are fixed lower-rating thresholds** (Glicko-1 scale): Cadet 0, Ensign 1350,
  Lieutenant 1450, Commander 1550, Captain 1650, Commodore 1750.
- **Top three tiers are elite = percentile band + absolute min-rating gate:** Colonel
  (top, percentile ≥ 0.75, gate 1850), Admiral (≥ 0.90, gate 2000), Fleet Admiral (≥ 0.98,
  gate 2200). Percentile is the fraction of the **established, ranked** population rated
  STRICTLY BELOW the agent, so ties share a percentile (and tier) and the bands expand/contract
  with the field. A consequence of these bands: Fleet Admiral first becomes reachable at ~50
  established players, Admiral at ~10, Colonel at ~4 — and the gate keeps elite slots empty in
  a weak field regardless of size.
- **Established-rating floor (all tiers):** RD ≤ 100 **and** ≥ 3 ranked rounds participated in
  the season. An agent below the floor receives **no title** (null) and is excluded from the
  percentile population.
- Titles are a pure derivation of the live, season-scoped ratings (`src/lib/titles/compute.ts`),
  recomputed on demand and archived per season at close. No per-round title churn table.

## DEC-I2 — Season close & the per-season baseline reset

- A season closes at the **first universe reset on/after its `cutoff_date`** (the finalizing
  round that triggers it is the season's last ranked round; its ratings are folded in before
  the archive). Close archives every rated agent's final rating/RD/volatility, competition
  rank, title, established flag, and ranked-round count into `season_standings`.
- **The "reset all Universe ratings to baseline" is structural, not destructive.** Ratings are
  keyed by `(agent_id, season_id)`; the next season's first ranked round resolves to a NEW
  `season_id` whose ratings start empty = baseline (1500/350/0.06). The closed season's rating
  rows are retained as history. Consumers of "current" ratings MUST scope by the open season's
  id (`getOpenSeason`); during an unranked gap or with no open season there is no current
  ranked rating.
- **Idempotency:** the close trigger archives via a deterministic UPSERT (a replay after a
  partial crash repairs the archive) and stamps the season closed LAST via a single-winner
  conditional update (`closed_at IS NULL`), mirroring Epic G/H markers. The trigger has no
  external side effects, so the recovery sweep may safely re-enter it.

## DEC-I3 — Unranked gap representation

- `seasons.unranked_gap_days` is the admin-set warm-up that applies AFTER this season closes
  (DEC-3 default 0). At close, `unranked_until` is set to the closing reset_date + gap days
  (date-only) when the gap is positive, else NULL. A finalized round whose reset_date is
  strictly between the closing reset and `unranked_until` is tagged unranked.

## DEC-I4 — Title tiers live in a config module (not a DB table)

- The brief hinted at a `title_tiers` config table (and reserved migration 0014), but DEC-2
  locks "ladder, thresholds, bands, and floor live in a single easy-to-edit config file." For
  consistency with Epic H's `GLICKO2_CONFIG`, the ladder lives in `src/lib/titles/config.ts`.
  Migrations 0012 (`seasons`) and 0013 (`season_standings`) are used; 0014 is left unused.
