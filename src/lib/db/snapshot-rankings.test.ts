import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getCurrentSnapshotResetDate,
  listCurrentSnapshotSeries,
  listCurrentSnapshotSeriesMatrix,
  listCurrentUniverseSnapshotRanking,
  pickDownsampledIndices,
} from "./snapshot-rankings";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const SCHEMA = `
  CREATE TABLE snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reset_date   TEXT    NOT NULL,
    observed_at  TEXT    NOT NULL,
    agent_symbol TEXT    NOT NULL,
    credits      INTEGER,
    credit_rank  INTEGER,
    total_agents INTEGER,
    ship_count   INTEGER,
    faction      TEXT,
    UNIQUE (reset_date, observed_at, agent_symbol)
  );
  CREATE TABLE agents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT NOT NULL UNIQUE,
    display_name  TEXT NULL,
    owner_user_id INTEGER NULL
  );
`;

type SnapRow = {
  reset_date: string;
  observed_at: string;
  agent_symbol: string;
  credits: number | null;
  credit_rank?: number | null;
  ship_count?: number | null;
};

describe("snapshot-rankings", () => {
  let db: D1Database;
  let raw: import("sql.js").Database;

  beforeEach(async () => {
    const SQL = await Database();
    raw = new SQL.Database();
    raw.run(SCHEMA);
    db = createSqliteD1(raw);
  });

  async function insertSnap(row: SnapRow): Promise<void> {
    await db
      .prepare(
        `INSERT INTO snapshots
           (reset_date, observed_at, agent_symbol, credits, credit_rank, ship_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.reset_date,
        row.observed_at,
        row.agent_symbol,
        row.credits,
        row.credit_rank ?? null,
        row.ship_count ?? null,
      )
      .run();
  }

  async function insertAgent(
    symbol: string,
    displayName: string | null,
  ): Promise<void> {
    await db
      .prepare("INSERT INTO agents (symbol, display_name) VALUES (?, ?)")
      .bind(symbol, displayName)
      .run();
  }

  describe("getCurrentSnapshotResetDate", () => {
    it("returns null when there are no snapshots", async () => {
      expect(await getCurrentSnapshotResetDate(db)).toBeNull();
    });

    it("returns the most recent reset_date", async () => {
      await insertSnap({
        reset_date: "2026-06-01",
        observed_at: "T1",
        agent_symbol: "A",
        credits: 1,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T1",
        agent_symbol: "A",
        credits: 2,
      });
      expect(await getCurrentSnapshotResetDate(db)).toBe("2026-06-07");
    });
  });

  describe("listCurrentUniverseSnapshotRanking", () => {
    it("is empty when there are no snapshots", async () => {
      expect(await listCurrentUniverseSnapshotRanking(db)).toEqual([]);
    });

    it("uses the latest observed_at bucket per agent, ordered by credits desc", async () => {
      // Older cycle should be ignored entirely.
      await insertSnap({
        reset_date: "2026-06-01",
        observed_at: "T1",
        agent_symbol: "OLD",
        credits: 9999,
      });
      // Current cycle, two buckets — latest wins.
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T1",
        agent_symbol: "ALPHA",
        credits: 100,
        credit_rank: 1,
        ship_count: 2,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "ALPHA",
        credits: 500,
        credit_rank: 1,
        ship_count: 3,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "BRAVO",
        credits: 800,
        credit_rank: 2,
        ship_count: 5,
      });
      await insertAgent("ALPHA", "Alpha One");

      const rows = await listCurrentUniverseSnapshotRanking(db);
      expect(rows.map((r) => r.symbol)).toEqual(["BRAVO", "ALPHA"]);
      expect(rows[0]).toMatchObject({
        rank: 1,
        symbol: "BRAVO",
        credits: 800,
        ship_count: 5,
        agent_id: null,
        display_name: null,
      });
      expect(rows[1]).toMatchObject({
        rank: 2,
        symbol: "ALPHA",
        credits: 500,
        ship_count: 3,
      });
      // Unclaimed OLD-cycle agent must not appear; ALPHA resolves its agents row.
      expect(rows[1]!.agent_id).not.toBeNull();
      expect(rows[1]!.display_name).toBe("Alpha One");
    });

    it("includes unclaimed agents (no agents row) with null agent_id", async () => {
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T1",
        agent_symbol: "GHOST",
        credits: 10,
      });
      const rows = await listCurrentUniverseSnapshotRanking(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ symbol: "GHOST", agent_id: null });
    });
  });

  describe("listCurrentSnapshotSeries", () => {
    it("returns an empty series for null resetDate or no symbols", async () => {
      expect(await listCurrentSnapshotSeries(db, null, ["A"])).toEqual({
        observedAts: [],
        bySymbol: new Map(),
      });
      expect(await listCurrentSnapshotSeries(db, "2026-06-07", [])).toEqual({
        observedAts: [],
        bySymbol: new Map(),
      });
    });

    it("aligns each symbol to a shared ascending observed_at axis with null gaps", async () => {
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T1",
        agent_symbol: "A",
        credits: 10,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "A",
        credits: 20,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "B",
        credits: 50,
      });
      // Different cycle — excluded.
      await insertSnap({
        reset_date: "2026-06-01",
        observed_at: "T0",
        agent_symbol: "A",
        credits: 1,
      });

      const series = await listCurrentSnapshotSeries(db, "2026-06-07", [
        "A",
        "B",
      ]);
      expect(series.observedAts).toEqual(["T1", "T2"]);
      expect(series.bySymbol.get("A")).toEqual([10, 20]);
      expect(series.bySymbol.get("B")).toEqual([null, 50]);
    });
  });

  describe("pickDownsampledIndices", () => {
    it("returns nothing for non-positive inputs", () => {
      expect(pickDownsampledIndices(0, 10)).toEqual([]);
      expect(pickDownsampledIndices(5, 0)).toEqual([]);
    });

    it("returns every index when length fits within the cap", () => {
      expect(pickDownsampledIndices(3, 10)).toEqual([0, 1, 2]);
      expect(pickDownsampledIndices(4, 4)).toEqual([0, 1, 2, 3]);
    });

    it("keeps only the first index when the cap is 1", () => {
      expect(pickDownsampledIndices(100, 1)).toEqual([0]);
    });

    it("always keeps the first and last and spaces the rest evenly", () => {
      const idx = pickDownsampledIndices(100, 5);
      expect(idx[0]).toBe(0);
      expect(idx.at(-1)).toBe(99);
      expect(idx).toEqual([0, 25, 50, 74, 99]);
    });

    it("dedupes when rounding maps slots onto the same index", () => {
      const idx = pickDownsampledIndices(3, 100);
      // length <= cap, so this is the identity path, but verify no dupes anywhere.
      expect(new Set(idx).size).toBe(idx.length);
    });
  });

  describe("listCurrentSnapshotSeriesMatrix", () => {
    it("returns an empty series for a null resetDate or an empty cycle", async () => {
      expect(await listCurrentSnapshotSeriesMatrix(db, null)).toEqual({
        observedAts: [],
        bySymbol: new Map(),
      });
      expect(await listCurrentSnapshotSeriesMatrix(db, "2026-06-07")).toEqual({
        observedAts: [],
        bySymbol: new Map(),
      });
    });

    it("covers every agent in the cycle with null gaps, ignoring other cycles", async () => {
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T1",
        agent_symbol: "A",
        credits: 10,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "A",
        credits: 20,
      });
      await insertSnap({
        reset_date: "2026-06-07",
        observed_at: "T2",
        agent_symbol: "B",
        credits: 50,
      });
      // Other cycle — must be excluded.
      await insertSnap({
        reset_date: "2026-06-01",
        observed_at: "T0",
        agent_symbol: "Z",
        credits: 1,
      });

      const matrix = await listCurrentSnapshotSeriesMatrix(db, "2026-06-07");
      expect(matrix.observedAts).toEqual(["T1", "T2"]);
      expect([...matrix.bySymbol.keys()].toSorted()).toEqual(["A", "B"]);
      expect(matrix.bySymbol.get("A")).toEqual([10, 20]);
      expect(matrix.bySymbol.get("B")).toEqual([null, 50]);
    });

    it("downsamples the x-axis to the requested column cap, keeping first and last", async () => {
      for (let i = 0; i < 10; i++) {
        await insertSnap({
          reset_date: "2026-06-07",
          observed_at: `T${String(i).padStart(2, "0")}`,
          agent_symbol: "A",
          credits: i * 100,
        });
      }

      const matrix = await listCurrentSnapshotSeriesMatrix(db, "2026-06-07", 3);
      expect(matrix.observedAts).toEqual(["T00", "T05", "T09"]);
      expect(matrix.bySymbol.get("A")).toEqual([0, 500, 900]);
    });
  });
});
