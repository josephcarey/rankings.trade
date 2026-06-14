# Runbook — Epic K legacy data migration & cutover

> **Status: TOOLING BUILT + DRY-RUN GREEN. The production cutover below is NOT yet authorized.**
> The stakeholder has authorized building and dry-run testing only. The actual production
> write is a separate, human-triggered step. Do **not** run any `--remote` write against the
> production D1 until the cutover is explicitly approved.

> See also: [`season-calendar.md`](season-calendar.md) — the season/off-week schedule and the
> `cutoff_date` / `unranked_gap_days` mechanic that bootstraps Season 1.

## 1. What this migration does

A one-time backfill of the legacy **SpaceJam leaderboard** history into rankings.trade:

1. **Export** the legacy snapshots from the old `spacejam-db` D1.
2. **Transform** them onto the current `snapshots` schema — dropping the historical net-worth
   estimate and the `chart_count`/`chart_rank` columns, normalising agent symbols to UPPER.
3. **Import** the snapshots, then **reconstruct `rounds`** from their `reset_date`s, processed
   strictly in **chronological order**. Each round's final standing is its **last observation
   bucket** (`MAX(observed_at)`) — identical to live finalization (no forked semantics).
4. **Recompute Glicko-2 ratings from genesis** by replaying Epic H's rating engine across the
   historical rounds in order, into an archived **"Season 0"**.
5. **Close & archive Season 0** (its `cutoff_date` is the last legacy reset_date, so the final
   legacy round closes it). The live season is opened **empty/baseline** at launch — a separate
   admin step — so current-season ratings start clean (DEC-6 / DEC-I2).

The tooling lives in `src/lib/import/` and `scripts/import-legacy.ts`. It is **idempotent and
deterministic**: re-running yields the same semantic state; a crashed run is repaired (not
duplicated) on re-run.

## 2. Key design decisions

| Decision | Rationale |
|---|---|
| **Reuse, don't fork.** Import composes Epic G finalize + Epic H rating trigger + Epic I season resolver/close, exactly as production (`src/lib/scrape/scheduled.ts`). | Imported history behaves byte-for-byte like live history. |
| **Final standing = `MAX(observed_at)` bucket.** | Matches live finalization. Agents absent from the final bucket are excluded from that round's standing (and get the "did not compete" RD inflation if they already hold a rating). |
| **Incomplete final snapshots are flagged, not silently accepted.** The dry-run reports, per round, `peakAgents` vs `finalAgents`; a final bucket below `incompleteFinalThreshold × peak` (default 0.5) is flagged. `--fail-on-incomplete` aborts the run for review. | A partial final capture can materially change a round's standing; a human reviews flagged rounds before cutover. |
| **`registerAllAgents` defaults FALSE.** Only already-registered agents (the seeded starter crew) are rated; every public agent's snapshots are still imported (history viewable, unrated). | The legacy export holds **every** public agent (hundreds+); one Glicko rating period must fit a single D1 batch (≤ 99 rated agents). This default matches live production (only claimed agents are rated). A preflight **hard-fails** if the rated field would exceed the batch limit. |
| **No new migration.** Idempotency comes from existing keys: `snapshots` unique key, `rounds`/`rating_periods`/season markers, `season_standings` UPSERT, and strict Season-0 validation on re-run. | Migrations `0015`/`0016` are reserved for Epic K but **unused**. |
| **`launchResetDate` is an explicit input.** Must be a real ISO date strictly **after** every legacy reset_date. | Guarantees every legacy round is "ended" and finalized; the first live round resolves to the new (empty) season. |

## 3. Preconditions (verify before cutover)

- [ ] All Epic K dependencies (D, E, G, H, I) merged to `main` and deployed.
- [ ] Production D1 migrations are fully applied (through `0013`), including `0005` which seeds
      the **SpaceJam** starter league + its 9 unclaimed agent rows.
- [ ] **No season is currently open** in production (the import opens/archives Season 0). If a
      live season was already opened, STOP — re-plan with the stakeholder.
- [ ] Production `snapshots`/`rounds` are empty for the legacy reset_date range (no live data has
      been written yet). The import assumes a clean pre-launch destination.
- [ ] A fresh **backup/export** of the production D1 has been taken (rollback point).
- [ ] The legacy export file is in hand (see §4) and its `reset_date` range is known, so
      `launchResetDate` can be chosen strictly after it.

