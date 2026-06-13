import { isRedirect } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";

import { requireAuthHandle, requiresAuth, signInRedirect } from "./guard";

function makeArgs(userId: string | null, pathname: string, search = "") {
  const resolve = vi.fn(async () => new Response("ok"));
  const event = {
    locals: { userId },
    url: new URL(`https://app.test${pathname}${search}`),
  } as Parameters<typeof requireAuthHandle>[0]["event"];

  return { args: { event, resolve } as never, resolve };
}

describe("requiresAuth", () => {
  it("protects the settings root and its subpaths", () => {
    expect(requiresAuth("/settings")).toBe(true);
    expect(requiresAuth("/settings/")).toBe(true);
    expect(requiresAuth("/settings/profile")).toBe(true);
  });

  it("protects the agents root and its subpaths", () => {
    expect(requiresAuth("/agents")).toBe(true);
    expect(requiresAuth("/agents/")).toBe(true);
    expect(requiresAuth("/agents/RANKBOT")).toBe(true);
  });

  it("protects the admin root and its subpaths", () => {
    expect(requiresAuth("/admin")).toBe(true);
    expect(requiresAuth("/admin/")).toBe(true);
    expect(requiresAuth("/admin/agents/RANKBOT")).toBe(true);
  });

  it.each([
    "/",
    "/leaderboard",
    "/u/ada",
    "/sign-in",
    "/sign-in/sso-callback",
    "/api/me",
    "/rules",
    "/rules/",
    "/rules/leagues",
  ])("treats %s as public", (pathname) => {
    expect(requiresAuth(pathname)).toBe(false);
  });

  it("keeps the rules/help pages public so logged-out visitors can read them", () => {
    expect(requiresAuth("/rules")).toBe(false);
    expect(requiresAuth("/rules/ratings")).toBe(false);
  });

  it("does not match a path that merely shares the prefix string", () => {
    expect(requiresAuth("/settings-export")).toBe(false);
  });
});

describe("signInRedirect", () => {
  it("encodes the destination pathname as redirect_url", () => {
    expect(signInRedirect("/settings")).toBe(
      "/sign-in?redirect_url=%2Fsettings",
    );
  });

  it("preserves and encodes the query string", () => {
    expect(signInRedirect("/settings", "?tab=profile")).toBe(
      "/sign-in?redirect_url=%2Fsettings%3Ftab%3Dprofile",
    );
  });
});

describe("requireAuthHandle", () => {
  it("redirects a signed-out request for an authed path, preserving the destination", async () => {
    const { args, resolve } = makeArgs(null, "/settings", "?tab=profile");

    try {
      await requireAuthHandle(args);
      expect.unreachable("expected a redirect");
    } catch (error) {
      if (!isRedirect(error)) throw error;
      expect(error.status).toBe(302);
      expect(error.location).toBe(
        "/sign-in?redirect_url=%2Fsettings%3Ftab%3Dprofile",
      );
    }

    expect(resolve).not.toHaveBeenCalled();
  });

  it("lets a signed-in request through to an authed path", async () => {
    const { args, resolve } = makeArgs("user_1", "/settings");

    await requireAuthHandle(args);

    expect(resolve).toHaveBeenCalledOnce();
  });

  it("lets a signed-out request through to a public path", async () => {
    const { args, resolve } = makeArgs(null, "/leaderboard");

    await requireAuthHandle(args);

    expect(resolve).toHaveBeenCalledOnce();
  });

  it("lets a signed-out request through to a rules/help page", async () => {
    const { args, resolve } = makeArgs(null, "/rules/leagues");

    await requireAuthHandle(args);

    expect(resolve).toHaveBeenCalledOnce();
  });
});
