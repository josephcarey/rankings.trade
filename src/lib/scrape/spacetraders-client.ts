/**
 * SpaceTraders API client — the read boundary for the scrape (Epic D, card #17).
 *
 * A faithful port of the legacy `fetchAllAgents` + status logic, with `fetch` injected so
 * tests never touch the network. Two deliberate differences from the legacy worker:
 *   - On any non-OK response (status or an agents page) we THROW rather than silently
 *     returning a partial list — a partial ranking must never be persisted.
 *   - Agents are sorted by credits desc, then `symbol` asc, for a deterministic rank.
 */

import type { PublicAgent, SpaceTradersClient } from "../db/snapshots-types";

/** The subset of the Fetch API this client depends on. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const SPACETRADERS_API = "https://api.spacetraders.io/v2";
const AGENTS_PAGE_LIMIT = 20;

/** Shape of a single agent in the `/agents` listing (only the fields we persist). */
type AgentRecord = {
  symbol: string;
  credits: number;
  shipCount: number;
  startingFaction: string;
};

type AgentsPage = {
  data: AgentRecord[];
  meta: { total: number };
};

type StatusBody = {
  resetDate?: unknown;
};

/**
 * Create a SpaceTraders client bound to the given `fetch` implementation.
 */
export function createSpaceTradersClient({
  fetch,
}: {
  fetch: FetchLike;
}): SpaceTradersClient {
  async function fetchStatus(): Promise<{ resetDate: string }> {
    const response = await fetch(SPACETRADERS_API);
    if (!response.ok) {
      throw new Error(
        `SpaceTraders status request failed: ${response.status}`,
      );
    }

    const body = (await response.json()) as StatusBody;
    if (typeof body.resetDate !== "string" || body.resetDate.length === 0) {
      throw new Error("SpaceTraders status response is missing resetDate");
    }

    return { resetDate: body.resetDate };
  }

  async function fetchAllAgents(): Promise<PublicAgent[]> {
    const agents: PublicAgent[] = [];
    let page = 1;

    while (true) {
      const response = await fetch(
        `${SPACETRADERS_API}/agents?limit=${AGENTS_PAGE_LIMIT}&page=${page}`,
      );
      if (!response.ok) {
        throw new Error(
          `SpaceTraders agents request failed (page ${page}): ${response.status}`,
        );
      }

      const body = (await response.json()) as AgentsPage;
      const items = body.data ?? [];

      for (const item of items) {
        agents.push({
          symbol: item.symbol,
          credits: item.credits,
          shipCount: item.shipCount,
          faction: item.startingFaction,
        });
      }

      const total = body.meta?.total ?? 0;
      if (items.length < AGENTS_PAGE_LIMIT || agents.length >= total) {
        break;
      }
      page += 1;
    }

    agents.sort(
      (a, b) => b.credits - a.credits || a.symbol.localeCompare(b.symbol),
    );
    return agents;
  }

  return { fetchStatus, fetchAllAgents };
}
