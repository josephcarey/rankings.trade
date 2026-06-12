-- Create the users table linked to Clerk user IDs.
-- Visibility is stored here for later filtering in public-profile views (Epic J).
-- Forward-only, append-only — never edit or delete this migration.
CREATE TABLE users (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT     NOT NULL UNIQUE,
  email         TEXT     NULL,
  display_name  TEXT     NULL,
  visibility    TEXT     NOT NULL DEFAULT 'public'
                         CHECK (visibility IN ('public', 'private')),
  dashboard_url TEXT     NULL
                         CHECK (dashboard_url IS NULL OR LENGTH(dashboard_url) <= 2048),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
