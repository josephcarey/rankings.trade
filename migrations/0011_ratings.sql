-- Epic H: season-scoped Glicko-2 ratings and the rating-period idempotency marker.
-- Forward-only, append-only — never edit or delete this migration.
--
-- A RATING is one registered agent's current Glicko-2 state within one season. The
-- finalization of a ranked round is treated as a single rating period (DEC-1): the
-- round's Universe standings are expanded in-memory to a round-robin of pairwise
-- outcomes (higher final_credits wins, equal = draw) and every participating agent's
-- rating is updated once. Registered agents who already hold a season rating but did
-- not participate receive a "did not compete" RD-inflation update. Constants and the
-- RD band live in src/lib/ratings/config.ts (DEC-H1). The per-season baseline reset is
-- Epic I's job — Epic H only keys ratings by the season_id carried on the round.
--
-- IDEMPOTENCY (see src/lib/ratings/trigger.ts):
--   * The Epic G orchestrator can re-invoke the rating trigger after a crash between the
--     trigger committing and `rounds.ratings_applied_at` being set, so the trigger must
--     dedupe on its own.
--   * `rating_periods` is that dedupe key: one row per applied round, written in the SAME
--     atomic batch as the rating updates. A re-run sees the marker and is a no-op. This is
--     used instead of inspecting `ratings.last_round_id` because a later round can
--     overwrite `last_round_id`, which would make a last-round-based check unsafe.

CREATE TABLE ratings (
  agent_id      INTEGER  NOT NULL REFERENCES agents(id),
  -- season_id is a plain integer (the seasons table arrives in Epic I). It mirrors the
  -- value carried on rounds.season_id so ratings are season-scoped and reset per season.
  season_id     INTEGER  NOT NULL,
  rating        REAL     NOT NULL,
  rd            REAL     NOT NULL,
  volatility    REAL     NOT NULL,
  -- The most recent round whose rating period touched this agent (provenance + display).
  last_round_id INTEGER  NULL REFERENCES rounds(id),
  created_at    TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, season_id)
);

CREATE INDEX idx_ratings_season ON ratings (season_id);

-- One row per ranked round whose rating period has been applied. Inserted atomically with
-- the rating updates. `round_id` is the PRIMARY KEY so a duplicate (concurrent) replay
-- fails the batch instead of double-applying. `season_id` is denormalized for auditing.
CREATE TABLE rating_periods (
  round_id   INTEGER  PRIMARY KEY REFERENCES rounds(id),
  season_id  INTEGER  NOT NULL,
  applied_at TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rating_periods_season ON rating_periods (season_id);
