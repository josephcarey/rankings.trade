/**
 * Theme mode resolution and cookie helpers.
 *
 * The site supports three user-selectable theme modes: `light`, `dark`, and
 * `system` (the default — follows the OS/browser `prefers-color-scheme`). The
 * choice is persisted in a cookie so it can be read during SSR and applied to
 * the server-rendered `<html data-theme>` attribute, avoiding a flash of the
 * wrong theme (FOUC) on first paint.
 *
 * Everything here is pure so the mode/cookie logic is unit-testable without a
 * browser or a live request.
 */

/** A theme mode a user may choose. `system` defers to `prefers-color-scheme`. */
export type ThemeMode = "light" | "dark" | "system";

/** The concrete theme actually painted once `system` is resolved. */
export type AppliedTheme = "light" | "dark";

/** The cookie name carrying the persisted {@link ThemeMode}. */
export const THEME_COOKIE = "theme";

/** Default mode when nothing is persisted: follow the OS/browser preference. */
export const DEFAULT_THEME_MODE: ThemeMode = "system";

/** One year, in seconds — the cookie's `Max-Age`. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

/** Type guard: true when `value` is a valid {@link ThemeMode}. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" && (THEME_MODES as readonly string[]).includes(value)
  );
}

/**
 * Coerce an arbitrary cookie value into a {@link ThemeMode}.
 *
 * Missing, empty, or unrecognised values fall back to {@link DEFAULT_THEME_MODE}
 * so a tampered or stale cookie can never break rendering.
 */
export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

/**
 * Resolve a mode to the concrete theme to paint.
 *
 * `system` defers to `systemPrefersDark` (the caller supplies it from the media
 * query on the client; on the server it's unknown, so `system` is rendered as
 * the literal `data-theme="system"` and the CSS media query decides).
 */
export function resolveAppliedTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): AppliedTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Build the `document.cookie` assignment string for persisting `mode` from the
 * client. `SameSite=Lax`, site-wide `Path=/`, ~1 year, and intentionally not
 * `HttpOnly` so the client toggle can write it live without a round-trip.
 */
export function themeCookieString(mode: ThemeMode): string {
  return `${THEME_COOKIE}=${mode}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * The literal `app.html` placeholder the SSR hook rewrites with the resolved
 * mode so the server-rendered `<html>` already carries `data-theme`.
 */
const THEME_PLACEHOLDER = 'data-theme="%theme%"';

/**
 * Replace the {@link THEME_PLACEHOLDER} in a rendered HTML chunk with the
 * persisted mode, so first paint matches the user's choice (no FOUC).
 */
export function injectThemeAttribute(html: string, mode: ThemeMode): string {
  return html.replace(THEME_PLACEHOLDER, `data-theme="${mode}"`);
}

/**
 * Apply a chosen mode on the client: set `data-theme` on `<html>` for an
 * immediate, flash-free switch and persist it to the cookie so SSR paints the
 * same theme on the next load.
 */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  // eslint-disable-next-line unicorn/no-document-cookie -- deliberate single client-side write of the (non-HttpOnly) theme cookie
  document.cookie = themeCookieString(mode);
}