## 4. Producing the legacy export

The old app is the Cloudflare Worker `spacejam-db` (separate D1). Export it (read-only) as
either format the importer accepts:

```bash
# Option A — sqlite file (preferred):
wrangler d1 export spacejam-db --output legacy.sqlite     # run from the legacy repo

# Option B — JSON: dump the snapshots table and reshape to a flat array of row objects.
```

> **If you do not have the real legacy export, STOP and request it from the coordinator** —
> do not fabricate or guess its location. The dry-run uses synthetic fixtures
> (`src/lib/import/fixtures/legacy-fixture.ts`); the real cutover needs the real export.

## 5. Dry-run (authorized now)

The full pipeline is exercised against fixtures by the test suite:

```bash
bun run test            # includes src/lib/import/*.test.ts (29 tests)
# or focused:
bunx vitest run src/lib/import
```

To dry-run against the **real** export without touching production, point the CLI at a
throwaway/preview database (e.g. a local `wrangler d1` or a disposable preview DB):

```bash
# within a wrangler context that binds DB to a NON-production database:
bun scripts/import-legacy.ts --source legacy.sqlite --launch <LIVE_RESET_DATE>
```

Review the printed JSON summary:

- `resetDates` / `roundsFinalized` — every legacy round reconstructed, chronological.
- `integrity[]` — inspect any `incompleteFinal: true` rounds; decide accept vs repair.
- `maxRatingPeriodAgents` — must be ≤ 99 (else the run hard-fails; reconsider `registerAllAgents`).
- `seasonClosed: true` and `seasonStandings` — Season 0 archived.
- `unratedSymbols` / `invalidSymbols` — expected history-only / rejected callsigns.

## 6. Data-integrity checks (run before AND after)

Before cutover (on the dry-run against real data):

- [ ] `roundsFinalized` equals the count of distinct legacy `reset_date`s.
- [ ] No unexpected `incompleteFinal` rounds (or each is reviewed & accepted).
- [ ] `maxRatingPeriodAgents ≤ 99`.
- [ ] The rated set (`distinctSymbols − unratedSymbols`) matches the intended population.

After cutover (against production, read-only queries):

- [ ] `SELECT COUNT(*) FROM rounds WHERE finalized_at IS NOT NULL;` = distinct legacy reset_dates.
- [ ] `SELECT closed_at FROM seasons WHERE label = 'Season 0';` is NOT NULL.
- [ ] `SELECT COUNT(*) FROM season_standings;` = the rated population.
- [ ] `SELECT 1 FROM seasons WHERE closed_at IS NULL;` returns **no rows** (no stray open season).
- [ ] Spot-check a few agents' Season 0 final ratings against the dry-run summary.

## 7. Cutover (HUMAN-GATED — do not run without explicit approval)

1. Confirm every §3 precondition and §6 "before" check.
2. Take the production backup (§3).
3. Run the import against production with explicit acknowledgement:
   ```bash
   bun scripts/import-legacy.ts --source legacy.sqlite --launch <LIVE_RESET_DATE> --confirm-cutover
   ```
4. Run the §6 "after" checks.
5. **Open the live season** (admin/Epic I flow) so the first post-launch round is ranked into a
   fresh, empty season — Season 0 stays archived as history.

## 8. Rollback

The import only **adds** rows (snapshots, agents, rounds, standings, ratings, one season,
season_standings) — it never edits shipped data. Rollback options, in order of preference:

1. **Restore the pre-cutover backup** (§3) — the clean, guaranteed rollback.
2. If a re-run is needed after fixing the legacy export, note that finalized rounds are
   immutable; the importer's strict Season-0 validation will **refuse** to continue if the data
   changed (different cutoff/close round). In that case restore the backup first, then re-import.

## 9. Re-run / idempotency notes

- Re-running with the **same** export and `launchResetDate` is a no-op repair: snapshots upsert,
  agents `INSERT OR IGNORE`, rounds/ratings/season markers gate the downstream work, and
  `season_standings` UPSERT rewrites identical values.
- A partial crash (e.g. after opening Season 0 but before close) is healed on re-run: the
  finalize sweep re-processes pending rounds and the close trigger archives + stamps closed.
- Changing the legacy data between runs is detected by the Season-0 validation and **rejected**
  to avoid silently mixing two datasets.
