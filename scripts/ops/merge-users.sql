-- Ops script — MERGE duplicate user rows (NOT an auto-run migration)
-- ==================================================================
--
-- WHY THIS LIVES IN scripts/ops/ AND NOT migrations/:
--   Migrations under migrations/ are run-once and applied automatically by
--   `bun run db:migrate`. This merge is a one-off DATA repair against a specific
--   pair of rows in ONE environment (prod). It must be run MANUALLY by an
--   operator (see docs/runbooks/user-merge.md), never auto-applied. Keeping it
--   out of migrations/ guarantees `db:migrate` never fires it.
--
-- WHAT IT DOES:
--   Repoints every users.id foreign key from FROM_ID (the stale duplicate) to
--   TO_ID (the canonical row), then deletes the stale row. The two ids below
--   are the prod duplicate of josephcareycomposer@gmail.com:
--     FROM_ID = 1   (older clerk_user_id — to be removed)
--     TO_ID   = 10  (current/active — canonical, kept)
--   Change these two values if reusing the script for a different pair.
--
-- IDEMPOTENT + GUARDED:
--   - Every UPDATE repoints `= FROM_ID` to `TO_ID`; re-running finds no FROM_ID
--     references the second time, so it is a no-op.
--   - The final DELETE only removes FROM_ID when the canonical TO_ID still
--     exists, so a half-applied run can be safely re-run and an accidental run
--     against a DB missing the canonical row deletes nothing.
--   - Wrapped in a single transaction so a failure rolls the whole merge back.
--
-- PRE-FLIGHT: verify the two rows are the same person BEFORE running
--   (see the runbook). DO NOT run against prod without explicit authorization.

BEGIN TRANSACTION;

-- Epic C — agents, tokens, ownership audit trail
UPDATE agents               SET owner_user_id       = 10 WHERE owner_user_id       = 1;
UPDATE agent_tokens         SET owner_user_id       = 10 WHERE owner_user_id       = 1;
UPDATE agent_ownership_events SET actor_user_id       = 10 WHERE actor_user_id       = 1;
UPDATE agent_ownership_events SET prior_owner_user_id = 10 WHERE prior_owner_user_id = 1;
UPDATE agent_ownership_events SET new_owner_user_id   = 10 WHERE new_owner_user_id   = 1;

-- Epic E — leagues, temporal membership, invites
UPDATE leagues              SET owner_user_id       = 10 WHERE owner_user_id       = 1;
UPDATE league_members       SET added_by_user_id    = 10 WHERE added_by_user_id    = 1;
UPDATE league_invites       SET created_by_user_id  = 10 WHERE created_by_user_id  = 1;

-- Epic F — bot ingestion: logs, milestones, milestone types
UPDATE logs                 SET moderated_by_user_id = 10 WHERE moderated_by_user_id = 1;
UPDATE milestones           SET moderated_by_user_id = 10 WHERE moderated_by_user_id = 1;
UPDATE milestone_types      SET created_by_user_id   = 10 WHERE created_by_user_id   = 1;

-- Remove the stale duplicate row, but only once the canonical row exists.
-- (User settings — visibility, dashboard_url — live ON the users row itself, so
-- there is no separate settings table to repoint; the stale settings are dropped
-- with the row, the canonical row keeps its own.)
DELETE FROM users
 WHERE id = 1
   AND EXISTS (SELECT 1 FROM users WHERE id = 10);

COMMIT;
