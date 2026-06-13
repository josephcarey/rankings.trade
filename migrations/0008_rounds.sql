-- Epic G: rounds and their frozen final standings (automatic finalization).
-- Forward-only, append-only — never edit or delete this migration.
--
-- A ROUND is one SpaceTraders universe keyed by its `resetDate` (the same key the
-- `snapshots` table uses, migration 0010). When the universe resets the live
-- resetDate changes and the old reset_date never receives new snapshots again, so
-- its last snapshot is its final standing. Finalization captures that standing,
-- freezes per-league membership, tags the round, archives it, and leaves seams for
-- Epic H (ratings) and Epic I (seasons) to process.
--
-- IDEMPOTENCY / IMMUTABLE HISTORY (see src/lib/rounds/finalize.ts):
--   * `final_observed_at`, `season_id`, `is_ranked` and `membership_frozen_at` are the
--     immutable INPUTS to finalization. They are written once, at the first claim, and
--     re-used verbatim on every retry so a re-run recomputes byte-identical standings.
--   * `membership_frozen_at` is the point-in-time the league roster is frozen at. league
--     standings are reconstructed as `joined_at <= frozen AND (left_at IS NULL OR
--     left_at > frozen)`, so a later join/leave can never rewrite an archived round.
--   * `finalized_at` is the single-winner finalize marker (set last, conditionally).
--   * `ratings_applied_at` / `season_processed_at` are the Epic H / Epic I processing
--     markers. G sets them after the (idempotent) trigger seams resolve, so a crash
--     between finalize and trigger is recovered by re-processing pending rounds rather
--     than silently losing the downstream work.
--
-- RANKED ⇒ SEASON invariant: a ranked round must carry a concrete season_id. Before any
-- season exists (Epic I) the default season resolver tags rounds unranked, so they are
-- archived but excluded from ratings — matching the "unranked gap" rule.
CREATE TABLE rounds (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  reset_date          TEXT     NOT NULL UNIQUE,
  started_at          TEXT     NULL,
  final_observed_at   TEXT     NULL,
  membership_frozen_at TEXT    NULL,
  finalized_at        TEXT     NULL,
  season_id           INTEGER  NULL,
  is_ranked           INTEGER  NOT NULL DEFAULT 0 CHECK (is_ranked IN (0, 1)),
  ratings_applied_at  TEXT     NULL,
  season_processed_at TEXT     NULL,
  created_at          TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A ranked round must be tied to a concrete season (Epic H rates season-scoped).
  CHECK (is_ranked = 0 OR season_id IS NOT NULL)
);

CREATE INDEX idx_rounds_finalized ON rounds (finalized_at);
CREATE INDEX idx_rounds_season ON rounds (season_id);

-- One frozen standing row per agent per scope of a round. `league_id IS NULL` is the
-- global Universe standing. a non-null `league_id` is that league's private standing.
-- `agent_symbol` is the immutable identity (matches the snapshot's natural key).
-- `agent_id` is advisory provenance and may be NULL for scraped-but-unregistered agents.
-- `final_credits` is the source of truth for outcomes (equal credits = draw in Epic H).
-- `participated = 0` rows are league members who had no snapshot in the final
-- observation (NULL credits) — they are excluded from pairwise rating expansion.
CREATE TABLE round_standings (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  round_id      INTEGER  NOT NULL REFERENCES rounds(id),
  league_id     INTEGER  NULL REFERENCES leagues(id),
  agent_symbol  TEXT     NOT NULL,
  agent_id      INTEGER  NULL REFERENCES agents(id),
  final_credits INTEGER  NULL,
  final_rank    INTEGER  NOT NULL,
  participated  INTEGER  NOT NULL DEFAULT 1 CHECK (participated IN (0, 1)),
  created_at    TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SQLite treats NULLs as distinct in a plain UNIQUE, so the Universe scope (NULL
-- league_id) and the per-league scope need separate partial unique indexes. These are
-- the idempotency key: re-running finalization is INSERT OR IGNORE against them.
CREATE UNIQUE INDEX idx_round_standings_universe
  ON round_standings (round_id, agent_symbol) WHERE league_id IS NULL;
CREATE UNIQUE INDEX idx_round_standings_league
  ON round_standings (round_id, league_id, agent_symbol) WHERE league_id IS NOT NULL;
CREATE INDEX idx_round_standings_round ON round_standings (round_id);
CREATE INDEX idx_round_standings_agent ON round_standings (agent_symbol);
