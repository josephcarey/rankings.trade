import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { describe, expect, it } from "vitest";

import type { ImportOptions, LegacySnapshotRow } from "./legacy-types";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { fixtureCrewSymbols, legacyFixture } from "./fixtures/legacy-fixture";
import { analyzeIntegrity, runImport } from "./import-pipeline";
import { transformSnapshots } from "./transform";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));
const LAUNCH = "2025-01-15";

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function options(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return { launchResetDate: LAUNCH, ...overrides };
}

async function rows<T>(db: D1Database, sql: string, binds: unknown[] = []): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...binds).all<T>();
  return results ?? [];
}

/** Ratings keyed by symbol, for cross-run determinism comparison. */
async function ratingsBySymbol(
  db: D1Database,
): Promise<Record<string, { rating: number; rd: number; volatility: number }>> {
  const list = await rows<{ symbol: string; rating: number; rd: number; volatility: number }>(
    db,
    `SELECT a.symbol AS symbol, r.rating AS rating, r.rd AS rd, r.volatility AS volatility
     FROM ratings r JOIN agents a ON a.id = r.agent_id ORDER BY a.symbol`,
  );
  return Object.fromEntries(list.map((r) => [r.symbol, { rating: r.rating, rd: r.rd, volatility: r.volatility }]));
}

describe("runImport — chronological round reconstruction", () => {
  it("reconstructs one finalized, ranked round per legacy reset_date, in chronological order", async () => {
    const db = await freshDb();
    const summary = await runImport(db, legacyFixture, options());

    expect(summary.resetDates).toEqual(["2024-11-01", "2024-11-15", "2024-12-01"]);
    expect(summary.roundsFinalized).toBe(3);

    const rounds = await rows<{ reset_date: string; finalized_at: string | null; is_ranked: number; ratings_applied_at: string | null }>(
      db,
      "SELECT reset_date, finalized_at, is_ranked, ratings_applied_at FROM rounds ORDER BY reset_date ASC",
    );
    expect(rounds.map((r) => r.reset_date)).toEqual(["2024-11-01", "2024-11-15", "2024-12-01"]);
    expect(rounds.every((r) => r.finalized_at !== null)).toBe(true);
    expect(rounds.every((r) => r.is_ranked === 1)).toBe(true);
    expect(rounds.every((r) => r.ratings_applied_at !== null)).toBe(true);
  });

  it("does not depend on legacy input order (shuffled input yields the same rounds)", async () => {
    const db = await freshDb();
    const shuffled = [...legacyFixture].toReversed();
    const summary = await runImport(db, shuffled, options());
    expect(summary.resetDates).toEqual(["2024-11-01", "2024-11-15", "2024-12-01"]);
    expect(summary.roundsFinalized).toBe(3);
  });
});

describe("runImport — final standing = last snapshot before reset", () => {
  it("freezes the LAST observation bucket of each round as its Universe standing", async () => {
    const db = await freshDb();
    await runImport(db, legacyFixture, options());

    // Round 1 final bucket (12:00): BAMES_JOND & JBARHORST tied at 5000, RANDO_PUBLIC at 1200.
    const r1 = await rows<{ agent_symbol: string; final_credits: number; final_rank: number }>(
      db,
      `SELECT rs.agent_symbol, rs.final_credits, rs.final_rank FROM round_standings rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.reset_date = '2024-11-01' AND rs.league_id IS NULL
       ORDER BY rs.agent_symbol`,
    );
    expect(r1).toEqual([
      { agent_symbol: "BAMES_JOND", final_credits: 5000, final_rank: 1 },
      { agent_symbol: "JBARHORST", final_credits: 5000, final_rank: 1 },
      { agent_symbol: "RANDO_PUBLIC", final_credits: 1200, final_rank: 3 },
    ]);
  });

  it("drops the GHOST_AGENT row (null credits) so it never appears in any standing", async () => {
    const db = await freshDb();
    const summary = await runImport(db, legacyFixture, options());
    expect(summary.snapshotRowsDropped).toBe(1);
    const ghost = await rows(db, "SELECT 1 FROM round_standings WHERE agent_symbol = 'GHOST_AGENT'");
    expect(ghost).toHaveLength(0);
  });
});

describe("runImport — missing/incomplete final snapshot", () => {
  it("uses the (incomplete) last bucket: only the captured agent is in the final round's standing", async () => {
    const db = await freshDb();
    await runImport(db, legacyFixture, options());

    const r3 = await rows<{ agent_symbol: string }>(
      db,
      `SELECT rs.agent_symbol FROM round_standings rs JOIN rounds r ON r.id = rs.round_id
       WHERE r.reset_date = '2024-12-01' AND rs.league_id IS NULL ORDER BY rs.agent_symbol`,
    );
    expect(r3.map((r) => r.agent_symbol)).toEqual(["BAMES_JOND"]);
  });

  it("flags the incomplete final bucket in the integrity report", async () => {
    const db = await freshDb();
    const summary = await runImport(db, legacyFixture, options());
    const r3 = summary.integrity.find((f) => f.reset_date === "2024-12-01")!;
    expect(r3.peakAgents).toBe(4);
    expect(r3.finalAgents).toBe(1);
    expect(r3.incompleteFinal).toBe(true);
    const r1 = summary.integrity.find((f) => f.reset_date === "2024-11-01")!;
    expect(r1.incompleteFinal).toBe(false);
  });

  it("aborts before finalizing when failOnIncompleteFinal is set", async () => {
    const db = await freshDb();
    await expect(runImport(db, legacyFixture, options({ failOnIncompleteFinal: true }))).rejects.toThrow(
      /incomplete final snapshot/,
    );
    expect(await rows(db, "SELECT 1 FROM rounds WHERE finalized_at IS NOT NULL")).toHaveLength(0);
  });
});

