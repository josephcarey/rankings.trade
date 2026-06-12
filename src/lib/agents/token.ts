/**
 * Secure generation and hashing of per-agent API tokens.
 *
 * A token is an opaque `rtbot_<base64url(32 CSPRNG bytes)>` string. Only its
 * SHA-256 hash is ever persisted (the raw token is shown to the user exactly
 * once); a short, non-secret `prefix` is stored alongside for display/listing.
 *
 * Pure module — no database access. Uses the Web Crypto API (`crypto`), which is
 * available on the Cloudflare Workers runtime; Node's `crypto` is intentionally
 * not used.
 */

/** Human-recognizable scheme prefix every agent token carries. */
const TOKEN_SCHEME = "rtbot_";

/** Number of random bytes in the secret body (256 bits of entropy). */
const TOKEN_BYTES = 32;

/** Characters of the secret body surfaced in the non-secret display prefix. */
const PREFIX_BODY_CHARS = 6;

/** A freshly generated token plus the values that get persisted. */
export type GeneratedToken = {
  /** The full secret token — shown once, never stored. */
  token: string;
  /** SHA-256 hex digest of {@link GeneratedToken.token}; the stored lookup key. */
  hash: string;
  /** Non-secret display fragment (`rtbot_` + first chars of the body). */
  prefix: string;
};

/** Encode bytes as URL-safe base64 without padding. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Derive the non-secret display prefix for a token (scheme + first body chars).
 */
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_SCHEME.length + PREFIX_BODY_CHARS);
}

/**
 * Compute the stable SHA-256 hex digest of a token string.
 *
 * Equal inputs always produce the equal digest, so lookups can match on the
 * stored `token_hash` directly.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new agent API token using a CSPRNG.
 *
 * @returns The raw token (to show once) plus its hash and display prefix.
 */
export async function generateToken(): Promise<GeneratedToken> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = TOKEN_SCHEME + base64url(bytes);
  const hash = await hashToken(token);
  return { token, hash, prefix: tokenPrefix(token) };
}
