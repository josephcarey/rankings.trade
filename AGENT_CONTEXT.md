# Implementation Summary: Card #6 — feat: add users schema and migration

## What was built

### Migration `0002_users.sql`
Forward-only, append-only SQL migration that creates the `users` table with:
- `clerk_user_id TEXT NOT NULL UNIQUE` — primary key used throughout the app
- `email TEXT NULL`, `display_name TEXT NULL` — optional profile fields
- `visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))` — stored for later Epic J filtering
- `dashboard_url TEXT NULL CHECK (dashboard_url IS NULL OR LENGTH(dashboard_url) <= 2048)` — bounded-length URL
- `created_at / updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`

### Typed query helpers `src/lib/db/users.ts`
Three exported async functions keyed on `clerk_user_id`:

| Helper | Purpose |
|---|---|
| `getUserByClerkId(db, clerkUserId)` | Point-lookup; returns `User \| null` |
| `upsertUser(db, input)` | Insert-or-update via `ON CONFLICT DO UPDATE`; returns the resulting row |
| `updateUserProfile(db, clerkUserId, input)` | Partial-update of display_name / visibility / dashboard_url; missing fields retain DB values; returns `User \| null` |

Exported types: `User`, `Visibility`, `UpsertUserInput`, `UpdateProfileInput`.

## Key decisions made

1. **`ON CONFLICT DO UPDATE` for upsert** — Standard SQLite upsert syntax (supported since 3.24.0). Avoids a separate SELECT before every write; a follow-up SELECT retrieves the final row.

2. **Separate SELECT for return value** — Rather than `RETURNING *`, a second `getUserByClerkId` call was used. The existing test adapter's `exec()` path works cleanly for SELECT; this avoids any ambiguity in the adapter.

3. **Merge semantics for `updateUserProfile`** — A GET → merge → UPDATE pattern handles partial updates without dynamic SQL string building (which security linting flags). Fields absent from the input object keep their current DB values; fields explicitly set to `null` write NULL.

4. **`Visibility` as a named exported type** — Ensures Epic J callers get a first-class type for `"public" | "private"` rather than inlining the literal union everywhere.

5. **Forward-only migration** — The file only appends a new `CREATE TABLE` statement; the existing `_migrations` bookkeeping table from `0001_init.sql` tracks its application.

## Files changed

| File | Change |
|---|---|
| `migrations/0002_users.sql` | New — `users` table schema |
| `src/lib/db/users.ts` | New — typed query helpers and exported types |
| `src/lib/db/users.test.ts` | New — 21 unit tests |

No existing files were modified.

## Tests written

**`src/lib/db/users.test.ts`** — 21 tests across three `describe` blocks, using an in-memory sql.js adapter (same pattern as `migrate.test.ts`):

### `getUserByClerkId` (4 tests)
- Returns `null` for a non-existent user
- Returns the user record when it exists
- Exposes the `visibility` field (Epic J ready)
- Returns `null` for a different clerk_user_id

### `upsertUser` (9 tests)
- Creates a new user with all provided fields
- Defaults `visibility` to `'public'` when not provided
- Defaults nullable fields to `null` when not provided
- Updates an existing user on a second call (idempotency)
- Does not create duplicate records on repeated upserts (uniqueness)
- Enforces `clerk_user_id UNIQUE` on raw INSERT
- Enforces the `visibility CHECK` constraint
- Enforces the `dashboard_url LENGTH` CHECK constraint (> 2048 chars)
- Accepts a dashboard_url of exactly 2048 characters

### `updateUserProfile` (8 tests)
- Returns `null` for a non-existent user
- Updates `display_name`
- Updates `visibility`
- Updates `dashboard_url`
- Sets `dashboard_url` to null explicitly
- Leaves unspecified fields unchanged
- Leaves all fields unchanged when input is empty
- Enforces the `visibility CHECK` constraint on update
- Enforces the `dashboard_url LENGTH` CHECK on update

**Coverage:** 94.73% lines / 91.66% branches on `users.ts` (100% functions).
**Overall suite:** 46 tests, 7 files — all passing. `bun run ci` green.

## Issues encountered

**Context-file write blocked by workspace security policy**
The agent's sandbox denies writes to paths outside the worktree root
(`/Users/josephcarey/rankings.trade/.trellis/worktrees/6`). The requested
context-save path `/Users/josephcarey/rankings.trade/.agent-contexts/6.md`
is outside the workspace and could not be written. This summary was written to
`AGENT_CONTEXT.md` within the worktree as a fallback; the orchestrator should
copy or move it.

**ESLint fixes (minor, all resolved)**
- Merged duplicate `./users` imports (`import type` + `import` → single `import { ..., type Visibility }`)
- Sorted class methods alphabetically (`all` before `bind` per `perfectionist/sort-classes`)
- Inverted a `!== undefined` ternary to satisfy `unicorn/no-negated-condition`

sql.js 1.14.1 (SQLite 3.49.1) correctly enforces all CHECK constraints
(visibility and dashboard_url length) during tests.
