-- Epic C: agents, per-agent API tokens, and an ownership audit trail.
-- Forward-only, append-only — never edit or delete this migration.
--
-- `agents.owner_user_id` is NULLABLE so scraped-but-unclaimed participants can
-- exist before anyone claims them. One active owner per agent is enforced by an
-- atomic conditional claim (see src/lib/db/agents.ts). `verified` defaults to 0:
-- v1 claims are trust-based and shown as "unverified".
CREATE TABLE agents (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT     NOT NULL UNIQUE
                         CHECK (symbol = UPPER(symbol) AND LENGTH(symbol) BETWEEN 3 AND 20),
  display_name  TEXT     NULL,
  owner_user_id INTEGER  NULL REFERENCES users(id),
  verified      INTEGER  NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-agent API tokens. Only the SHA-256 hash is stored (the raw token is shown
-- once). `owner_user_id` snapshots the owner at creation so an ownership transfer
-- can revoke exactly the prior owner's active tokens. `token_prefix` is a
-- non-secret display fragment for listing.
CREATE TABLE agent_tokens (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  agent_id      INTEGER  NOT NULL REFERENCES agents(id),
  owner_user_id INTEGER  NOT NULL REFERENCES users(id),
  token_hash    TEXT     NOT NULL UNIQUE,
  token_prefix  TEXT     NOT NULL,
  label         TEXT     NOT NULL CHECK (LENGTH(label) BETWEEN 1 AND 60),
  last_used_at  DATETIME NULL,
  revoked_at    DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agent_tokens_agent ON agent_tokens (agent_id);

-- Append-only audit trail for ownership changes (claims, admin transfers/releases).
CREATE TABLE agent_ownership_events (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  agent_id            INTEGER  NOT NULL REFERENCES agents(id),
  event_type          TEXT     NOT NULL
                               CHECK (event_type IN ('claim', 'transfer', 'admin_release')),
  actor_user_id       INTEGER  NULL REFERENCES users(id),
  prior_owner_user_id INTEGER  NULL REFERENCES users(id),
  new_owner_user_id   INTEGER  NULL REFERENCES users(id),
  reason              TEXT     NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agent_ownership_events_agent ON agent_ownership_events (agent_id);
