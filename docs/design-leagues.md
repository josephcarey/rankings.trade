# Epic E design — Leagues, membership & invites

Locked design for Epic E. Decomposed into cards E1–E13 (E12 deferred). This document
ratifies the schema, the visibility model, temporal membership, invite semantics, and the
authorization rules so the implementation cards can proceed without re-litigating them.

## 1. Data model

### `leagues`

| column          | type     | notes                                                        |
| --------------- | -------- | ------------------------------------------------------------ |
| `id`            | INTEGER  | PK AUTOINCREMENT                                             |
| `name`          | TEXT     | NOT NULL, 1–80 chars (CHECK)                                 |
| `description`   | TEXT     | NULL — optional (e.g. to frame an opt-in challenge)         |
| `visibility`    | TEXT     | NOT NULL DEFAULT `'private'`, CHECK IN (`'private'`,`'public'`) |
| `owner_user_id` | INTEGER  | NOT NULL REFERENCES `users(id)` — the creating user          |
| `created_at`    | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP                          |
| `updated_at`    | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP                          |

Private by default. `owner_user_id` is the local `users.id` (not the Clerk id).

### `league_members` (temporal)

| column             | type     | notes                                                   |
| ------------------ | -------- | ------------------------------------------------------- |
| `id`               | INTEGER  | PK AUTOINCREMENT                                        |
| `league_id`        | INTEGER  | NOT NULL REFERENCES `leagues(id)`                       |
| `agent_id`         | INTEGER  | NOT NULL REFERENCES `agents(id)` — the participant      |
| `added_by_user_id` | INTEGER  | NULL REFERENCES `users(id)` — owner/admin, or self (invite) |
| `joined_at`        | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP                     |
| `left_at`          | DATETIME | NULL — NULL means an **active** membership              |

- **Temporal, never destructive.** Leaving sets `left_at = CURRENT_TIMESTAMP`; rows are
  never deleted. This lets a future round finalization (Epic G) freeze exactly which
  agents were active at finalization time, so archived rounds never get rewritten when an
  agent later joins or leaves.
- **Membership is by agent, not user.** Participants are agents (the competing entity).
  Agents may be **unclaimed** (`agents.owner_user_id IS NULL`), so membership must not
  require an owner.
- **Constraints:**
  - Partial unique index `(league_id, agent_id) WHERE left_at IS NULL` — at most one
    active membership per agent per league, while still allowing a full join/leave/re-join
    history (multiple rows with non-null `left_at`).
  - `CHECK (left_at IS NULL OR left_at >= joined_at)`.
- The same `agent_id` may be active in many different leagues simultaneously.

### `league_invites` (shareable join links)

| column               | type     | notes                                                |
| -------------------- | -------- | ---------------------------------------------------- |
| `id`                 | INTEGER  | PK AUTOINCREMENT                                    |
| `league_id`          | INTEGER  | NOT NULL REFERENCES `leagues(id)`                   |
| `token_hash`         | TEXT     | NOT NULL UNIQUE — SHA-256 hex of the secret token    |
| `token_prefix`       | TEXT     | NOT NULL — non-secret display fragment               |
| `created_by_user_id` | INTEGER  | NOT NULL REFERENCES `users(id)`                      |
| `revoked_at`         | DATETIME | NULL — NULL means an **active** link                 |
| `created_at`         | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP                  |

- **Reusable:** one active link lets many agents join until it is revoked. This is the key
  difference from Epic C's one-secret-per-token agent tokens.
- **Revoke:** set `revoked_at`; the link's URL stops working immediately. Existing members
  are unaffected.
- **Rotate:** atomically revoke the current active link and create a new one (so the old
  URL dies and a fresh URL is issued).
- **Token security (reuses the Epic C pattern, see `src/lib/agents/token.ts`):** the raw
  token is a CSPRNG secret carried in the shareable URL and shown once; only its SHA-256
  hash is stored. Acceptance hashes the presented token and looks up an **active** invite
  by hash. `token_prefix` is display/diagnostic only and never used for authorization.

