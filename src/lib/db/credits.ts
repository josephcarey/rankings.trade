/**
 * Credits time-series read views (Epic J) — read-only composition over
 * `rounds` and `round_standings` (Epics G/H). Produces per-agent credit series
 * aligned to a shared, chronologically-ordered set of rounds, ready to feed the
 * chart geometry in `src/lib/charts/line-chart.ts`.
 *
 * Scoping rules (correctness):
 *   - Non-participation in a round is a `null` GAP, never a zero — the chart
 *     draws a break rather than a misleading dip to the floor.
 *   - The Universe view is OPEN-SEASON scoped (DEC-I2): only ranked, finalized
 *     rounds of the given season, Universe scope (`league_id IS NULL`).
 *   - The league view is league-scoped across that league's finalized rounds.
 *     A private league's data only reaches this module through a server `load`
 *     that has already passed the Epic E visibility gate.
 */

/** A chronological column in a credit series. */
export interface SeriesRound {
  readonly id: number;
  readonly reset_date: string;
}

/** Rounds plus each requested agent's per-round credits (null = no data). */
export interface CreditsSeries {
  /** agentId → credits aligned to `rounds` (null where the agent has no row). */
  readonly byAgent: Map<number, (null | number)[]>;
  readonly rounds: SeriesRound[];
}

interface StandingPoint {
  agent_id: null | number;
  final_credits: null | number;
  round_id: number;
}

/** Align raw `(round_id, agent_id, credits)` rows onto the ordered rounds. */
function alignSeries(
  rounds: SeriesRound[],
  agentIds: readonly number[],
  rows: readonly StandingPoint[],
): CreditsSeries {
  const indexByRound = new Map(rounds.map((r, i) => [r.id, i]));
  const byAgent = new Map<number, (null | number)[]>(
    agentIds.map((id) => [
      id,
      Array.from({ length: rounds.length }, () => null as null | number),
    ]),
  );

  for (const row of rows) {
    if (row.agent_id === null) continue;
    const series = byAgent.get(row.agent_id);
    const at = indexByRound.get(row.round_id);
    if (series && at !== undefined) series[at] = row.final_credits;
  }

  return { byAgent, rounds };
}

/**
 * Open-season Universe credit series for the given agents, oldest round first.
 * Empty when no agents are requested or the season has no ranked finalized
 * rounds yet.
 */
export async function listUniverseCreditsSeries(
  db: D1Database,
  seasonId: number,
  agentIds: readonly number[],
): Promise<CreditsSeries> {
  if (agentIds.length === 0) return { byAgent: new Map(), rounds: [] };

  const roundRows = await db
    .prepare(
      `SELECT id, reset_date FROM rounds
       WHERE season_id = ? AND finalized_at IS NOT NULL AND is_ranked = 1
       ORDER BY reset_date ASC, id ASC`,
    )
    .bind(seasonId)
    .all<SeriesRound>();
  const rounds = roundRows.results ?? [];
  if (rounds.length === 0) {
    return {
      byAgent: new Map(agentIds.map((id) => [id, []])),
      rounds: [],
    };
  }

  const placeholders = agentIds.map(() => "?").join(", ");
  const standings = await db
    .prepare(
      `SELECT rs.round_id AS round_id, rs.agent_id AS agent_id,
              rs.final_credits AS final_credits
       FROM round_standings rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.season_id = ? AND r.finalized_at IS NOT NULL AND r.is_ranked = 1
         AND rs.league_id IS NULL AND rs.agent_id IN (${placeholders})`,
    )
    .bind(seasonId, ...agentIds)
    .all<StandingPoint>();

  return alignSeries(rounds, agentIds, standings.results ?? []);
}

/**
 * League credit series for the given agents across that league's finalized
 * rounds, oldest first. Empty when no agents are requested or the league has no
 * finalized rounds yet.
 */
export async function listLeagueCreditsSeries(
  db: D1Database,
  leagueId: number,
  agentIds: readonly number[],
): Promise<CreditsSeries> {
  if (agentIds.length === 0) return { byAgent: new Map(), rounds: [] };

  const roundRows = await db
    .prepare(
      `SELECT DISTINCT r.id AS id, r.reset_date AS reset_date
       FROM rounds r
       JOIN round_standings rs ON rs.round_id = r.id
       WHERE rs.league_id = ? AND r.finalized_at IS NOT NULL
       ORDER BY r.reset_date ASC, r.id ASC`,
    )
    .bind(leagueId)
    .all<SeriesRound>();
  const rounds = roundRows.results ?? [];
  if (rounds.length === 0) {
    return { byAgent: new Map(agentIds.map((id) => [id, []])), rounds: [] };
  }

  const placeholders = agentIds.map(() => "?").join(", ");
  const standings = await db
    .prepare(
      `SELECT rs.round_id AS round_id, rs.agent_id AS agent_id,
              rs.final_credits AS final_credits
       FROM round_standings rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE rs.league_id = ? AND r.finalized_at IS NOT NULL
         AND rs.agent_id IN (${placeholders})`,
    )
    .bind(leagueId, ...agentIds)
    .all<StandingPoint>();

  return alignSeries(rounds, agentIds, standings.results ?? []);
}

/** The most recent finalized round that has standings for a league, or null. */
export async function getLatestFinalizedLeagueRound(
  db: D1Database,
  leagueId: number,
): Promise<SeriesRound | null> {
  const row = await db
    .prepare(
      `SELECT r.id AS id, r.reset_date AS reset_date
       FROM rounds r
       JOIN round_standings rs ON rs.round_id = r.id
       WHERE rs.league_id = ? AND r.finalized_at IS NOT NULL
       ORDER BY r.reset_date DESC, r.id DESC
       LIMIT 1`,
    )
    .bind(leagueId)
    .first<SeriesRound>();
  return row ?? null;
}
