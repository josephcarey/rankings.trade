-- Perf (audit §8.1): materialized cache of the OPEN season's live standings.
-- Forward-only — never edit or delete this migration.
--
-- Epic I's `computeSeasonStandings` derives every agent's CURRENT rank/title from the live
-- `(agent_id, season_id)` ratings (DEC-I2). It is the single source of truth, but it is an
-- O(N) full-field recompute, and the read paths (public + UI leaderboard and profile) called
-- it PER REQUEST. This table caches that result for the OPEN season so reads become a scoped
-- SELECT instead of a recompute.
--
-- WHO WRITES IT: the rating trigger (src/lib/ratings/trigger.ts), on every ranked-round
-- finalize — exactly when ratings change. The write is `computeSeasonStandings` →
-- `upsertOpenSeasonStandings` (src/lib/db/open-standings.ts): a single atomic db.batch() of
-- the WHOLE recomputed field, so a page can never observe a half-updated snapshot. Because
-- `applyRatingPeriod` already caps a season at ~D1_MAX_BATCH rated agents (its own batch
-- ceiling), the full field always fits one batch, so no chunking is needed.
--
-- DEC-I2 SCOPING: only the OPEN season is materialized here. A closed season's standings live
-- in the immutable `season_standings` archive (migration 0013) — the trigger skips materializing
-- once a season is closed, and every read scopes by the open season id, so a closed season's
-- rows are never read (harmlessly retained, like the archive).
--
-- IDEMPOTENCY: the write is a deterministic UPSERT on the natural key (season_id, agent_id),
-- and `computeSeasonStandings` reads the live ratings, so re-running it (crash-recovery
-- pending-sweep replay) re-derives the current field and repairs the cache rather than
-- corrupting it. The population for a season only ever grows (ratings are append/update-only,
-- never deleted), so the UPSERT never needs to delete rows.
--
-- COLD CACHE: between this migration running and the next ranked-round finalize, the open
-- season has no cache rows yet, so the read helpers (src/lib/seasons/read-standings.ts) fall back
-- to a fresh `computeSeasonStandings` so there is no stale/empty window, self-clearing once the
-- first round materializes.
--
--   - final_rating / final_rd / final_volatility: the agent's current Glicko-2 state.
--   - final_rank: competition rank (1224) over ALL rated agents in the season by rating desc.
--   - title: the derived tier, or NULL when the agent is not established.
--   - established: 1 when the agent cleared the established-rating floor.
--   - ranked_rounds: how many ranked rounds the agent participated in this season.
--   - materialized_round_id: the ranked round whose finalize last wrote this row (observability).
CREATE TABLE open_season_standings (
  season_id             INTEGER  NOT NULL REFERENCES seasons(id),
  agent_id              INTEGER  NOT NULL REFERENCES agents(id),
  final_rating          REAL     NOT NULL,
  final_rd              REAL     NOT NULL,
  final_volatility      REAL     NOT NULL,
  final_rank            INTEGER  NOT NULL,
  title                 TEXT     NULL,
  established           INTEGER  NOT NULL DEFAULT 0 CHECK (established IN (0, 1)),
  ranked_rounds         INTEGER  NOT NULL DEFAULT 0,
  materialized_round_id INTEGER  NULL REFERENCES rounds(id),
  updated_at            TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (season_id, agent_id)
);

-- Serves the leaderboard's canonical page order (rating desc, agent_id asc) and the
-- COUNT(*)/EXISTS freshness probes — all scoped by season_id.
CREATE INDEX idx_open_season_standings_rank
  ON open_season_standings (season_id, final_rating DESC, agent_id ASC);
