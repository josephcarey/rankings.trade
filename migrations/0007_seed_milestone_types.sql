-- Epic F (DEC-4): seed the six DEFAULT (global) milestone types. These are the
-- recognized-by-default keys. Leagues may register additional custom types at
-- runtime (see src/lib/ingestion/milestone-type-service.ts).
-- Forward-only, run-once — never edit or delete this migration.
--
-- `league_id IS NULL` marks a global default. INSERT OR IGNORE keeps the seed
-- idempotent against the partial unique index idx_milestone_types_global.
INSERT OR IGNORE INTO milestone_types (key, label, league_id) VALUES
  ('first-jump',     'First Jump',      NULL),
  ('first-ship',     'First Ship',      NULL),
  ('fleet-size-10',  'Fleet of 10',     NULL),
  ('credits-1m',     '1M Credits',      NULL),
  ('credits-10m',    '10M Credits',     NULL),
  ('system-charted', 'System Charted',  NULL);
