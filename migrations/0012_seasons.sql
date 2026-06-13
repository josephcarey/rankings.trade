-- Epic I: Universe seasons — the lifecycle that activates ranked rounds.
-- Forward-only, append-only — never edit or delete this migration.
--
-- A SEASON is an admin-created competitive period. Exactly one season is OPEN at a time
-- (closed_at IS NULL, enforced by the partial unique index below). While a season is open
-- and a finalized round is not inside a prior season's unranked gap, the round is tagged
-- RANKED and scoped to that season (src/lib/seasons/resolver.ts) — this is the piece that
-- turns on Epic H's rating trigger in production. With no open season, or inside an unranked
-- gap, rounds are archived but UNRANKED (season_id NULL), matching the ranked⇒season
-- invariant enforced by rounds' CHECK (migrations/0008_rounds.sql) and finalize.ts.
--
-- CLOSE (src/lib/seasons/close.ts): the open season closes at the FIRST universe reset on or
-- after its cutoff_date. On close the round's final standings/ratings/titles are archived
-- (season_standings, migration 0013) and the season is stamped closed. The per-season
-- "reset to baseline" is STRUCTURAL, not destructive: ratings are keyed by (agent_id,
-- season_id), so the NEXT season's first ranked round resolves to a new season_id whose
-- ratings start empty = baseline. Season rating rows are retained as history.
--
-- UNRANKED GAP (DEC-3, default 0): unranked_gap_days is an admin-set warm-up after this
-- season closes. At close, unranked_until is set to (closing reset_date + gap days) when the
-- gap is positive, else left NULL. Rounds whose reset_date falls strictly between the closing
-- reset and unranked_until are tagged unranked (excluded from ratings, Epic H).
--
-- ASSUMPTION (documented): rounds are finalized in reset_date order (Epic G's sweep is
-- ORDER BY reset_date ASC and H enforces a chronological barrier). The resolver therefore
-- classifies by the currently-open season. A ranked historical backfill predating a close is
-- treated as unranked by policy — it can never retro-rank into an already-closed season.
CREATE TABLE seasons (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  label             TEXT     NOT NULL,
  -- The season closes at the first reset on/after this date (compared lexicographically
  -- against the round's reset_date, the same natural-key ordering used elsewhere).
  cutoff_date       TEXT     NOT NULL,
  -- Admin-set unranked warm-up after THIS season closes (DEC-3 default 0).
  unranked_gap_days INTEGER  NOT NULL DEFAULT 0 CHECK (unranked_gap_days >= 0),
  opened_at         TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at         TEXT     NULL,
  -- Provenance: the round whose finalization closed this season.
  closed_round_id   INTEGER  NULL REFERENCES rounds(id),
  -- First ranked reset_date AFTER the gap (exclusive upper bound of the gap window). NULL
  -- while open, and NULL after close when gap = 0 (no gap window).
  unranked_until    TEXT     NULL,
  created_at        TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- At most one open season: the partial index keys the (always-1) expression `closed_at IS
-- NULL` over only the open rows, so a second open season violates uniqueness.
CREATE UNIQUE INDEX idx_seasons_single_open
  ON seasons ((closed_at IS NULL)) WHERE closed_at IS NULL;

CREATE INDEX idx_seasons_closed_at ON seasons (closed_at);
