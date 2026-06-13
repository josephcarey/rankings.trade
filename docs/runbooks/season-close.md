# Runbook — Season close / finalization

> A **season** is the ranked period that Glicko-2 ratings, titles, and ranks are scoped to
> (Epic I). At most one season is open at a time (`closed_at IS NULL`). This runbook covers the
> operator actions around a season boundary; the close itself is **automatic**, driven by the
> 15-minute scrape — there is no "close season" button to push at the moment of close.

## 1. How a season closes (mechanics)

The close is data-driven, not a manual action:

1. The operator sets the open season's **`cutoff_date`** ahead of time via the admin UI
   (`/admin/seasons`). Optionally sets **`unranked_gap_days`** (the post-close cooldown before
   the next season starts ranking).
2. The 15-minute cron scrape ingests `snapshots`, and the Epic G finalize sweep finalizes a
   round when a universe reset is observed (a new `reset_date`).
3. When a **finalized, ranked round's `reset_date` ≥ the open season's `cutoff_date`**, the
   season-close seam (`src/lib/seasons/close.ts`, composed into `src/lib/scrape/scheduled.ts`)
   fires for that round. It is the **first** reset on/after the cutoff — once closed, the season
   is no longer "open", so later resets never re-close it.
4. On close (idempotent, ordered): the Epic H rating trigger has already folded the closing
   round's ratings in; then `onSeasonClose` **archives** every rated agent's final
   rating/rank/title into `season_standings` (deterministic UPSERT) and **stamps** the season
   `closed_at` via a single-winner conditional update (`closed_at IS NULL`), recording the
   closing round and the `unranked_until` boundary.

**Baseline reset is structural:** ratings are keyed by `(agent_id, season_id)`, so the next
season's first ranked round resolves to a new `season_id` whose ratings start empty (= baseline).
The closed season's rating rows are retained as history. Consumers of "current" ratings scope by
the open season's id.

## 2. Operator responsibilities

| When | Action |
|---|---|
| Before the boundary | Set/confirm `cutoff_date` (and `unranked_gap_days`) on the open season in `/admin/seasons`. |
| Around the boundary | Let the scrape run; do **not** manually mutate `seasons`/`season_standings`. Watch for the close. |
| After the close | Verify the archive (§5), then **open the next season** (`/admin/seasons`). |

> The admin pages are guarded — only Clerk user IDs in `ADMIN_CLERK_USER_IDS` can reach
> `/admin/seasons`. Ensure your account is listed before the boundary.

## 3. Preconditions (before the cutoff)

- [ ] Exactly **one** season is open (`SELECT * FROM seasons WHERE closed_at IS NULL;` → 1 row).
- [ ] The open season's `cutoff_date` is set to the intended boundary (a `YYYY-MM-DD` on/just
      before the universe reset that should end the season).
- [ ] `unranked_gap_days` is the intended cooldown (0 = the next reset ranks immediately).
- [ ] The cron worker is deployed and its `*/15` trigger is **active** (see
      [`deploy.md`](deploy.md) §5) — the close cannot happen if the scrape is not running.
- [ ] A recent D1 **export/backup** exists (rollback point) before the boundary.

## 4. At the boundary

There is no manual close step. Confirm the scrape is healthy and let it run:

- [ ] Cron invocations are succeeding (Cloudflare Workers logs for `rankings-trade-cron`).
- [ ] When the universe reset lands, a new round finalizes and the close fires automatically on
      the first ranked round with `reset_date ≥ cutoff_date`.

If the scrape is down at the boundary, **restore/redeploy the cron worker first** (see
[`deploy.md`](deploy.md)); the close is healed on the next successful sweep — finalize and the
close trigger are idempotent and re-process pending rounds on replay.

## 5. Verify (after close)

Read-only checks against production D1:

- [ ] The season is stamped closed:
      `SELECT closed_at, /* closing round + unranked_until */ * FROM seasons WHERE id = <season>;`
      → `closed_at` is NOT NULL.
- [ ] Standings archived:
      `SELECT COUNT(*) FROM season_standings WHERE season_id = <season>;`
      → equals the rated population for that season.
- [ ] No stray open season *unless you have already opened the next one*:
      `SELECT id FROM seasons WHERE closed_at IS NULL;` → 0 rows immediately after close (1 row
      once you open the next season).
- [ ] Spot-check a few agents' archived rating/rank/title against expectations.
- [ ] If a gap was configured, the recorded `unranked_until` ≈ closing `reset_date` + gap days.

## 6. Open the next season

After verifying the archive, open the next season in `/admin/seasons` ("Open a new season").
The first ranked round after the boundary (respecting `unranked_until`) resolves into the new
season with baseline ratings. Set its `cutoff_date`/gap for the *next* boundary at the same time
or later — the next cycle repeats this runbook.

## 7. Rollback / recovery

- **Partial-crash during close:** safe — the trigger has no external side effects; the archive
  re-runs and the close stamp is conditional (`closed_at IS NULL`), so a recovery sweep heals it.
  Prefer letting the next sweep complete it over manual edits.
- **Wrong `cutoff_date` discovered *before* the boundary fires:** correct it in `/admin/seasons`
  (updates the open season) — no data has been archived yet.
- **Wrong close already committed:** a closed season is history; `season_standings` and the
  closing round are immutable. Do **not** hand-edit. Restore the pre-boundary D1 backup (§3),
  fix the `cutoff_date`, and let the scrape re-resolve the boundary.
- **Never** manually `UPDATE seasons SET closed_at = NULL` to "reopen" — it desyncs the archive
  and the baseline-reset invariant.
