# Runbook — User merge (duplicate-by-email repair)

> **Status: SCRIPT BUILT. The production merge is NOT auto-applied and NOT yet run.**
> This is a one-off DATA repair against prod. Run it MANUALLY, with a backup, after verifying
> the two rows are the same person. Do **not** run any `--remote` write against production D1
> until explicitly authorized.

## 1. The problem

Prod `users` has **two rows for the same email** (`josephcareycomposer@gmail.com`):

| id | clerk_user_id | status |
|----|---------------|--------|
| 1  | older Clerk id | stale duplicate — to be removed |
| 10 | current Clerk id | canonical — to be kept |

The duplicate arose because `provisionUser` keyed only on `clerk_user_id`: when the same person
re-authenticated under a **new** Clerk identity (same email, different `clerk_user_id`), a second
row was inserted instead of re-using the existing one.

## 2. Prevention (already shipped)

- **Code guard:** `provisionUser` (`src/lib/db/users.ts`) now re-links — when no row matches the
  incoming `clerk_user_id` but a row already exists for the same non-null `email`, it updates
  that row's `clerk_user_id` instead of inserting a duplicate. This stops NEW duplicates at the
  source.
  - **Verified-email only (account-takeover guard):** the re-link fires **only when Clerk reports
    the primary email as verified** (`email_verified === true`, derived in
    `src/lib/auth/clerk-identity.ts` from `verification.status === "verified"`). An unverified
    address can never re-link (and thereby seize) an existing account — such sign-ins fall through
    to `INSERT`, where the unique index below rejects a genuine duplicate loudly. Assumption: Clerk
    is the source of truth for email verification.
  - **Case-insensitive:** email is normalized (trimmed + lowercased) on every write and lookup, so
    `Joe@x` and `joe@x` are the same account and cannot both exist.
  - **Newest-row preference (deploy/merge ordering):** the email lookup selects the **newest**
    matching row (`ORDER BY id DESC`). This matters in the window between deploying the guard and
    running this merge: while the duplicate still exists, the canonical row is the **higher** id
    (id 10, not the stale id 1), so a re-auth in that window re-links onto id 10 — it never revives
    the row this merge is about to delete. (Deploying the guard before the merge is therefore safe,
    but running the merge promptly is still recommended.)
- **DB backstop:** migration `0019_users_email_unique.sql` adds a partial unique index on
  `lower(email)` (where not null). **It must be applied only AFTER the merge below** — applying it
  while the duplicate still exists fails with a uniqueness violation.

## 3. The merge script

`scripts/ops/merge-users.sql` repoints every `users.id` foreign key from `FROM_ID = 1` to
`TO_ID = 10`, then deletes row 1. It covers all FK columns:

- `agents.owner_user_id`, `agent_tokens.owner_user_id`
- `agent_ownership_events.{actor,prior_owner,new_owner}_user_id`
- `leagues.owner_user_id`, `league_members.added_by_user_id`, `league_invites.created_by_user_id`
- `logs.moderated_by_user_id`, `milestones.moderated_by_user_id`, `milestone_types.created_by_user_id`

User settings (`visibility`, `dashboard_url`) live ON the `users` row itself, so there is no
separate settings table to repoint; the canonical row (id 10) keeps its own settings.

It is **idempotent** (re-running finds no `FROM_ID` references and is a no-op) and **guarded**
(the row-1 delete only fires when row 10 still exists; the whole thing runs in one transaction).

## 4. Pre-flight checks (run these first, read-only)

Confirm the two rows are the same person and inspect what will move:

```sh
# Both rows, same email?
wrangler d1 execute rankings-trade-prod --remote \
  --command "SELECT id, clerk_user_id, email, created_at FROM users WHERE id IN (1, 10);"

# How many references will be repointed (sanity check, non-zero only where expected):
wrangler d1 execute rankings-trade-prod --remote --command "
  SELECT 'agents' t, COUNT(*) n FROM agents WHERE owner_user_id = 1
  UNION ALL SELECT 'leagues', COUNT(*) FROM leagues WHERE owner_user_id = 1
  UNION ALL SELECT 'league_members', COUNT(*) FROM league_members WHERE added_by_user_id = 1
  UNION ALL SELECT 'league_invites', COUNT(*) FROM league_invites WHERE created_by_user_id = 1;"
```

## 5. Run the merge (authorized operator only)

```sh
# 1. Back up first (export prod D1).
wrangler d1 export rankings-trade-prod --remote --output users-merge-backup.sql

# 2. Apply the merge.
wrangler d1 execute rankings-trade-prod --remote --file scripts/ops/merge-users.sql

# 3. Verify: row 1 is gone, no dangling references to id 1 remain.
wrangler d1 execute rankings-trade-prod --remote \
  --command "SELECT COUNT(*) AS row1_remaining FROM users WHERE id = 1;"   # expect 0
```

## 6. Apply the email-uniqueness migration (after the merge)

Only once the merge is confirmed and no duplicate email remains:

```sh
bun run db:migrate            # local (wrangler dev) — applies 0019 with the rest
# or apply 0019 against prod via your standard migration path
```

If `0019` errors with a uniqueness violation, the merge has not fully completed — re-check step 5.
