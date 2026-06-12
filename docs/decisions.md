# Resolved design decisions

The brief flagged several values as "early design cards." These were resolved with the
stakeholder on 2026-06-11. Implementation epics inherit these as locked inputs.

## DEC-1 — Glicko-2 system constants & tie policy → Epics G, H

- Baseline **1500** / RD **350** / σ **0.06**.
- **One rating period per finalized round.**
- **Equal credits → draw.**
- Tuned for infrequent rounds: RD inflation between rare rounds is the primary
  "long gap → bigger swing" mechanism. Additionally bump the system constant **τ from 0.5 → 0.6**
  for slightly more reactivity to upsets, and expose an **RD floor** so established players don't
  freeze between rounds.
- **All constants live in one editable config module.** Recalibrate after the first live season
  with real data.

## DEC-2 — Title ladder → Epics I, J

- Brief's ladder (tier names, fixed lower-tier rating thresholds, elite percentile bands +
  absolute min-rating gate) plus an established-rating floor (RD / min-rounds).
- **Ladder, thresholds, percentile bands, and floor live in a single easy-to-edit config file**
  so tiers are tweakable without code changes.

## DEC-3 — Unranked gap between seasons → Epic I, G3

- Default unranked gap = **0**; admin-configurable.

## DEC-4 — Default milestone enum → Epic F3

- Seed the six default milestone types (`first-jump`, `first-ship`, `fleet-size-10`,
  `credits-1M`, `credits-10M`, `system-charted`); leagues may extend with custom types.

## DEC-5 — Archived-round history → Epics J, K (+ new card D4)

- **Keep raw snapshots and make them viewable.**
- **New card D4 — snapshot retention/compaction:** after a round finalizes, downsample its 15-min
  series to a bounded long-term shape (≈ one point per few hours/day) + the frozen final standing,
  so long-term storage stays flat; the live/active round keeps full resolution for graphs. The
  schema is designed so compaction is non-destructive.

## DEC-6 — Legacy ratings → Epic K

- **Recompute ratings from genesis** over imported rounds into an archived **"Season 0"**, then
  **reset to baseline** for the live season (continuity without a launch head-start).

## DEC-7 — Clerk app / magic-link config → Epic B1

- **New Clerk app** for rankings.trade (own user pool + keys); operational setup only, no
  architectural impact. Clerk keys are handed over at card B1.

## Pre-accepted (no decision card)

- Registering an agent not yet in the scrape is **allowed** — it simply has no snapshots until it
  appears publicly. Baked into card C1's acceptance criteria.

---

# Epic C — Agents & per-agent API tokens (design lock, card #16)

Locked with the stakeholder before implementing Epic C. Cards #17–#23 inherit these as
fixed inputs. A rubber-duck critique of the token crypto and the transfer/revocation flow
was run during planning; its findings are folded into the decisions below.

## DEC-C1 — Admin identification

- Admins are identified by an **env allowlist**: `ADMIN_CLERK_USER_IDS`, a comma-separated
  list of Clerk user IDs. A helper `isAdmin(clerkUserId, env)` returns true iff the id is in
  the (trimmed, non-empty) list. Empty/unset ⇒ nobody is admin.
- No role table and no role-management UI in v1. The var is added to `CloudflareBindings`
  and documented in the env example; it holds IDs, not secrets.

## DEC-C2 — Admin transfer surface

- The ownership-transfer escape hatch is an **admin-only API endpoint plus a minimal
  SvelteKit form action**. No dedicated `/admin` page in v1 (disputes are rare and handled
  manually per the brief's trust model).

## DEC-C3 — Token format, storage, and lifecycle

- Token string: `rtbot_` + `base64url(32 random bytes)` from a **CSPRNG** (Web Crypto
  `crypto.getRandomValues`; the Workers runtime has no Node `crypto`).
- Stored as a **SHA-256 hex digest** in `agent_tokens.token_hash` with a **UNIQUE** index for
  O(1) lookup. SHA-256 (not bcrypt) is appropriate because the secret is full-entropy random,
  not a human password; the unique-hash equality lookup also sidesteps timing concerns.
- A non-secret `token_prefix` (`rtbot_` + first 6 chars) is stored for display/identification.
- The raw token is **shown exactly once** at creation and never persisted or logged.
- **Rotate** = revoke the selected token and issue exactly one replacement carrying the same
  label, returned once. **Revoke** sets `revoked_at`; a revoked token never authenticates.

## DEC-C4 — Data model

- `agents`: `id`, `symbol` (UNIQUE, normalized uppercase, `^[A-Z0-9_-]{3,20}$`),
  `display_name` (NULL), `owner_user_id` (**NULL** → unclaimed scraped participants allowed),
  `verified` (INTEGER, default 0 — claims are "unverified" in v1), `created_at`, `updated_at`.
- `agent_tokens`: `id`, `agent_id`, `owner_user_id` (**creation-time owner snapshot** so a
  transfer can revoke exactly the prior owner's tokens), `token_hash` (UNIQUE), `token_prefix`,
  `label`, `last_used_at` (NULL), `revoked_at` (NULL), `created_at`.
- `agent_ownership_events` (audit): `id`, `agent_id`, `event_type`
  (`claim` | `transfer` | `admin_release`), `actor_user_id` (NULL), `prior_owner_user_id`
  (NULL), `new_owner_user_id` (NULL), `reason` (NULL), `created_at`.

## DEC-C5 — Invariants & concurrency (from the rubber-duck critique)

- **One active owner per agent**, enforced atomically at the DB, not only in app code:
  claim is `UPDATE agents SET owner_user_id = ? WHERE symbol = ? AND owner_user_id IS NULL`
  (creating the row first if the symbol is unseen). A claim that affects 0 rows on an
  already-owned symbol resolves to an "already claimed" outcome — never a silent overwrite.
- **Transfer is transactional**: setting the new owner, revoking the **prior** owner's active
  tokens (`owner_user_id = priorOwner`), and writing the audit event happen together. The new
  owner's own (post-transfer) tokens are never caught by the revocation because revocation is
  scoped to the prior owner's snapshot.
- **`last_used_at` write throttling**: the bot middleware updates `last_used_at` only when the
  stored value is older than ~10 minutes, avoiding a per-request write hotspot.
- Rate limiting and request body-size caps remain in **Epic F** (out of Epic C scope).
