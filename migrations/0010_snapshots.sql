-- NOTE: Numbering jumps 0008 -> 0010 -- there is no 0009 migration. The reason for the
-- gap is undocumented (0009 was never committed). It is recorded as an unexplained gap in
-- the migrations/README.md ledger. Do NOT reuse 0009.
-- Periodic (15-min cron) captures of each public agent's credits and rank per round.
-- A round is keyed by the SpaceTraders `resetDate`. Credits is the ranking metric.
--
-- Ported from the legacy SpaceJam leaderboard, with the net-worth estimate and the
-- chart leaderboard columns (chart_count/chart_rank) intentionally DROPPED. `ship_count`
-- is retained and `faction` (the agent's startingFaction) is added.
--
-- Forward-only, append-only — never edit or delete this migration.
CREATE TABLE snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_date   TEXT    NOT NULL,
  observed_at  TEXT    NOT NULL,
  agent_symbol TEXT    NOT NULL,
  credits      INTEGER,
  credit_rank  INTEGER,
  total_agents INTEGER,
  ship_count   INTEGER,
  faction      TEXT,
  UNIQUE (reset_date, observed_at, agent_symbol)
);

CREATE INDEX idx_snapshots_agent_time ON snapshots (agent_symbol, observed_at);

CREATE INDEX idx_snapshots_reset_time ON snapshots (reset_date, observed_at);
