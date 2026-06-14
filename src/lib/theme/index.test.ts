import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_MODE,
  injectThemeAttribute,
  isThemeMode,
  parseThemeMode,
  resolveAppliedTheme,
  THEME_COOKIE,
  themeCookieString,
} from "./index";

describe("isThemeMode", () => {
  it("accepts the three valid modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
  });

  it("rejects anything else", () => {
    const missing: undefined = undefined;
    expect(isThemeMode("System")).toBe(false);
    expect(isThemeMode("")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(missing)).toBe(false);
    expect(isThemeMode(1)).toBe(false);
  });
});

describe("parseThemeMode", () => {
  it("returns the mode when valid", () => {
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("system")).toBe("system");
  });

  it("falls back to the default for missing or invalid values", () => {
    const missing: undefined = undefined;
    expect(DEFAULT_THEME_MODE).toBe("system");
    expect(parseThemeMode(null)).toBe("system");
    expect(parseThemeMode(missing)).toBe("system");
    expect(parseThemeMode("")).toBe("system");
    expect(parseThemeMode("nonsense")).toBe("system");
    expect(parseThemeMode("DARK")).toBe("system");
  });
});

describe("resolveAppliedTheme", () => {
  it("honours explicit modes regardless of system preference", () => {
    expect(resolveAppliedTheme("light", true)).toBe("light");
    expect(resolveAppliedTheme("light", false)).toBe("light");
    expect(resolveAppliedTheme("dark", true)).toBe("dark");
    expect(resolveAppliedTheme("dark", false)).toBe("dark");
  });

  it("defers to system preference in system mode", () => {
    expect(resolveAppliedTheme("system", true)).toBe("dark");
    expect(resolveAppliedTheme("system", false)).toBe("light");
  });
});

describe("themeCookieString", () => {
  it("encodes the mode with site-wide, long-lived, lax attributes", () => {
    const cookie = themeCookieString("dark");
    expect(cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it("is not HttpOnly so the client can write it live", () => {
    expect(themeCookieString("light").toLowerCase()).not.toContain("httponly");
  });
});

describe("injectThemeAttribute (SSR, no FOUC)", () => {
  const html = '<html lang="en" data-theme="%theme%"><body></body></html>';

  it("replaces the placeholder with the resolved mode", () => {
    expect(injectThemeAttribute(html, "dark")).toContain('data-theme="dark"');
    expect(injectThemeAttribute(html, "light")).toContain('data-theme="light"');
    expect(injectThemeAttribute(html, "system")).toContain(
      'data-theme="system"',
    );
  });

  it("leaves no unresolved placeholder in the output", () => {
    expect(injectThemeAttribute(html, "dark")).not.toContain("%theme%");
  });
});
