-- Epic I: per-season archived final standings (rating, rank, title) for each rated agent.
-- Forward-only, append-only — never edit or delete this migration.
--
-- Written once, at season close (src/lib/seasons/close.ts), from the season's final `ratings`
-- state plus the derived title (src/lib/titles). One row per (season, agent). The archive is
-- the durable, immutable record of where every agent finished a season. It is independent of
-- the live `ratings` rows (which are retained but no longer the "current" season after close).
--
-- IDEMPOTENCY: the close trigger can be replayed after a crash before the season is stamped
-- closed. The write is a deterministic UPSERT (ON CONFLICT(season_id, agent_id) DO UPDATE),
-- so a partial first attempt is repaired — not just ignored — on replay, and a full replay is
-- a no-op write of identical values. The season is stamped closed only AFTER the archive, so
-- a crash mid-archive re-runs the whole archive harmlessly.
--
--   - final_rating / final_rd / final_volatility: the agent's Glicko-2 state at close.
--   - final_rank: competition rank (1224) over ALL rated agents in the season by rating desc.
--   - title: the derived tier, or NULL when the agent is not established (see `established`).
--   - established: 1 when the agent cleared the established-rating floor (RD + ranked rounds).
--   - ranked_rounds: how many ranked rounds the agent participated in this season.
CREATE TABLE season_standings (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  season_id        INTEGER  NOT NULL REFERENCES seasons(id),
  agent_id         INTEGER  NOT NULL REFERENCES agents(id),
  final_rating     REAL     NOT NULL,
  final_rd         REAL     NOT NULL,
  final_volatility REAL     NOT NULL,
  final_rank       INTEGER  NOT NULL,
  title            TEXT     NULL,
  established       INTEGER  NOT NULL DEFAULT 0 CHECK (established IN (0, 1)),
  ranked_rounds    INTEGER  NOT NULL DEFAULT 0,
  created_at       TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (season_id, agent_id)
);

CREATE INDEX idx_season_standings_season ON season_standings (season_id, final_rank);
CREATE INDEX idx_season_standings_agent ON season_standings (agent_id);
