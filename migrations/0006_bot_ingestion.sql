-- Epic F: bot ingestion — freeform logs, tolerant milestones, the milestone-type
-- registry, and a per-token rate-limit counter.
-- Forward-only, append-only — never edit or delete this migration.
--
-- Logs and milestones are produced by bots over the per-agent token API (Epic C)
-- and reference agents(id). Both support a moderation SOFT-DELETE: a non-null
-- `deleted_at` hides the record from reads while preserving it for audit (the v1
-- philosophy is no physical deletion — see migrations/0004_leagues.sql).
--
-- MILESTONES ARE TOLERANT: the ingestion path NEVER rejects a milestone for an
-- unrecognized `type`. The `milestone_types` registry only distinguishes
-- recognized vs generic types at READ time (Epic J). Default types are GLOBAL
-- (league_id NULL). Leagues may register additional league-scoped custom types.

CREATE TABLE logs (
  id                   INTEGER  PRIMARY KEY AUTOINCREMENT,
  agent_id             INTEGER  NOT NULL REFERENCES agents(id),
  ts                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  text                 TEXT     NOT NULL CHECK (LENGTH(text) BETWEEN 1 AND 2000),
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           DATETIME NULL,
  moderated_by_user_id INTEGER  NULL REFERENCES users(id),
  moderation_reason    TEXT     NULL
);
CREATE INDEX idx_logs_agent_ts ON logs (agent_id, ts);

CREATE TABLE milestones (
  id                   INTEGER  PRIMARY KEY AUTOINCREMENT,
  agent_id             INTEGER  NOT NULL REFERENCES agents(id),
  ts                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type                 TEXT     NOT NULL CHECK (LENGTH(type) BETWEEN 1 AND 80),
  metadata             TEXT     NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at           DATETIME NULL,
  moderated_by_user_id INTEGER  NULL REFERENCES users(id),
  moderation_reason    TEXT     NULL
);
CREATE INDEX idx_milestones_agent_ts ON milestones (agent_id, ts);
CREATE INDEX idx_milestones_type ON milestones (type);

-- Recognized-type registry. A GLOBAL default has league_id NULL and is unique by
-- key. A league-scoped custom type is unique by (league_id, key). The two partial
-- unique indexes keep those namespaces independent so a league may shadow a
-- default key without colliding with it.
CREATE TABLE milestone_types (
  id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
  key                TEXT     NOT NULL CHECK (LENGTH(key) BETWEEN 1 AND 80),
  label              TEXT     NULL,
  league_id          INTEGER  NULL REFERENCES leagues(id),
  created_by_user_id INTEGER  NULL REFERENCES users(id),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_milestone_types_global
  ON milestone_types (key) WHERE league_id IS NULL;
CREATE UNIQUE INDEX idx_milestone_types_league
  ON milestone_types (league_id, key) WHERE league_id IS NOT NULL;

-- Per-token fixed-window rate limiter. One row per token. `window_start` is the
-- integer window index (floor(now_ms / window_ms)) and `count` the requests seen
-- in that window. Updated in place by a single atomic UPSERT (see
-- src/lib/db/ingestion-rate.ts), so rows never accumulate beyond the token count.
CREATE TABLE ingestion_rate_limits (
  token_id     INTEGER  PRIMARY KEY REFERENCES agent_tokens(id),
  window_start INTEGER  NOT NULL,
  count        INTEGER  NOT NULL
);
