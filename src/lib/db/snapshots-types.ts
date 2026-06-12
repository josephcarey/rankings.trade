/**
 * Port-boundary types for the SpaceTraders scrape → `snapshots` pipeline (Epic D).
 *
 * These types are the contract between the three layers of the scrape:
 *   - {@link SpaceTradersClient} — the read boundary against the live SpaceTraders API.
 *   - {@link PublicAgent} — one agent as listed by that API.
 *   - {@link AgentSnapshotRow} — one row persisted to the `snapshots` table.
 *
 * Defining them here lets the API client (card #17) and the snapshot store (card #18)
 * be built and tested independently against a stable shape.
 */

/**
 * A public SpaceTraders agent as returned by the `/agents` listing.
 *
 * `faction` is the agent's `startingFaction`. Net-worth is not modelled (credits is the
 * sole ranking metric).
 *
 * @public — boundary contract consumed by the API client and scrape orchestrator (cards #17/#19).
 */
export type PublicAgent = {
  symbol: string;
  credits: number;
  shipCount: number;
  faction: string;
};

/**
 * A single row persisted to the `snapshots` table — one agent captured in one round
 * observation. Mirrors `migrations/0010_snapshots.sql` (minus the autoincrement `id`).
 *
 * `reset_date` keys the round; `observed_at` is the minute-bucketed capture time; the
 * triple `(reset_date, observed_at, agent_symbol)` is unique so re-running a capture is
 * idempotent.
 */
export type AgentSnapshotRow = {
  reset_date: string;
  observed_at: string;
  agent_symbol: string;
  credits: number;
  credit_rank: number;
  total_agents: number;
  ship_count: number;
  faction: string;
};

/**
 * The read boundary against the live SpaceTraders API. Implementations inject `fetch`
 * so tests can supply a fake and never hit the network.
 *
 * @public — boundary contract consumed by the API client and scrape orchestrator (cards #17/#19).
 */
export type SpaceTradersClient = {
  /** Reads the server status and returns the current round's `resetDate`. */
  fetchStatus: () => Promise<{ resetDate: string }>;
  /** Lists every public agent, sorted into a deterministic credit ranking. */
  fetchAllAgents: () => Promise<PublicAgent[]>;
};
