import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import {
  getAgentRatingDelta,
  listAgentRatingHistory,
  listSeasonRoundDeltas,
} from "./rating-history";
import { applyRatingPeriod } from "./ratings";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function insertAgent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

async function insertRound(
  db: D1Database,
  resetDate: string,
  seasonId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, 1, '2026-06-01T00:00:00Z') RETURNING id`,
    )
    .bind(resetDate, seasonId)
    .first<{ id: number }>();
  return row!.id;
}

/** Insert a history row directly (bypassing the rating maths) for read-path tests. */
async function insertHistory(
  db: D1Database,
  args: {
    agentId: number;
    seasonId: number;
    roundId: number;
    rating: number;
    rank: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rating_history (agent_id, season_id, round_id, rating, rd, rank)
       VALUES (?, ?, ?, ?, 40, ?)`,
    )
    .bind(args.agentId, args.seasonId, args.roundId, args.rating, args.rank)
    .run();
}

describe("listAgentRatingHistory", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("is empty when the agent has no history", async () => {
    const a = await insertAgent(db, "ALFA");
    expect(await listAgentRatingHistory(db, a, 1)).toEqual([]);
  });

  it("returns the agent's points oldest round first, season-scoped", async () => {
    const a = await insertAgent(db, "ALFA");
    const r1 = await insertRound(db, "2026-06-01", 1);
    const r2 = await insertRound(db, "2026-06-08", 1);
    const otherSeasonRound = await insertRound(db, "2026-06-15", 2);
    // Insert out of chronological order to prove the ORDER BY.
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r2, rating: 1550, rank: 1 });
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r1, rating: 1500, rank: 2 });
    await insertHistory(db, {
      agentId: a,
      seasonId: 2,
      roundId: otherSeasonRound,
      rating: 1490,
      rank: 1,
    });

    const points = await listAgentRatingHistory(db, a, 1);
    expect(points.map((p) => p.resetDate)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(points.map((p) => p.rating)).toEqual([1500, 1550]);
    expect(points.map((p) => p.rank)).toEqual([2, 1]);
  });
});

describe("getAgentRatingDelta", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("returns null for a brand-new entrant with a single row", async () => {
    const a = await insertAgent(db, "ALFA");
    const r1 = await insertRound(db, "2026-06-01", 1);
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r1, rating: 1500, rank: 1 });
    expect(await getAgentRatingDelta(db, a, 1)).toBeNull();
  });

  it("computes the delta between the two most recent rounds", async () => {
    const a = await insertAgent(db, "ALFA");
    const r1 = await insertRound(db, "2026-06-01", 1);
    const r2 = await insertRound(db, "2026-06-08", 1);
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r1, rating: 1500, rank: 4 });
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r2, rating: 1540, rank: 1 });

    const delta = await getAgentRatingDelta(db, a, 1);
    expect(delta).toEqual({ ratingDelta: 40, rankDelta: 3 });
  });
});

describe("listSeasonRoundDeltas", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("is empty when the season has fewer than two rounds with history", async () => {
    const a = await insertAgent(db, "ALFA");
    const r1 = await insertRound(db, "2026-06-01", 1);
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r1, rating: 1500, rank: 1 });
    const deltas = await listSeasonRoundDeltas(db, 1);
    expect(deltas.size).toBe(0);
  });

  it("derives every agent's delta from the latest two rounds; new entrants are absent", async () => {
    const a = await insertAgent(db, "ALFA");
    const b = await insertAgent(db, "BETA");
    const c = await insertAgent(db, "CHARLIE");
    const r1 = await insertRound(db, "2026-06-01", 1);
    const r2 = await insertRound(db, "2026-06-08", 1);

    // Round 1: A and B only.
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r1, rating: 1500, rank: 1 });
    await insertHistory(db, { agentId: b, seasonId: 1, roundId: r1, rating: 1480, rank: 2 });
    // Round 2: A drops below B, and C is a brand-new entrant.
    await insertHistory(db, { agentId: a, seasonId: 1, roundId: r2, rating: 1470, rank: 2 });
    await insertHistory(db, { agentId: b, seasonId: 1, roundId: r2, rating: 1520, rank: 1 });
    await insertHistory(db, { agentId: c, seasonId: 1, roundId: r2, rating: 1490, rank: 3 });

    const deltas = await listSeasonRoundDeltas(db, 1);
    expect(deltas.get(a)).toEqual({ ratingDelta: -30, rankDelta: -1 });
    expect(deltas.get(b)).toEqual({ ratingDelta: 40, rankDelta: 1 });
    // C only has a latest row — no delta.
    expect(deltas.has(c)).toBe(false);
  });
});

describe("rating history written through applyRatingPeriod", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("persists a history row per agent in the same call and reads back deltas", async () => {
    const a = await insertAgent(db, "ALFA");
    const b = await insertAgent(db, "BETA");
    const r1 = await insertRound(db, "2026-06-01", 1);
    const r2 = await insertRound(db, "2026-06-08", 1);

    await applyRatingPeriod(db, {
      roundId: r1,
      seasonId: 1,
      updates: [
        { agentId: a, rating: 1500, rd: 200, volatility: 0.06 },
        { agentId: b, rating: 1480, rd: 200, volatility: 0.06 },
      ],
      history: [
        { agentId: a, rating: 1500, rd: 200, rank: 1 },
        { agentId: b, rating: 1480, rd: 200, rank: 2 },
      ],
    });
    await applyRatingPeriod(db, {
      roundId: r2,
      seasonId: 1,
      updates: [
        { agentId: a, rating: 1520, rd: 180, volatility: 0.06 },
        { agentId: b, rating: 1460, rd: 180, volatility: 0.06 },
      ],
      history: [
        { agentId: a, rating: 1520, rd: 180, rank: 1 },
        { agentId: b, rating: 1460, rd: 180, rank: 2 },
      ],
    });

    expect(await listAgentRatingHistory(db, a, 1)).toHaveLength(2);
    expect(await getAgentRatingDelta(db, a, 1)).toEqual({
      ratingDelta: 20,
      rankDelta: 0,
    });
  });
});
