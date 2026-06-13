/**
 * Secure generation and hashing of shareable league-invite link tokens.
 *
 * A token is an opaque `rtlnk_<base64url(32 CSPRNG bytes)>` string carried in the
 * shareable join URL. Only its SHA-256 hash is ever persisted (the raw token is
 * shown once, when the link is created or rotated); a short, non-secret `prefix`
 * is stored alongside for display/listing. Unlike a per-agent API token, an
 * invite link is reusable — many agents may join via the same secret until it is
 * revoked.
 *
 * Pure module — no database access. Uses the Web Crypto API (`crypto`), available
 * on the Cloudflare Workers runtime; Node's `crypto` is intentionally not used.
 * Mirrors `src/lib/agents/token.ts` so both secrets share one security approach.
 */

/** Human-recognizable scheme prefix every invite-link token carries. */
const TOKEN_SCHEME = "rtlnk_";

/** Number of random bytes in the secret body (256 bits of entropy). */
const TOKEN_BYTES = 32;

/** Characters of the secret body surfaced in the non-secret display prefix. */
const PREFIX_BODY_CHARS = 6;

/** A freshly generated invite token plus the values that get persisted. */
export type GeneratedInviteToken = {
  /** The full secret token — shown once, never stored. */
  token: string;
  /** SHA-256 hex digest of {@link GeneratedInviteToken.token}; the stored lookup key. */
  hash: string;
  /** Non-secret display fragment (`rtlnk_` + first chars of the body). */
  prefix: string;
};

/** Encode bytes as URL-safe base64 without padding. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Derive the non-secret display prefix for an invite token (scheme + first body
 * chars).
 */
export function inviteTokenPrefix(token: string): string {
  return token.slice(0, TOKEN_SCHEME.length + PREFIX_BODY_CHARS);
}

/**
 * Compute the stable SHA-256 hex digest of an invite token string.
 *
 * Equal inputs always produce the equal digest, so acceptance can match on the
 * stored `token_hash` directly by hashing the presented token.
 */
export async function hashInviteToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new invite-link token using a CSPRNG.
 *
 * @returns The raw token (to show once) plus its hash and display prefix.
 */
export async function generateInviteToken(): Promise<GeneratedInviteToken> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = TOKEN_SCHEME + base64url(bytes);
  const hash = await hashInviteToken(token);
  return { token, hash, prefix: inviteTokenPrefix(token) };
}
