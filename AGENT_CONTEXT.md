# Card #18 — Secure agent API token generation + hashing

## Summary
Added `src/lib/agents/token.ts`, a pure module that generates per-agent API
tokens with a CSPRNG and derives their stored hash and display prefix. No DB.

## What changed
- `generateToken()` → `{ token, hash, prefix }`:
  - `token = "rtbot_" + base64url(32 random bytes)` from `crypto.getRandomValues`.
  - `hash` = SHA-256 hex digest (via `crypto.subtle.digest`).
  - `prefix` = `rtbot_` + first 6 body chars (non-secret, for listing).
- `hashToken(token)` → stable SHA-256 hex digest for lookups.
- `tokenPrefix(token)` → display prefix.

## Key decisions
- Web Crypto only (`crypto.getRandomValues` / `crypto.subtle`); Node `crypto` avoided
  so it runs on the Cloudflare Workers runtime.
- SHA-256 (not bcrypt) — the secret is full-entropy random; the stored hash is the
  UNIQUE indexed lookup key (`agent_tokens.token_hash`), so lookup is exact-match.
- The raw token never leaves the caller except as the one-time return value; only
  hash + prefix are intended for persistence/logging.

## Evidence
- `bun run ci` → green; `src/lib/agents/token.ts` 100% coverage.
- Tests cover format, hash↔token consistency, uniqueness across 200 generations,
  hash stability/difference, and prefix derivation.

## Notes for downstream
- Unblocks #19 (token persistence) and #22 (bot middleware), which call `hashToken`
  to look tokens up by their stored hash, and #21, which calls `generateToken`.
