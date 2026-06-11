import { describe, expect, it, vi } from "vitest";

import { handle } from "./hooks.server";

describe("handle", () => {
  it("routes API requests through Hono", async () => {
    const request = new Request("https://rankings.trade/api/health");
    const resolve = vi.fn(() => new Response("SvelteKit route"));

    const response = await handle({
      event: {
        platform: { env: { DB: {} as D1Database } },
        request,
        url: new URL(request.url),
      } as Parameters<typeof handle>[0]["event"],
      resolve,
    });

    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("lets SvelteKit handle non-API requests", async () => {
    const request = new Request("https://rankings.trade/");
    const expectedResponse = new Response("SvelteKit route");
    const resolve = vi.fn(() => expectedResponse);

    const response = await handle({
      event: {
        request,
        url: new URL(request.url),
      } as Parameters<typeof handle>[0]["event"],
      resolve,
    });

    expect(response).toBe(expectedResponse);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
