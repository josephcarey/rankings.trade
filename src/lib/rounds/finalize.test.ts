import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Round } from "../db/rounds";
import type {
  FinalizationSeams,
  RatingTrigger,
  SeasonCloseEvaluator,
  SeasonCloseTrigger,
  SeasonResolver,
} from "./seams";

import { getRoundByResetDate, listStandings } from "../db/rounds";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { defaultFinalizationSeams } from "./seams";
import { finalizePendingRounds, finalizeRound } from "./finalize";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
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

async function agent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

async function league(db: D1Database, name: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO leagues (name) VALUES (?) RETURNING id")
    .bind(name)
    .first<{ id: number }>();
  return row!.id;
}

async function member(
  db: D1Database,
  leagueId: number,
  agentId: number,
  joinedAt = "2026-06-01 00:00:00",
  leftAt: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO league_members (league_id, agent_id, joined_at, left_at) VALUES (?, ?, ?, ?)",
    )
    .bind(leagueId, agentId, joinedAt, leftAt)
    .run();
}

/** Seams whose behaviour and call order can be asserted. */
function spySeams(
  resolve: () => { isRanked: boolean; seasonId: number | null },
  options: { calls?: string[]; closeDecision?: boolean } = {},
): {
  seams: FinalizationSeams;
  calls: string[];
  rating: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const calls = options.calls ?? [];
  const rating = vi.fn(() => {
    calls.push("rating");
    return Promise.resolve();
  });
  const close = vi.fn(() => {
    calls.push("close");
    return Promise.resolve();
  });
  const evaluate = vi.fn(() => {
    calls.push("evaluate");
    return Promise.resolve(options.closeDecision ?? false);
  });
  const seasonResolver: SeasonResolver = { resolve: () => Promise.resolve(resolve()) };
  const ratingTrigger: RatingTrigger = { onRankedRoundFinalized: rating };
  const seasonCloseEvaluator: SeasonCloseEvaluator = { shouldCloseSeason: evaluate };
  const seasonCloseTrigger: SeasonCloseTrigger = { onSeasonClose: close };
  return {
    seams: { ratingTrigger, seasonCloseEvaluator, seasonCloseTrigger, seasonResolver },
    calls,
    rating,
    evaluate,
    close,
  };
}

const unranked = () => ({ isRanked: false, seasonId: null });
const rankedSeason = (id: number) => () => ({ isRanked: true, seasonId: id });