### Indexes

- `idx_league_members_league` on `(league_id)`.
- `idx_league_members_agent` on `(agent_id)` (membership lookups for visibility checks).
- partial unique `(league_id, agent_id) WHERE left_at IS NULL`.
- `idx_league_invites_league` on `(league_id)`.
- UNIQUE on `league_invites.token_hash` (lookup key).

## 2. Foreign-key / lifecycle assumptions

- v1 has **no physical user or agent deletion** (agents are only ever claimed/transferred;
  users are Clerk-provisioned and not removed). FKs are therefore plain references with
  **no cascade**. If deletion is introduced later, a follow-up migration must choose
  explicit `ON DELETE` behavior; nothing here assumes cascade.
- **League ownership transfer is out of scope for v1.** A league always belongs to its
  creator. (Admins can manage any league via the env allowlist, so there is no operational
  need to reassign `owner_user_id` in v1.)

## 3. Adding participants — two paths

1. **Owner/admin direct add** — add any agent to the league by callsign. If the callsign
   has no `agents` row yet, an **unclaimed** agent row is auto-created (reusing the agent
   normalization/validation in `src/lib/db/agents.ts`). This same mechanism is what a
   future starter-league seed (E12) reuses.
2. **Invite acceptance** — a signed-in user holding a valid (active, non-revoked) link
   picks one of **their own claimed agents** and joins it to the league.

## 4. Authorization & visibility matrix

`isAdmin(clerkUserId, env)` (Epic C env allowlist) grants admin powers over every league.
Ownership compares the local `users.id` against `leagues.owner_user_id`.

| Operation                                    | Who may perform it                                   |
| -------------------------------------------- | ---------------------------------------------------- |
| Create league                                | Any signed-in user (becomes owner)                   |
| View **public** league                       | Anyone (including anonymous)                         |
| View **private** league                      | Owner, admin, or a user who owns an **active member agent** |
| Rename / set description / set visibility    | Owner or admin                                       |
| Add / remove participant                     | Owner or admin                                       |
| Create / revoke / rotate invite              | Owner or admin                                       |
| Accept invite (join an owned agent)          | Any signed-in user with ≥1 owned agent + a valid link |

- **IDOR-safety:** every mutating service operation is scoped by league ownership; acting
  on a league you neither own nor admin fails. Unauthorized access to a **private** league
  returns a not-found-style result (no "this private league exists" existence leak).
- **Unclaimed-agent visibility implication (explicit):** because private-league read
  access is "owns an active member agent", if an owner adds an unclaimed callsign and a
  user **later claims** that agent, that user gains member visibility of the league. This
  is intended and consistent with the scope ("unclaimed agents can be participants").

## 5. Routing & guard model

- `/leagues` is **not** added to `AUTHED_PREFIXES` in `src/lib/auth/guard.ts`. The prefix
  guard is all-or-nothing, and public leagues plus the public join route must be reachable
  unauthenticated. Instead each `+page.server.ts` `load`/action enforces auth and
  owner-or-admin itself via `locals.user` / `isAdmin()`.
- Routes (SvelteKit form actions; no Hono JSON API for leagues in v1):
  - `/leagues` — list (own/public) + create.
  - `/leagues/[id]` — detail + owner/admin management (rename, description, visibility,
    participants, invites).
  - `/leagues/join/[token]` — public accept page; reachable unauthenticated (prompts
    sign-in), the accept action requires sign-in + an owned-agent selection.

## 6. Accept-flow edge semantics

- Accepting with an already-**active** agent → idempotent success (no duplicate row;
  enforced by the partial unique index and a pre-check).
- Accepting an agent that **previously left** → opens a new membership interval.
- Accepting via a **revoked/unknown** token → typed failure (friendly error in the UI).
- Reusable: a single active link admits many agents until revoked.

## 7. Migration plan

- `migrations/0004_leagues.sql` — the three tables + indexes above (this epic).
- `migrations/0005_*` — **reserved** for the deferred starter-league seed (E12); not
  consumed by this epic's PR.
