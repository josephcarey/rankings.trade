# AGENT_CONTEXT — Card #22 (C7): bot token-auth middleware

## Scope
Authenticate bot requests via a per-agent Bearer token (a distinct, bot-only
path — a Clerk session does NOT satisfy it) and expose the resolved agent to
handlers. Wired to a real `/api/bot/*` route group.

## Files
- `src/api/bot-auth.ts`:
  - `parseBearer(header)` — extracts the token from `Authorization: Bearer <t>`.
  - `shouldRefreshLastUsed(lastUsedAt, now, thresholdMs=10min)` — throttle predicate.
  - `createRequireAgentToken({ now? })` — middleware factory (clock injectable);
    parses bearer → `hashToken` (C3) → `findActiveTokenByHash` (C4) →
    `getAgentById`; 401 on missing/malformed/unknown/revoked; on success sets
    `agent` + `token` context vars and touches `last_used_at` only when stale.
  - `requireAgentToken` — default wall-clock middleware.
- `src/api/bot.ts` — `createBotApi()`: `requireAgentToken` + `GET /whoami` echoing
  the authenticated agent (representative end-to-end protected endpoint).
- `src/api/app.ts` — mounts `api.route("/bot", createBotApi())`.

## Decisions
- 401s use the studio error envelope (`{ error: { code, message } }`).
- `last_used_at` write throttled to >=10 min staleness (null/unparseable → write)
  to avoid per-request write amplification. SQLite UTC timestamp parsed as
  `YYYY-MM-DDTHH:MM:SSZ`.
- Rate limiting / body-size caps remain Epic F (out of scope).

## Tests (`src/api/bot-auth.test.ts`, 20)
- parseBearer matrix (null/empty/wrong-scheme/"Bearer "/valid/trimmed).
- shouldRefreshLastUsed: never-used, stale, within-window, exact boundary,
  unparseable.
- Middleware: no header / malformed / unknown / revoked → 401; valid → 200 with
  agent on context; recent token NOT rewritten (throttle); stale token rewritten.

## Evidence
- `bun run ci` -> green. svelte-check 0 errors (2 pre-existing benign warnings).
  27 test files, 234 tests passing.
- Coverage: All files 95.5% lines / 85.26% branch (>=80% floor held).
