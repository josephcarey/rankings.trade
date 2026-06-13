import { describe, expect, it } from "vitest";

import { safeRedirectTarget } from "./redirect";

describe("safeRedirectTarget", () => {
  it("allows a same-origin absolute path", () => {
    expect(safeRedirectTarget("/dashboard")).toBe("/dashboard");
  });

  it("preserves a query string on an allowed path", () => {
    expect(safeRedirectTarget("/profile?tab=settings")).toBe(
      "/profile?tab=settings",
    );
  });

  it("falls back to home when the target is missing", () => {
    expect(safeRedirectTarget(null)).toBe("/");
    expect(safeRedirectTarget("")).toBe("/");
  });

  it("rejects protocol-relative URLs (open redirect)", () => {
    expect(safeRedirectTarget("//evil.example.com")).toBe("/");
  });

  it("rejects absolute URLs to another origin", () => {
    expect(safeRedirectTarget("https://evil.example.com")).toBe("/");
  });

  it("rejects paths with a backslash or whitespace", () => {
    expect(safeRedirectTarget(String.raw`/\evil.example.com`)).toBe("/");
    expect(safeRedirectTarget("/path with space")).toBe("/");
  });

  it("rejects the sign-in route itself to avoid a redirect loop", () => {
    expect(safeRedirectTarget("/sign-in")).toBe("/");
    expect(safeRedirectTarget("/sign-in/sso-callback")).toBe("/");
    expect(safeRedirectTarget("/sign-in?redirect_url=/x")).toBe("/");
  });

  it("rejects the sign-up route itself to avoid a redirect loop", () => {
    expect(safeRedirectTarget("/sign-up")).toBe("/");
    expect(safeRedirectTarget("/sign-up/verify-email-address")).toBe("/");
    expect(safeRedirectTarget("/sign-up?redirect_url=/x")).toBe("/");
  });
});
