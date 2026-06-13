import { describe, expect, it } from "vitest";

import { load } from "./+page";

/** Invokes the universal (synchronous) load with a given slug param. */
const run = (slug: string) => load({ params: { slug } } as never);

describe("rules/[slug] load", () => {
  it("returns serializable topic metadata for a known slug", () => {
    const result = run("about") as { topic: Record<string, unknown> };

    expect(result.topic.slug).toBe("about");
    expect(result.topic.title).toBeTruthy();
    expect(result.topic.summary).toBeTruthy();
  });

  it("throws a 404 for an unknown slug", () => {
    expect(() => run("does-not-exist")).toThrow();

    try {
      run("does-not-exist");
      expect.unreachable("expected a 404");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
