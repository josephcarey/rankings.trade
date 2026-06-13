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

describe("sign-up load", () => {
  it("hands a guest the sanitized fallback redirect without redirecting", async () => {
    const result = await run(
      { userId: null },
      "https://app.test/sign-up?redirect_url=/dashboard",
    );

    expect(result).toEqual({ redirectTo: "/dashboard" });
  });

  it("redirects an already-verified user to the intended destination", async () => {
    // A completed Clerk sign-up == authenticated locals on the verify route.
    try {
      await run(
        { userId: "user_123" },
        "https://app.test/sign-up/verify-email-address?redirect_url=/dashboard",
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
        "https://app.test/sign-up/verify-email-address?redirect_url=//evil.example.com",
      );
      expect.unreachable("expected a redirect to be thrown");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      if (isRedirect(error)) {
        expect(error.location).toBe("/");
      }
    }
  });

  it("leaves a guest on the verify route (no redirect)", async () => {
    const result = await run(
      { userId: null },
      "https://app.test/sign-up/verify-email-address",
    );

    expect(result).toEqual({ redirectTo: "/" });
  });
});
