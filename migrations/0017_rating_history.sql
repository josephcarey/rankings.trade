-- Epic O: append-only per-round Glicko-2 rating history (deltas + rating-over-time).
-- Forward-only, append-only — never edit or delete this migration.
--
-- Epic H's `ratings` table (migration 0011) stores only the CURRENT rating per
-- (agent_id, season_id): it is UPSERTed (overwritten) every ranked round, so it keeps NO
-- per-round history. This table is the missing history: ONE immutable row per rated agent
-- per applied ranked round, written in the SAME atomic D1 batch as the rating UPSERTs and
-- the `rating_periods` marker (src/lib/db/ratings.ts applyRatingPeriod). Because the write
-- rides that single batch, history can never disagree with the current rating — a crash
-- either commits both or neither, and the marker makes replay a no-op.
--
--   - rating / rd: the agent's post-period Glicko-2 state for this round (same values the
--     matching `ratings` row was UPSERTed to).
--   - rank: the agent's competition rank (1224) within the round's full rated population,
--     by rating desc — identical to the leaderboard's live rank (Epic I
--     computeSeasonStandings / src/lib/ratings/rank.ts), so rank deltas track the displayed
--     rank exactly and never require recomputing historical standings.
--
-- IDEMPOTENCY: `UNIQUE (agent_id, round_id)` mirrors Epic H's marker/UPSERT idempotency —
-- a re-applied period (which already short-circuits on the marker) can never double-insert.
-- History begins at this migration: rounds whose rating periods were applied before it have
-- no rows, so deltas/charts are empty until enough post-migration ranked rounds run.
CREATE TABLE rating_history (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  agent_id   INTEGER  NOT NULL REFERENCES agents(id),
  -- Season-scoped, mirroring `ratings.season_id` (the per-season baseline reset, DEC-I2).
  season_id  INTEGER  NOT NULL,
  round_id   INTEGER  NOT NULL REFERENCES rounds(id),
  rating     REAL     NOT NULL,
  rd         REAL     NOT NULL,
  rank       INTEGER  NOT NULL,
  created_at TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_id, round_id)
);

-- Per-agent season timeline (the rating-over-time chart + an agent's two most recent rows).
CREATE INDEX idx_rating_history_agent_season ON rating_history (agent_id, season_id);
-- All rows for one round (the leaderboard's "latest two rounds" delta scan).
CREATE INDEX idx_rating_history_round ON rating_history (round_id);