describe("finalizeRound", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("freezes Universe standings from the last snapshot before the reset", async () => {
    await snap(db, "2026-05-01", "2026-05-30T00:00", "ALPHA", 10, 1);
    // Later observation is the final standing.
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 900, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 400, 2);

    const result = await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    expect(result.outcome).toBe("finalized");

    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.final_observed_at).toBe("2026-05-31T15:00");
    expect(round?.started_at).toBe("2026-05-30T00:00");
    expect(round?.finalized_at).not.toBeNull();

    const universe = await listStandings(db, round!.id, null);
    expect(universe.map((s) => [s.agent_symbol, s.final_credits, s.final_rank])).toEqual([
      ["ALPHA", 900, 1],
      ["BRAVO", 400, 2],
    ]);
  });

  it("is idempotent: re-running does not duplicate standings or re-finalize", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 900, 1);

    const first = await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    expect(first.outcome).toBe("finalized");
    const second = await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    expect(second.outcome).toBe("already_finalized");

    const round = await getRoundByResetDate(db, "2026-05-01");
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM round_standings WHERE round_id = ? AND league_id IS NULL",
      )
      .bind(round!.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    const rounds = await db
      .prepare("SELECT COUNT(*) AS n FROM rounds WHERE reset_date = ?")
      .bind("2026-05-01")
      .first<{ n: number }>();
    expect(rounds?.n).toBe(1);
  });

  it("skips an ended reset that has no snapshots", async () => {
    const result = await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    expect(result.outcome).toBe("no_data");
    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.finalized_at).toBeNull();
  });

  it("ranks each league internally and snapshots only its frozen members", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    await agent(db, "CHARLIE"); // in Universe but not the league
    const lg = await league(db, "Spacejam");
    await member(db, lg, a);
    await member(db, lg, b);

    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 3);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 500, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "CHARLIE", 300, 2);

    await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    const round = await getRoundByResetDate(db, "2026-05-01");

    const universe = await listStandings(db, round!.id, null);
    expect(universe).toHaveLength(3);

    const leagueRows = await listStandings(db, round!.id, lg);
    expect(leagueRows.map((s) => [s.agent_symbol, s.final_rank])).toEqual([
      ["BRAVO", 1],
      ["ALPHA", 2],
    ]);
    // CHARLIE is not a league member.
    expect(leagueRows.some((s) => s.agent_symbol === "CHARLIE")).toBe(false);
  });

  it("marks a frozen member with no snapshot as a non-participant", async () => {
    const a = await agent(db, "ALPHA");
    const ghost = await agent(db, "GHOST");
    const lg = await league(db, "Spacejam");
    await member(db, lg, a);
    await member(db, lg, ghost);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);

    await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    const round = await getRoundByResetDate(db, "2026-05-01");
    const rows = await listStandings(db, round!.id, lg);
    const ghostRow = rows.find((r) => r.agent_symbol === "GHOST");
    expect(ghostRow?.participated).toBe(0);
    expect(ghostRow?.final_credits).toBeNull();
    expect(ghostRow?.final_rank).toBe(2);
  });

  it("ties on equal credits share a rank (the draw signal for Epic H)", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const c = await agent(db, "CHARLIE");
    const lg = await league(db, "Spacejam");
    await member(db, lg, a);
    await member(db, lg, b);
    await member(db, lg, c);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 500, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 500, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "CHARLIE", 100, 3);

    await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    const round = await getRoundByResetDate(db, "2026-05-01");
    const rows = await listStandings(db, round!.id, lg);
    const bySymbol = Object.fromEntries(rows.map((r) => [r.agent_symbol, r.final_rank]));
    expect(bySymbol.ALPHA).toBe(1);
    expect(bySymbol.BRAVO).toBe(1);
    expect(bySymbol.CHARLIE).toBe(3); // competition ranking skips rank 2
  });

  it("does not let a post-finalization join or leave rewrite an archived round", async () => {
    const a = await agent(db, "ALPHA");
    const b = await agent(db, "BRAVO");
    const lg = await league(db, "Spacejam");
    await member(db, lg, a);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    await snap(db, "2026-05-01", "2026-05-31T15:00", "BRAVO", 999, 1);

    await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    const round = await getRoundByResetDate(db, "2026-05-01");
    const before = await listStandings(db, round!.id, lg);
    expect(before.map((r) => r.agent_symbol)).toEqual(["ALPHA"]);

    // BRAVO joins AFTER finalization; ALPHA leaves.
    await member(db, lg, b, "2026-07-01 00:00:00", null);
    await db
      .prepare(
        "UPDATE league_members SET left_at = '2026-07-01 00:00:00' WHERE league_id = ? AND agent_id = ?",
      )
      .bind(lg, a)
      .run();

    const again = await finalizeRound(db, "2026-05-01", defaultFinalizationSeams);
    expect(again.outcome).toBe("already_finalized");
    const after = await listStandings(db, round!.id, lg);
    expect(after.map((r) => r.agent_symbol)).toEqual(["ALPHA"]);
  });

  it("tags an unranked round and never fires the rating trigger", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    const spy = spySeams(unranked);
    await finalizeRound(db, "2026-05-01", spy.seams);

    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.is_ranked).toBe(0);
    expect(round?.season_id).toBeNull();
    expect(spy.rating).not.toHaveBeenCalled();
    expect(round?.season_processed_at).not.toBeNull();
    expect(round?.ratings_applied_at).toBeNull();
  });

  it("tags a ranked round, fires ratings once, before the season evaluation", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    const calls: string[] = [];
    const spy = spySeams(rankedSeason(7), { calls });

    await finalizeRound(db, "2026-05-01", spy.seams);
    // Re-run must not double-fire ratings.
    await finalizeRound(db, "2026-05-01", spy.seams);

    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.is_ranked).toBe(1);
    expect(round?.season_id).toBe(7);
    expect(spy.rating).toHaveBeenCalledTimes(1);
    expect(round?.ratings_applied_at).not.toBeNull();
    expect(calls).toEqual(["rating", "evaluate"]);
  });

  it("throws if a resolver returns a ranked round with no season", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    const bad = spySeams(() => ({ isRanked: true, seasonId: null }));
    await expect(finalizeRound(db, "2026-05-01", bad.seams)).rejects.toThrow(/ranked round with no season/);
  });

  it("fires the season-close trigger once when the evaluator opts in", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    const spy = spySeams(unranked, { closeDecision: true });

    await finalizeRound(db, "2026-05-01", spy.seams);
    await finalizeRound(db, "2026-05-01", spy.seams); // re-run: no double close

    expect(spy.evaluate).toHaveBeenCalledTimes(1);
    expect(spy.close).toHaveBeenCalledTimes(1);
    const round = await getRoundByResetDate(db, "2026-05-01");
    expect(round?.season_processed_at).not.toBeNull();
  });
});

