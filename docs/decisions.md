# Resolved design decisions

The brief flagged several values as "early design cards." These were resolved with the
stakeholder on 2026-06-11. Implementation epics inherit these as locked inputs.

## DEC-1 — Glicko-2 system constants & tie policy  → Epics G, H

- Baseline **1500** / RD **350** / σ **0.06**.
- **One rating period per finalized round.**
- **Equal credits → draw.**
- Tuned for infrequent rounds: RD inflation between rare rounds is the primary
  "long gap → bigger swing" mechanism. Additionally bump the system constant **τ from 0.5 → 0.6**
  for slightly more reactivity to upsets, and expose an **RD floor** so established players don't
  freeze between rounds.
- **All constants live in one editable config module.** Recalibrate after the first live season
  with real data.

## DEC-2 — Title ladder  → Epics I, J

- Brief's ladder (tier names, fixed lower-tier rating thresholds, elite percentile bands +
  absolute min-rating gate) plus an established-rating floor (RD / min-rounds).
- **Ladder, thresholds, percentile bands, and floor live in a single easy-to-edit config file**
  so tiers are tweakable without code changes.

## DEC-3 — Unranked gap between seasons  → Epic I, G3

- Default unranked gap = **0**; admin-configurable.

## DEC-4 — Default milestone enum  → Epic F3

- Seed the six default milestone types (`first-jump`, `first-ship`, `fleet-size-10`,
  `credits-1M`, `credits-10M`, `system-charted`); leagues may extend with custom types.

## DEC-5 — Archived-round history  → Epics J, K (+ new card D4)

- **Keep raw snapshots and make them viewable.**
- **New card D4 — snapshot retention/compaction:** after a round finalizes, downsample its 15-min
  series to a bounded long-term shape (≈ one point per few hours/day) + the frozen final standing,
  so long-term storage stays flat; the live/active round keeps full resolution for graphs. The
  schema is designed so compaction is non-destructive.

## DEC-6 — Legacy ratings  → Epic K

- **Recompute ratings from genesis** over imported rounds into an archived **"Season 0"**, then
  **reset to baseline** for the live season (continuity without a launch head-start).

## DEC-7 — Clerk app / magic-link config  → Epic B1

- **New Clerk app** for rankings.trade (own user pool + keys); operational setup only, no
  architectural impact. Clerk keys are handed over at card B1.

## Pre-accepted (no decision card)

- Registering an agent not yet in the scrape is **allowed** — it simply has no snapshots until it
  appears publicly. Baked into card C1's acceptance criteria.
