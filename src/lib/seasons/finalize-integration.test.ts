import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { describe, expect, it } from "vitest";

import type { FinalizationSeams } from "../rounds/seams";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { listSeasonRatings } from "../db/ratings";
import { getRoundByResetDate } from "../db/rounds";
import { getSeasonById, insertSeason, listSeasonStandings } from "../db/seasons";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { glickoRatingTrigger } from "../ratings/trigger";
import { finalizePendingRounds } from "../rounds/finalize";
import { defaultFinalizationSeams } from "../rounds/seams";
import { seasonCloseEvaluator, seasonCloseTrigger } from "./close";
import { seasonResolver } from "./resolver";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** The exact production composition (mirrors scheduled.ts) — H's trigger is preserved. */
const productionSeams: FinalizationSeams = {
  ...defaultFinalizationSeams,
  ratingTrigger: glickoRatingTrigger,
  seasonCloseEvaluator,
  seasonCloseTrigger,
  seasonResolver,
};

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function agent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

/** One snapshot observation for a (reset_date, agent). */
async function snap(
  db: D1Database,
  resetDate: string,
  observedAt: string,
  symbol: string,
  credits: number,
  rank: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots
         (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(resetDate, observedAt, symbol, credits, rank, 2, 1, "COSMIC")
    .run();
}

/** Seed a two-agent round's final snapshot (ALPHA beats BRAVO). */
async function seedRound(db: D1Database, resetDate: string): Promise<void> {
  await snap(db, resetDate, `${resetDate}T00:00:00Z`, "ALPHA", 900, 1);
  await snap(db, resetDate, `${resetDate}T00:00:00Z`, "BRAVO", 400, 2);
}

describe("finalize pipeline with production season seams", () => {
  it("activates ranked rounds (H fires) while a season is open, then closes at the cutoff", async () => {
    const db = await freshDb();
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");

    const s1 = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-01",
      unranked_gap_days: 0,
    });

    // Two pre-cutoff ranked rounds + the cutoff round. `currentResetDate` is the live universe.
    for (const date of ["2026-07-01", "2026-07-15", "2026-08-01"]) await seedRound(db, date);
    await snap(db, "2026-08-08", "2026-08-08T00:00:00Z", "ALPHA", 100, 1); // live round (not ended)

    await finalizePendingRounds(db, "2026-08-08", productionSeams);

    // The resolver activated ranked rounds ⇒ H wrote season-scoped ratings for S1.
    const s1Ratings = await listSeasonRatings(db, s1.id);
    expect(s1Ratings).toHaveLength(2);
    const preCutoff = await getRoundByResetDate(db, "2026-07-15");
    expect(preCutoff!.is_ranked).toBe(1);
    expect(preCutoff!.season_id).toBe(s1.id);

    // The cutoff round closed S1 and archived its standings.
    const closed = await getSeasonById(db, s1.id);
    expect(closed!.closed_at).not.toBeNull();
    expect(closed!.closed_round_id).toBe((await getRoundByResetDate(db, "2026-08-01"))!.id);
    const archive = await listSeasonStandings(db, s1.id);
    expect(archive).toHaveLength(2);
    expect(archive[0]!.final_rank).toBe(1);
  });

  it("structurally resets to baseline: the next season starts with empty ratings", async () => {
    const db = await freshDb();
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");

    const s1 = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-01",
      unranked_gap_days: 0,
    });
    for (const date of ["2026-07-01", "2026-08-01"]) await seedRound(db, date);
    await finalizePendingRounds(db, "2026-08-08", productionSeams);
    expect((await getSeasonById(db, s1.id))!.closed_at).not.toBeNull();
    const s1Ratings = await listSeasonRatings(db, s1.id);
    expect(s1Ratings.length).toBeGreaterThan(0);

    // Open S2 and finalize a post-close round: it ranks into S2 with FRESH baselines.
    const s2 = await insertSeason(db, {
      label: "S2",
      cutoff_date: "2026-12-01",
      unranked_gap_days: 0,
    });
    await seedRound(db, "2026-08-15");
    await finalizePendingRounds(db, "2026-08-22", productionSeams);

    const s2Ratings = await listSeasonRatings(db, s2.id);
    expect(s2Ratings).toHaveLength(2);
    // S2 ratings are independent of S1's (baseline reset is structural via season scoping).
    expect(new Set(s2Ratings.map((r) => r.season_id))).toEqual(new Set([s2.id]));
    // S1's archived ratings are untouched history.
    expect(await listSeasonRatings(db, s1.id)).toHaveLength(s1Ratings.length);
  });

  it("excludes rounds inside an unranked gap from ratings", async () => {
    const db = await freshDb();
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");

    const s1 = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-01",
      unranked_gap_days: 14,
    });
    for (const date of ["2026-07-01", "2026-08-01"]) await seedRound(db, date);
    await finalizePendingRounds(db, "2026-08-08", productionSeams);
    const closed = await getSeasonById(db, s1.id);
    expect(closed!.unranked_until).toBe("2026-08-15");

    // Open S2, but a round inside S1's gap must stay unranked.
    await insertSeason(db, { label: "S2", cutoff_date: "2026-12-01", unranked_gap_days: 0 });
    await seedRound(db, "2026-08-10");
    await finalizePendingRounds(db, "2026-08-22", productionSeams);

    const gapRound = await getRoundByResetDate(db, "2026-08-10");
    expect(gapRound!.is_ranked).toBe(0);
    expect(gapRound!.season_id).toBeNull();
  });

  it("is idempotent across a replay of the whole sweep", async () => {
    const db = await freshDb();
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");
    const s1 = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-01",
      unranked_gap_days: 0,
    });
    for (const date of ["2026-07-01", "2026-08-01"]) await seedRound(db, date);

    await finalizePendingRounds(db, "2026-08-08", productionSeams);
    const firstClosedAt = (await getSeasonById(db, s1.id))!.closed_at;
    const firstArchive = await listSeasonStandings(db, s1.id);

    // Re-run the entire sweep: no double archive, no re-close, no rating drift.
    await finalizePendingRounds(db, "2026-08-08", productionSeams);
    expect(await listSeasonStandings(db, s1.id)).toHaveLength(firstArchive.length);
    expect((await getSeasonById(db, s1.id))!.closed_at).toBe(firstClosedAt);
  });
});
