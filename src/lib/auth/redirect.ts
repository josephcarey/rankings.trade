const HOME = "/";
const AUTH_PATHS = ["/sign-in", "/sign-up"] as const;

/**
 * Resolves a post-authentication redirect target to a safe, same-origin
 * relative path.
 *
 * Guards against open redirects: only a same-origin absolute path is allowed
 * (exactly one leading `/`, never a protocol-relative `//` or a path containing
 * a backslash or whitespace that browsers can treat as a scheme/host
 * separator). The sign-in and sign-up routes are rejected to avoid a
 * post-login redirect loop. Anything invalid falls back to the home page.
 *
 * @param raw - The candidate target, e.g. a `redirect_url` query param.
 * @returns A safe relative path beginning with `/`.
 */
export function safeRedirectTarget(raw: string | null | undefined): string {
  if (!raw) {
    return HOME;
  }

  // Must be a same-origin absolute path: exactly one leading slash.
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return HOME;
  }

  // Reject backslashes / whitespace / control chars that can confuse URL parsing.
  if (/[\s\\]/.test(raw)) {
    return HOME;
  }

  // Reject the auth routes themselves to prevent a post-login redirect loop.
  const separatorIndex = raw.search(/[#?]/);
  const path = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return HOME;
  }

  return raw;
}
