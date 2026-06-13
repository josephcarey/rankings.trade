import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import {
  applyRatingPeriod,
  getRating,
  hasEarlierUnappliedRankedRound,
  isRatingPeriodApplied,
  listSeasonRatings,
} from "./ratings";
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

async function insertRankedRound(
  db: D1Database,
  resetDate: string,
  seasonId: number,
  finalized: boolean,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, 1, ?) RETURNING id`,
    )
    .bind(resetDate, seasonId, finalized ? "2026-06-01T00:00:00Z" : null)
    .first<{ id: number }>();
  return row!.id;
}

describe("applyRatingPeriod + reads", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("inserts new ratings, stamps last_round_id, and writes the marker", async () => {
    const a = await insertAgent(db, "ALPHA");
    const b = await insertAgent(db, "BRAVO");
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);

    await applyRatingPeriod(db, {
      roundId,
      seasonId: 1,
      updates: [
        { agentId: a, rating: 1520, rd: 200, volatility: 0.06 },
        { agentId: b, rating: 1480, rd: 200, volatility: 0.06 },
      ],
    });

    expect(await isRatingPeriodApplied(db, roundId)).toBe(true);
    const ratingA = await getRating(db, a, 1);
    expect(ratingA).toMatchObject({ rating: 1520, rd: 200, last_round_id: roundId });
    const all = await listSeasonRatings(db, 1);
    expect(all).toHaveLength(2);
  });

  it("upserts an existing rating in place rather than duplicating it", async () => {
    const a = await insertAgent(db, "ALPHA");
    const r1 = await insertRankedRound(db, "2026-06-01", 1, true);
    const r2 = await insertRankedRound(db, "2026-06-08", 1, true);

    await applyRatingPeriod(db, {
      roundId: r1,
      seasonId: 1,
      updates: [{ agentId: a, rating: 1520, rd: 180, volatility: 0.06 }],
    });
    await applyRatingPeriod(db, {
      roundId: r2,
      seasonId: 1,
      updates: [{ agentId: a, rating: 1550, rd: 150, volatility: 0.059 }],
    });

    const all = await listSeasonRatings(db, 1);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ rating: 1550, rd: 150, last_round_id: r2 });
  });

  it("scopes listSeasonRatings to one season", async () => {
    const a = await insertAgent(db, "ALPHA");
    const r1 = await insertRankedRound(db, "2026-06-01", 1, true);
    const r2 = await insertRankedRound(db, "2026-06-08", 2, true);
    await applyRatingPeriod(db, {
      roundId: r1,
      seasonId: 1,
      updates: [{ agentId: a, rating: 1520, rd: 180, volatility: 0.06 }],
    });
    await applyRatingPeriod(db, {
      roundId: r2,
      seasonId: 2,
      updates: [{ agentId: a, rating: 1490, rd: 200, volatility: 0.06 }],
    });

    expect(await listSeasonRatings(db, 1)).toHaveLength(1);
    expect(await listSeasonRatings(db, 2)).toHaveLength(1);
    const seasonTwo = await getRating(db, a, 2);
    expect(seasonTwo?.rating).toBe(1490);
  });

  it("rejects a duplicate marker for the same round (PK conflict)", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    await applyRatingPeriod(db, { roundId, seasonId: 1, updates: [] });
    await expect(
      applyRatingPeriod(db, { roundId, seasonId: 1, updates: [] }),
    ).rejects.toThrow();
  });

  it("reports an unapplied period as not applied", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    expect(await isRatingPeriodApplied(db, roundId)).toBe(false);
  });

  it("throws (fail-loud) rather than splitting a period across batches", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    // 100 rating updates + 1 marker = 101 statements > D1's 100-statement batch limit.
    const updates = Array.from({ length: 100 }, (_, i) => ({
      agentId: i + 1,
      rating: 1500,
      rd: 350,
      volatility: 0.06,
    }));
    await expect(
      applyRatingPeriod(db, { roundId, seasonId: 1, updates }),
    ).rejects.toThrow(/too large for a single atomic batch/);
    // Nothing was applied — not even the marker.
    expect(await isRatingPeriodApplied(db, roundId)).toBe(false);
    expect(await listSeasonRatings(db, 1)).toHaveLength(0);
  });

  it("applies the largest period that still fits one atomic batch (99 agents + marker)", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    const updates = Array.from({ length: 99 }, (_, i) => ({
      agentId: i + 1,
      rating: 1500,
      rd: 350,
      volatility: 0.06,
    }));
    await applyRatingPeriod(db, { roundId, seasonId: 1, updates });
    expect(await isRatingPeriodApplied(db, roundId)).toBe(true);
    expect(await listSeasonRatings(db, 1)).toHaveLength(99);
  });

  it("writes a rating_history row per agent in the same atomic batch as the upserts", async () => {
    const a = await insertAgent(db, "ALPHA");
    const b = await insertAgent(db, "BRAVO");
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);

    await applyRatingPeriod(db, {
      roundId,
      seasonId: 1,
      updates: [
        { agentId: a, rating: 1520, rd: 200, volatility: 0.06 },
        { agentId: b, rating: 1480, rd: 200, volatility: 0.06 },
      ],
      history: [
        { agentId: a, rating: 1520, rd: 200, rank: 1 },
        { agentId: b, rating: 1480, rd: 200, rank: 2 },
      ],
    });

    const rows = await db
      .prepare(
        `SELECT agent_id, season_id, round_id, rating, rd, rank
         FROM rating_history ORDER BY rank`,
      )
      .all<{
        agent_id: number;
        season_id: number;
        round_id: number;
        rating: number;
        rd: number;
        rank: number;
      }>();
    expect(rows.results).toEqual([
      { agent_id: a, season_id: 1, round_id: roundId, rating: 1520, rd: 200, rank: 1 },
      { agent_id: b, season_id: 1, round_id: roundId, rating: 1480, rd: 200, rank: 2 },
    ]);
  });

  it("history rides the marker's atomicity: a duplicate replay inserts no extra history", async () => {
    const a = await insertAgent(db, "ALPHA");
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    const args = {
      roundId,
      seasonId: 1,
      updates: [{ agentId: a, rating: 1520, rd: 200, volatility: 0.06 }],
      history: [{ agentId: a, rating: 1520, rd: 200, rank: 1 }],
    };
    await applyRatingPeriod(db, args);
    // A replay fails on the marker PK conflict and rolls the whole batch back.
    await expect(applyRatingPeriod(db, args)).rejects.toThrow();
    const count = await db
      .prepare(`SELECT COUNT(*) AS n FROM rating_history WHERE round_id = ?`)
      .bind(roundId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("fails loud when history does not cover exactly the rated agents", async () => {
    const a = await insertAgent(db, "ALPHA");
    const b = await insertAgent(db, "BRAVO");
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    await expect(
      applyRatingPeriod(db, {
        roundId,
        seasonId: 1,
        updates: [
          { agentId: a, rating: 1520, rd: 200, volatility: 0.06 },
          { agentId: b, rating: 1480, rd: 200, volatility: 0.06 },
        ],
        history: [{ agentId: a, rating: 1520, rd: 200, rank: 1 }],
      }),
    ).rejects.toThrow(/history covers 1 agents but 2/);
    // Nothing committed — not even the marker.
    expect(await isRatingPeriodApplied(db, roundId)).toBe(false);
  });

  it("fails loud when a history row has no matching rating update", async () => {
    const a = await insertAgent(db, "ALPHA");
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    await expect(
      applyRatingPeriod(db, {
        roundId,
        seasonId: 1,
        updates: [{ agentId: a, rating: 1520, rd: 200, volatility: 0.06 }],
        history: [{ agentId: 999, rating: 1520, rd: 200, rank: 1 }],
      }),
    ).rejects.toThrow(/no matching rating update/);
  });

  it("fails loud (size guard) once history pushes the period past one atomic batch", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    // 99 upserts + 1 multi-row history insert + 1 marker = 101 statements > 100.
    const updates = Array.from({ length: 99 }, (_, i) => ({
      agentId: i + 1,
      rating: 1500,
      rd: 350,
      volatility: 0.06,
    }));
    const history = updates.map((u) => ({
      agentId: u.agentId,
      rating: u.rating,
      rd: u.rd,
      rank: u.agentId,
    }));
    await expect(
      applyRatingPeriod(db, { roundId, seasonId: 1, updates, history }),
    ).rejects.toThrow(/too large for a single atomic batch/);
    expect(await isRatingPeriodApplied(db, roundId)).toBe(false);
  });

  it("applies the largest period with history that still fits one batch (98 agents)", async () => {
    const roundId = await insertRankedRound(db, "2026-06-01", 1, true);
    // 98 upserts + 1 history insert + 1 marker = 100 statements.
    const updates = Array.from({ length: 98 }, (_, i) => ({
      agentId: i + 1,
      rating: 1500,
      rd: 350,
      volatility: 0.06,
    }));
    const history = updates.map((u) => ({
      agentId: u.agentId,
      rating: u.rating,
      rd: u.rd,
      rank: u.agentId,
    }));
    await applyRatingPeriod(db, { roundId, seasonId: 1, updates, history });
    expect(await isRatingPeriodApplied(db, roundId)).toBe(true);
    expect(await listSeasonRatings(db, 1)).toHaveLength(98);
  });
});

describe("hasEarlierUnappliedRankedRound — chronological barrier", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("is false when no earlier ranked round exists", async () => {
    await insertRankedRound(db, "2026-06-08", 1, true);
    expect(await hasEarlierUnappliedRankedRound(db, 1, "2026-06-08")).toBe(false);
  });

  it("is true when an earlier finalized ranked round has no marker", async () => {
    await insertRankedRound(db, "2026-06-01", 1, true); // earlier, unapplied
    expect(await hasEarlierUnappliedRankedRound(db, 1, "2026-06-08")).toBe(true);
  });

  it("is false once the earlier round's period has been applied", async () => {
    const earlier = await insertRankedRound(db, "2026-06-01", 1, true);
    await applyRatingPeriod(db, { roundId: earlier, seasonId: 1, updates: [] });
    expect(await hasEarlierUnappliedRankedRound(db, 1, "2026-06-08")).toBe(false);
  });

  it("ignores earlier rounds from other seasons", async () => {
    await insertRankedRound(db, "2026-06-01", 99, true); // different season, unapplied
    expect(await hasEarlierUnappliedRankedRound(db, 1, "2026-06-08")).toBe(false);
  });

  it("ignores earlier rounds that are not yet finalized", async () => {
    await insertRankedRound(db, "2026-06-01", 1, false); // not finalized
    expect(await hasEarlierUnappliedRankedRound(db, 1, "2026-06-08")).toBe(false);
  });
});
