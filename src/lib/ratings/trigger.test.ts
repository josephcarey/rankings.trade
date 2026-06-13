import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Round } from "../db/rounds";
import type { FinalizationSeams } from "../rounds/seams";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import {
  getAgentRatingDelta,
  listAgentRatingHistory,
} from "../db/rating-history";
import { getRating, isRatingPeriodApplied, listSeasonRatings } from "../db/ratings";
import { getRoundByResetDate } from "../db/rounds";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { finalizeRound } from "../rounds/finalize";
import { defaultFinalizationSeams } from "../rounds/seams";
import { computeSeasonStandings } from "../seasons/standings";
import { GLICKO2_CONFIG } from "./config";
import { createGlickoRatingTrigger, glickoRatingTrigger } from "./trigger";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

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

/** Insert a finalized round and return its full row. */
async function finalizedRound(
  db: D1Database,
  resetDate: string,
  opts: { isRanked: boolean; seasonId: number | null },
): Promise<Round> {
  await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, ?, '2026-06-01T00:00:00Z')`,
    )
    .bind(resetDate, opts.seasonId, opts.isRanked ? 1 : 0)
    .run();
  const round = await getRoundByResetDate(db, resetDate);
  return round!;
}

async function universeStanding(
  db: D1Database,
  roundId: number,
  symbol: string,
  agentId: number | null,
  credits: number | null,
  rank: number,
  participated = 1,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_standings
         (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(roundId, symbol, agentId, credits, rank, participated)
    .run();
}

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
    .bind(resetDate, observedAt, symbol, credits, rank, 99, 1, "COSMIC")
    .run();
}

/** Production-style seams: inert defaults + the real rating trigger + a ranked resolver. */
function rankedSeams(seasonId: number): FinalizationSeams {
  return {
    ...defaultFinalizationSeams,
    ratingTrigger: glickoRatingTrigger,
    seasonResolver: {
      resolve: () => Promise.resolve({ isRanked: true, seasonId }),
    },
  };
}

describe("glickoRatingTrigger — applying a ranked round", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("updates each participating registered agent exactly once and marks the round", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const c = await agent(db, "CHARLIE");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await universeStanding(db, round.id, "BRAVO", b, 500, 2);
    await universeStanding(db, round.id, "CHARLIE", c, 100, 3);

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);

    const ratings = await listSeasonRatings(db, 1);
    expect(ratings).toHaveLength(3);
    for (const r of ratings) expect(r.last_round_id).toBe(round.id);
    const byAgent = new Map(ratings.map((r) => [r.agent_id, r.rating]));
    expect(byAgent.get(a)!).toBeGreaterThan(byAgent.get(b)!);
    expect(byAgent.get(b)!).toBeGreaterThan(byAgent.get(c)!);
    expect(await isRatingPeriodApplied(db, round.id)).toBe(true);
  });

  it("rates registered agents only — unregistered standings are ignored", async () => {
    const a = await agent(db, "ALPHA");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await universeStanding(db, round.id, "GHOST", null, 500, 2); // scraped, unregistered

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);

    const ratings = await listSeasonRatings(db, 1);
    expect(ratings.map((r) => r.agent_id)).toEqual([a]);
  });

  it("treats equal final credits as a draw (tied agents move identically)", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 500, 1);
    await universeStanding(db, round.id, "BRAVO", b, 500, 1);

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);

    const ra = await getRating(db, a, 1);
    const rb = await getRating(db, b, 1);
    expect(ra!.rating).toBeCloseTo(rb!.rating, 9);
    expect(ra!.rating).toBeCloseTo(GLICKO2_CONFIG.initialRating, 5);
  });

  it("inflates RD for a registered non-participant who already has a season rating", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const c = await agent(db, "CHARLIE");

    // Round 1: all three participate → all get a rating.
    const r1 = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, r1.id, "ALPHA", a, 900, 1);
    await universeStanding(db, r1.id, "BRAVO", b, 500, 2);
    await universeStanding(db, r1.id, "CHARLIE", c, 100, 3);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r1);
    const cBefore = await getRating(db, c, 1);

    // Round 2: CHARLIE sits out. A and B play; C gets RD inflation only.
    const r2 = await finalizedRound(db, "2026-06-08", { isRanked: true, seasonId: 1 });
    await universeStanding(db, r2.id, "ALPHA", a, 900, 1);
    await universeStanding(db, r2.id, "BRAVO", b, 500, 2);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r2);
    const cAfter = await getRating(db, c, 1);

    expect(cAfter!.rating).toBeCloseTo(cBefore!.rating, 9); // rating unchanged
    expect(cAfter!.volatility).toBeCloseTo(cBefore!.volatility, 9); // volatility unchanged
    expect(cAfter!.rd).toBeGreaterThan(cBefore!.rd); // RD inflated
    expect(cAfter!.last_round_id).toBe(r2.id);
  });

  it("is idempotent: a re-trigger before the round is marked does not double-apply", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await universeStanding(db, round.id, "BRAVO", b, 100, 2);

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);
    const first = await listSeasonRatings(db, 1);

    // Re-invoke (simulating a crash before ratings_applied_at was set).
    await glickoRatingTrigger.onRankedRoundFinalized(db, round);
    const second = await listSeasonRatings(db, 1);

    expect(second).toEqual(first); // byte-identical, applied exactly once
  });

  it("does nothing for an unranked round (guard)", async () => {
    const a = await agent(db, "ALPHA");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: false, seasonId: null });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);

    expect(await listSeasonRatings(db, 1)).toHaveLength(0);
    expect(await isRatingPeriodApplied(db, round.id)).toBe(false);
  });

  it("writes per-round rating_history with rank matching the live leaderboard rank", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const c = await agent(db, "CHARLIE");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await universeStanding(db, round.id, "BRAVO", b, 500, 2);
    await universeStanding(db, round.id, "CHARLIE", c, 100, 3);

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);

    const history = await listAgentRatingHistory(db, a, 1);
    expect(history).toHaveLength(1);
    expect(history[0]!.resetDate).toBe("2026-06-01");

    // Every rated agent gets a history row whose rank equals the leaderboard's live rank.
    const standings = await computeSeasonStandings(db, 1);
    for (const s of standings) {
      const point = await listAgentRatingHistory(db, s.agent_id, 1);
      expect(point.at(-1)!.rank).toBe(s.final_rank);
      expect(point.at(-1)!.rating).toBeCloseTo(s.final_rating, 9);
    }
    // ALPHA won the round, so its history rank is #1.
    expect(history[0]!.rank).toBe(1);
  });

  it("history deltas track rank movement across two rounds", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");

    const r1 = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, r1.id, "ALPHA", a, 900, 1);
    await universeStanding(db, r1.id, "BRAVO", b, 100, 2);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r1);

    // Round 2: BRAVO crushes ALPHA repeatedly is not possible in one round, but a strong
    // win flips nothing yet; assert deltas exist and are well-formed (new entrant → null).
    const r2 = await finalizedRound(db, "2026-06-08", { isRanked: true, seasonId: 1 });
    await universeStanding(db, r2.id, "ALPHA", a, 100, 2);
    await universeStanding(db, r2.id, "BRAVO", b, 900, 1);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r2);

    const deltaA = await getAgentRatingDelta(db, a, 1);
    const deltaB = await getAgentRatingDelta(db, b, 1);
    expect(deltaA).not.toBeNull();
    expect(deltaB).not.toBeNull();
    // A lost ground, B gained: A's rating delta is negative, B's positive.
    expect(deltaA!.ratingDelta).toBeLessThan(0);
    expect(deltaB!.ratingDelta).toBeGreaterThan(0);
  });
});

describe("glickoRatingTrigger — chronological barrier", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("defers (throws) when an earlier ranked round in the season is unapplied", async () => {
    const a = await agent(db, "ALPHA");
    const earlier = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, earlier.id, "ALPHA", a, 900, 1);
    const later = await finalizedRound(db, "2026-06-08", { isRanked: true, seasonId: 1 });
    await universeStanding(db, later.id, "ALPHA", a, 900, 1);

    await expect(
      glickoRatingTrigger.onRankedRoundFinalized(db, later),
    ).rejects.toThrow(/deferred/);
    expect(await listSeasonRatings(db, 1)).toHaveLength(0);

    // Apply the earlier round first, then the later one proceeds.
    await glickoRatingTrigger.onRankedRoundFinalized(db, earlier);
    await glickoRatingTrigger.onRankedRoundFinalized(db, later);
    expect(await isRatingPeriodApplied(db, later.id)).toBe(true);
  });
});

describe("glickoRatingTrigger — end-to-end via the finalize orchestrator", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("computes ratings during finalization and marks ratings_applied_at", async () => {
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 900, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 400, 2);

    const result = await finalizeRound(db, "2026-05-01", rankedSeams(1));
    expect(result.outcome).toBe("finalized");

    const ratings = await listSeasonRatings(db, 1);
    expect(ratings).toHaveLength(2);
    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.ratings_applied_at).not.toBeNull();
    expect(await isRatingPeriodApplied(db, round!.id)).toBe(true);
  });

  it("re-running finalization does not re-apply ratings", async () => {
    await agent(db, "ALPHA");
    await agent(db, "BRAVO");
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 900, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 400, 2);

    await finalizeRound(db, "2026-05-01", rankedSeams(1));
    const first = await listSeasonRatings(db, 1);
    await finalizeRound(db, "2026-05-01", rankedSeams(1)); // re-run
    const second = await listSeasonRatings(db, 1);

    expect(second).toEqual(first);
  });

  it("does not rate an unranked round end-to-end", async () => {
    await agent(db, "ALPHA");
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 900, 1);

    await finalizeRound(db, "2026-05-01", defaultFinalizationSeams); // unranked resolver
    expect(await listSeasonRatings(db, 1)).toHaveLength(0);
  });

  it("createGlickoRatingTrigger accepts a custom config", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const round = await finalizedRound(db, "2026-06-01", { isRanked: true, seasonId: 1 });
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await universeStanding(db, round.id, "BRAVO", b, 100, 2);

    const trigger = createGlickoRatingTrigger({ ...GLICKO2_CONFIG, tau: 0.5 });
    await trigger.onRankedRoundFinalized(db, round);
    expect(await listSeasonRatings(db, 1)).toHaveLength(2);
  });
});
