import { isRedirect } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";

import { load } from "./+page.server";

type Locals = { userId: string | null };

function run(locals: Locals, urlString: string) {
  return load({
    locals,
    url: new URL(urlString),
  } as Parameters<typeof load>[0]);
}

describe("sign-in load", () => {
  it("hands a guest the sanitized fallback redirect without redirecting", async () => {
    const result = await run(
      { userId: null },
      "https://app.test/sign-in?redirect_url=/dashboard",
    );

    expect(result).toEqual({ redirectTo: "/dashboard" });
  });

  it("redirects an already-verified user to the intended destination", async () => {
    // A faked Clerk verification == authenticated locals on the callback route.
    try {
      await run(
        { userId: "user_123" },
        "https://app.test/sign-in/sso-callback?redirect_url=/dashboard",
      );
      expect.unreachable("expected a redirect to be thrown");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (isRedirect(error)) {
        expect(error.status).toBe(303);
        expect(error.location).toBe("/dashboard");
      }
    }
  });

  it("redirects a verified user to home when the target is an open redirect", async () => {
    try {
      await run(
        { userId: "user_123" },
        "https://app.test/sign-in/sso-callback?redirect_url=//evil.example.com",
      );
      expect.unreachable("expected a redirect to be thrown");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (isRedirect(error)) {
        expect(error.location).toBe("/");
      }
    }
  });

  it("leaves a guest on the callback route (no redirect)", async () => {
    const result = await run(
      { userId: null },
      "https://app.test/sign-in/sso-callback",
    );

    expect(result).toEqual({ redirectTo: "/" });
  });
});