describe("finalizePendingRounds", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("detects ended rounds and leaves the live round alone", async () => {
    await snap(db, "2026-04-01", "2026-04-30T00:00", "ALPHA", 100, 1);
    await snap(db, "2026-05-01", "2026-05-30T00:00", "ALPHA", 200, 1);
    await snap(db, "2026-06-01", "2026-06-01T00:00", "ALPHA", 5, 1); // live

    const summary = await finalizePendingRounds(db, "2026-06-01", defaultFinalizationSeams);
    expect(summary.finalized.sort()).toEqual(["2026-04-01", "2026-05-01"]);
    expect(await getRoundByResetDate(db, "2026-06-01")).toBeNull();
  });

  it("is a no-op sweep when nothing has ended", async () => {
    await snap(db, "2026-06-01", "2026-06-01T00:00", "ALPHA", 5, 1);
    const summary = await finalizePendingRounds(db, "2026-06-01", defaultFinalizationSeams);
    expect(summary).toEqual({
      alreadyFinalized: [],
      finalized: [],
      noData: [],
      pendingProcessed: 0,
    });
  });

  it("recovers a finalized round whose trigger marker was lost to a crash", async () => {
    await snap(db, "2026-05-01", "2026-05-31T15:00", "ALPHA", 100, 1);
    const spy = spySeams(unranked);
    await finalizeRound(db, "2026-05-01", spy.seams);

    // Simulate a crash AFTER finalize but BEFORE the season marker was written.
    const round = await getRoundByResetDate(db, "2026-05-01");
    await db
      .prepare("UPDATE rounds SET season_processed_at = NULL WHERE id = ?")
      .bind(round!.id)
      .run();

    const summary = await finalizePendingRounds(db, "2026-06-01", spy.seams);
    expect(summary.pendingProcessed).toBe(1);
    const after = await getRoundByResetDate(db, "2026-05-01");
    expect(after?.season_processed_at).not.toBeNull();
  });
});

describe("default seams", () => {
  it("report unranked with no season and inert triggers", async () => {
    const r = await defaultFinalizationSeams.seasonResolver.resolve(
      undefined as never,
      "2026-05-01",
    );
    expect(r).toEqual({ isRanked: false, seasonId: null });
    await expect(
      defaultFinalizationSeams.ratingTrigger.onRankedRoundFinalized(
        undefined as never,
        {} as Round,
      ),
    ).resolves.toBeUndefined();
    await expect(
      defaultFinalizationSeams.seasonCloseEvaluator.shouldCloseSeason(
        undefined as never,
        {} as Round,
      ),
    ).resolves.toBe(false);
  });
});
