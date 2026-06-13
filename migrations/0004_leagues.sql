-- Epic E: leagues, temporal membership, and reusable shareable invite links.
-- Forward-only, append-only — never edit or delete this migration.
--
-- Membership is TEMPORAL: leaving sets league_members.left_at rather than
-- deleting the row, so a future round finalization (Epic G) can freeze which
-- agents were active at that moment and archived rounds stay stable.
-- Participants are agents. agents.owner_user_id may be NULL, so unclaimed
-- agents can participate. Invite links are REUSABLE secrets stored only as a
-- SHA-256 hash (see src/lib/leagues/invite-token.ts), revocable and rotatable.
-- v1 performs no physical user/agent deletion, so foreign keys use no cascade.
-- Leagues are private by default and visibility is configurable to public.
-- owner_user_id is NULLABLE: most leagues are owned by their creating user, but
-- the seeded starter league (migration 0005) is SYSTEM-OWNED (NULL owner) and
-- managed by admins only. Guards treat a NULL owner as "no individual owner", so
-- owner-or-admin checks fall through to admin-only (see league-service.ts).
CREATE TABLE leagues (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  name          TEXT     NOT NULL CHECK (LENGTH(name) BETWEEN 1 AND 80),
  description   TEXT     NULL,
  visibility    TEXT     NOT NULL DEFAULT 'private'
                         CHECK (visibility IN ('private', 'public')),
  owner_user_id INTEGER  NULL REFERENCES users(id),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_leagues_owner ON leagues (owner_user_id);

-- Temporal membership: NULL `left_at` is an active membership. `added_by_user_id`
-- snapshots who added the agent (owner/admin, or the joining user via an invite).
CREATE TABLE league_members (
  id               INTEGER  PRIMARY KEY AUTOINCREMENT,
  league_id        INTEGER  NOT NULL REFERENCES leagues(id),
  agent_id         INTEGER  NOT NULL REFERENCES agents(id),
  added_by_user_id INTEGER  NULL REFERENCES users(id),
  joined_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at          DATETIME NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- At most one ACTIVE membership per agent per league. Full join/leave/re-join
-- history is preserved as additional rows with a non-null `left_at`.
CREATE UNIQUE INDEX idx_league_members_active
  ON league_members (league_id, agent_id) WHERE left_at IS NULL;
CREATE INDEX idx_league_members_league ON league_members (league_id);
CREATE INDEX idx_league_members_agent ON league_members (agent_id);

-- Reusable shareable join links. Only the SHA-256 hash of the secret token is
-- stored. `token_prefix` is a non-secret display fragment. NULL `revoked_at` is
-- an active link. Rotate = revoke the active link and create a new one.
CREATE TABLE league_invites (
  id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
  league_id          INTEGER  NOT NULL REFERENCES leagues(id),
  token_hash         TEXT     NOT NULL UNIQUE,
  token_prefix       TEXT     NOT NULL,
  created_by_user_id INTEGER  NOT NULL REFERENCES users(id),
  revoked_at         DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_league_invites_league ON league_invites (league_id);
