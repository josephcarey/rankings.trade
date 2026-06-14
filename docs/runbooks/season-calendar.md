# Runbook — Season calendar

> A **season** is the ranked period that Glicko-2 ratings, titles, and ranks are scoped to
> (Epic I). This runbook is the canonical schedule of seasons and off-weeks, plus the mechanic
> that turns the three season knobs — `label`, `cutoff_date`, `unranked_gap_days` — into that
> schedule. For the close itself see [`season-close.md`](season-close.md); for the legacy
> cutover see [`k-cutover.md`](k-cutover.md).

## 1. Cadence

- SpaceTraders **resets weekly, on Sundays at 13:00 UTC**. Each reset is a `reset_date`; the
  first finalized ranked round after a reset is what advances a season.
- There are **4 seasons per year**. Between seasons there is a single **off-week** (an unranked
  gap), and each off-week is aligned to a **solstice or equinox**.
- A normal season is **12 ranked rounds**; Season 1 is a short **bootstrap** season.

## 2. Mechanic — how the three knobs produce the schedule

Each season is created (admin UI, `/admin/seasons`) as `(label, cutoff_date, unranked_gap_days)`:

1. **Close.** The season closes at the **first finalized ranked round whose `reset_date >=
   cutoff_date`** (see [`season-close.md`](season-close.md) §1). That closing round is the
   season's last ranked round.
2. **Off-week (the unranked gap).** On close, `unranked_until` is stamped to
   `closing reset_date + unranked_gap_days`. A finalized round whose `reset_date` falls strictly
   between the closing reset and `unranked_until` is tagged **unranked** (`isInUnrankedGap`).
   With **`unranked_gap_days = 14`**, exactly the **next Sunday** (closing reset + 7 days) is
   unranked, and the Sunday after that (closing reset + 14 days) is the first reset that is NOT
   in the gap.
3. **Next season opens.** The next season must already be open (admin action — see §4) so that
   its first ranked round is the Sunday **after** the off-week (closing reset + 14 days).

So a `gap = 14` close makes the pattern: `… last ranked Sunday → off-week Sunday (unranked) →
next season's first ranked Sunday`.

## 3. Concrete calendar (2026 → 2027)

| Season | Label | Ranked rounds | `cutoff_date` | `unranked_gap_days` | Off-week (gap) |
|---|---|---|---|---|---|
| 1 | **Spring 2026** (bootstrap) | 2026-06-07, 2026-06-14 | `2026-06-14` | 14 | 2026-06-21 (summer solstice) |
| 2 | **Summer 2026** | 2026-06-28 → 2026-09-13 (12 rounds) | `2026-09-13` | 14 | 2026-09-20 (autumn equinox) |
| 3 | **Autumn 2026** | 2026-09-27 → 2026-12-13 (12 rounds) | `2026-12-13` | 14 | 2026-12-20 (winter solstice; week contains Christmas) |
| 4 | **Winter 2026** | 2026-12-27 → 2027-03-14 (12 rounds) | `2027-03-14` | 14 | 2027-03-21 (spring equinox) |
| 5 | **Spring 2027** | 2027-03-28 → 2027-06-13 (12 rounds) | `2027-06-13` | 14 | 2027-06-20 (summer solstice) |

Notes:

- **Season 1 is the bootstrap:** just two ranked rounds (2026-06-07 and 2026-06-14). The first
  ranked round finalizes after the 2026-06-14 13:00 UTC reset; that round is `>= cutoff_date`
  (`2026-06-14`), so it closes Season 1. The off-week is **2026-06-21** (summer solstice).
- Each subsequent season runs 12 ranked Sundays, then a one-week solstice/equinox gap, then the
  next season begins.

## 4. Operator checklist

- **Open each subsequent season before its first reset.** The close is automatic, but the *next*
  season does not open itself. Before a season's first ranked Sunday (e.g. Season 2's
  2026-06-28), an admin must create the next open season in `/admin/seasons` with its `label`,
  `cutoff_date`, and `unranked_gap_days = 14`. If no season is open when a reset finalizes, that
  round has no `season_id` to rank into.
- **Set the cutoff on the open season** to the season's intended last ranked Sunday (the
  `cutoff_date` column above).
- **Keep `unranked_gap_days = 14`** to produce exactly one unranked off-week aligned to the
  solstice/equinox.
