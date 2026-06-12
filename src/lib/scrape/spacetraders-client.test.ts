import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "./spacetraders-client";

import { createSpaceTradersClient } from "./spacetraders-client";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function agent(symbol: string, credits: number, shipCount = 1, faction = "COSMIC") {
  return { symbol, credits, shipCount, startingFaction: faction };
}

function fullPage(prefix: string, base: number) {
  return Array.from({ length: 20 }, (_, i) => agent(`${prefix}-${i}`, base - i));
}

/**
 * Builds a fake `fetch` that serves a status body and a sequence of agent pages
 * (1-indexed by the `page` query param). Non-OK responses can be injected per slot.
 */
function fakeFetch(options: {
  status?: { body: unknown; ok?: boolean };
  pages?: Array<{ body: unknown; ok?: boolean }>;
}): FetchLike {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2" && !url.search) {
      const slot = options.status ?? { body: { resetDate: "2026-06-01" } };
      return jsonResponse(slot.body, slot.ok === false ? 500 : 200);
    }

    const page = Number(url.searchParams.get("page") ?? "1");
    const slot = options.pages?.[page - 1];
    if (!slot) {
      return jsonResponse({ data: [], meta: { total: 0 } });
    }
    return jsonResponse(slot.body, slot.ok === false ? 500 : 200);
  });
}

describe("createSpaceTradersClient.fetchStatus", () => {
  it("returns the resetDate from the status endpoint", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({ status: { body: { resetDate: "2026-06-01" } } }),
    });

    await expect(client.fetchStatus()).resolves.toEqual({
      resetDate: "2026-06-01",
    });
  });

  it("throws when the status request is not OK", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({ status: { body: {}, ok: false } }),
    });

    await expect(client.fetchStatus()).rejects.toThrow(/status request failed/);
  });

  it("throws when resetDate is missing", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({ status: { body: { version: "v2" } } }),
    });

    await expect(client.fetchStatus()).rejects.toThrow(/missing resetDate/);
  });

  it("throws when resetDate is an empty string", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({ status: { body: { resetDate: "" } } }),
    });

    await expect(client.fetchStatus()).rejects.toThrow(/missing resetDate/);
  });
});

describe("createSpaceTradersClient.fetchAllAgents", () => {
  it("maps symbol, credits, shipCount and faction from a single short page", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({
        pages: [
          {
            body: {
              data: [agent("A", 100, 3, "VOID"), agent("B", 200, 5, "QUANTUM")],
              meta: { total: 2 },
            },
          },
        ],
      }),
    });

    const agents = await client.fetchAllAgents();

    expect(agents).toEqual([
      { symbol: "B", credits: 200, shipCount: 5, faction: "QUANTUM" },
      { symbol: "A", credits: 100, shipCount: 3, faction: "VOID" },
    ]);
  });

  it("sorts by credits desc then symbol asc for ties", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({
        pages: [
          {
            body: {
              data: [agent("ZZZ", 500), agent("AAA", 500), agent("MMM", 900)],
              meta: { total: 3 },
            },
          },
        ],
      }),
    });

    const agents = await client.fetchAllAgents();
    const symbols = agents.map((a) => a.symbol);
    expect(symbols).toEqual(["MMM", "AAA", "ZZZ"]);
  });

  it("paginates until a short final page is reached", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({
        pages: [
          { body: { data: fullPage("P1", 1000), meta: { total: 25 } } },
          {
            body: {
              data: [agent("P2-A", 10), agent("P2-B", 5)],
              meta: { total: 25 },
            },
          },
        ],
      }),
    });

    const agents = await client.fetchAllAgents();
    expect(agents).toHaveLength(22);
  });

  it("stops paginating once meta.total is reached on full pages", async () => {
    const fetch = fakeFetch({
      pages: [
        { body: { data: fullPage("A", 2000), meta: { total: 40 } } },
        { body: { data: fullPage("B", 1000), meta: { total: 40 } } },
        { body: { data: fullPage("C", 500), meta: { total: 40 } } },
      ],
    });
    const client = createSpaceTradersClient({ fetch });

    const agents = await client.fetchAllAgents();

    expect(agents).toHaveLength(40);
    // Only two pages should have been requested (the third is never reached).
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-OK agents page without returning a partial list", async () => {
    const client = createSpaceTradersClient({
      fetch: fakeFetch({
        pages: [{ body: {}, ok: false }],
      }),
    });

    await expect(client.fetchAllAgents()).rejects.toThrow(
      /agents request failed/,
    );
  });
});