describe("analyzeIntegrity", () => {
  it("computes peak vs final agent counts per round from transformed rows", () => {
    const { rows: transformed } = transformSnapshots(legacyFixture);
    const findings = analyzeIntegrity(transformed, 0.5);
    expect(findings.map((f) => f.reset_date)).toEqual(["2024-11-01", "2024-11-15", "2024-12-01"]);
  });
});

describe("runImport — genesis rating replay + Season 0 archival", () => {
  it("rates only the registered crew, replays from the baseline, and archives Season 0", async () => {
    const db = await freshDb();
    const summary = await runImport(db, legacyFixture, options());

    // Only the four seeded crew symbols are rated by default; public agents are history-only.
    const rated = Object.keys(await ratingsBySymbol(db));
    expect(rated.toSorted()).toEqual([...fixtureCrewSymbols].toSorted());
    expect(summary.maxRatingPeriodAgents).toBe(4);
    expect(summary.unratedSymbols).toBeGreaterThan(0);

    // Season 0 is closed (archived) and the live season is therefore empty at launch.
    expect(summary.seasonClosed).toBe(true);
    expect(summary.seasonStandings).toBe(4);
    const open = await rows(db, "SELECT 1 FROM seasons WHERE closed_at IS NULL");
    expect(open).toHaveLength(0);

    // Every rating row is scoped to the archived Season 0 (no leakage to a future season).
    const seasons = await rows<{ season_id: number }>(db, "SELECT DISTINCT season_id FROM ratings");
    expect(seasons).toEqual([{ season_id: summary.seasonId }]);
  });

  it("is deterministic: two fresh imports of the same input produce identical rating values", async () => {
    const a = await freshDb();
    const b = await freshDb();
    await runImport(a, legacyFixture, options());
    await runImport(b, legacyFixture, options());
    expect(await ratingsBySymbol(a)).toEqual(await ratingsBySymbol(b));
  });
});

describe("runImport — idempotent re-run", () => {
  it("a second run repairs rather than duplicates: identical semantic state", async () => {
    const db = await freshDb();
    const first = await runImport(db, legacyFixture, options());
    const ratingsAfterFirst = await ratingsBySymbol(db);
    const standingsAfterFirst = await rows(db, "SELECT * FROM round_standings ORDER BY id");

    const second = await runImport(db, legacyFixture, options());

    expect(second.roundsFinalized).toBe(first.roundsFinalized);
    expect(second.seasonStandings).toBe(first.seasonStandings);
    expect(await ratingsBySymbol(db)).toEqual(ratingsAfterFirst);
    // No duplicate rounds or standings were created.
    expect(await rows(db, "SELECT COUNT(*) AS n FROM rounds")).toEqual([{ n: 3 }]);
    expect(await rows(db, "SELECT * FROM round_standings ORDER BY id")).toEqual(standingsAfterFirst);
  });
});

describe("runImport — register-all policy", () => {
  it("registers every valid legacy agent and rates the full field when registerAllAgents is set", async () => {
    const db = await freshDb();
    const summary = await runImport(db, legacyFixture, options({ registerAllAgents: true }));
    const rated = Object.keys(await ratingsBySymbol(db));
    expect(rated).toContain("RANDO_PUBLIC");
    expect(summary.unratedSymbols).toBe(0);
    expect(summary.agentsRegistered).toBeGreaterThan(0);
  });
});

describe("runImport — preflight gates", () => {
  it("rejects a launchResetDate that is not strictly after the latest legacy reset_date", async () => {
    const db = await freshDb();
    await expect(runImport(db, legacyFixture, options({ launchResetDate: "2024-12-01" }))).rejects.toThrow(
      /strictly AFTER/,
    );
  });

  it("rejects a non-ISO launchResetDate", async () => {
    const db = await freshDb();
    await expect(runImport(db, legacyFixture, options({ launchResetDate: "later" }))).rejects.toThrow(
      /not an ISO date/,
    );
  });

  it("refuses to import while a different season is already open", async () => {
    const db = await freshDb();
    await db.prepare("INSERT INTO seasons (label, cutoff_date, unranked_gap_days) VALUES ('Live', '2099-01-01', 0)").run();
    await expect(runImport(db, legacyFixture, options())).rejects.toThrow(/already open/);
  });

  it("hard-fails when a rating period would exceed the single D1 batch limit", async () => {
    const db = await freshDb();
    const big: LegacySnapshotRow[] = [];
    for (let i = 0; i < 100; i++) {
      const symbol = `AGENT_${String(i).padStart(3, "0")}`;
      big.push({
        reset_date: "2024-11-01",
        observed_at: "2024-11-01T00:00",
        agent_symbol: symbol,
        credits: 1000 + i,
        credit_rank: i + 1,
        total_agents: 100,
        ship_count: 1,
      });
    }
    await expect(runImport(db, big, options({ registerAllAgents: true }))).rejects.toThrow(
      /single-batch limit/,
    );
  });

  it("throws when the legacy export has no usable rows", async () => {
    const db = await freshDb();
    await expect(runImport(db, [], options())).rejects.toThrow(/no usable snapshot rows/);
  });
});
