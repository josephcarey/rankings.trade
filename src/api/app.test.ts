import { describe, expect, it } from "vitest";

import { api } from "./app";

describe("api", () => {
  it("returns health status", async () => {
    const response = await api.request("/api/health");

    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.status).toBe(200);
  });
});
