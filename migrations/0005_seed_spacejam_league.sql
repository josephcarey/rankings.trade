-- Epic E (E12): seed the legacy SpaceJam leaderboard crew as a starter league.
-- Forward-only, run-once — never edit or delete this migration.
--
-- This mirrors the runtime "add agent by callsign, auto-create unclaimed" path:
-- each callsign is created as an unclaimed agent (owner_user_id NULL, verified 0)
-- if it does not already exist, then added as an ACTIVE member (left_at NULL).
-- The starter league is SYSTEM-OWNED (owner_user_id NULL) and PUBLIC so it is
-- world-readable as a showcase. NULL-owner leagues are admin-managed (guards
-- fall through to admin-only — see src/lib/leagues/league-service.ts).
INSERT OR IGNORE INTO agents (symbol, display_name) VALUES
  ('BAMES_JOND', 'Christian'),
  ('JBARHORST', 'John'),
  ('OLSON_AGENT', 'Mike'),
  ('S41N7-II', 'Joe'),
  ('SPACEJAM-DK-2', 'Daniel'),
  ('SPARKY', 'Mark'),
  ('STARFOX-5', 'Max'),
  ('TYLERMASTERY', 'Tyler'),
  ('TYLERMASTERY2', 'Tyler2');

INSERT INTO leagues (name, description, visibility, owner_user_id) VALUES
  ('SpaceJam', 'The original SpaceJam leaderboard crew.', 'public', NULL);

INSERT INTO league_members (league_id, agent_id, added_by_user_id)
SELECT (SELECT id FROM leagues WHERE name = 'SpaceJam'), a.id, NULL
FROM agents a
WHERE a.symbol IN (
  'BAMES_JOND', 'JBARHORST', 'OLSON_AGENT', 'S41N7-II', 'SPACEJAM-DK-2',
  'SPARKY', 'STARFOX-5', 'TYLERMASTERY', 'TYLERMASTERY2'
);
