import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getCurrentSnapshotResetDate,
  listCurrentSnapshotSeries,
  listCurrentUniverseSnapshotRanking,
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

  async function insertAgent(symbol: string, displayName: string | null): Promise<void> {
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
      await insertSnap({ reset_date: "2026-06-01", observed_at: "T1", agent_symbol: "A", credits: 1 });
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T1", agent_symbol: "A", credits: 2 });
      expect(await getCurrentSnapshotResetDate(db)).toBe("2026-06-07");
    });
  });

  describe("listCurrentUniverseSnapshotRanking", () => {
    it("is empty when there are no snapshots", async () => {
      expect(await listCurrentUniverseSnapshotRanking(db)).toEqual([]);
    });

    it("uses the latest observed_at bucket per agent, ordered by credits desc", async () => {
      // Older cycle should be ignored entirely.
      await insertSnap({ reset_date: "2026-06-01", observed_at: "T1", agent_symbol: "OLD", credits: 9999 });
      // Current cycle, two buckets — latest wins.
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T1", agent_symbol: "ALPHA", credits: 100, credit_rank: 1, ship_count: 2 });
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T2", agent_symbol: "ALPHA", credits: 500, credit_rank: 1, ship_count: 3 });
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T2", agent_symbol: "BRAVO", credits: 800, credit_rank: 2, ship_count: 5 });
      await insertAgent("ALPHA", "Alpha One");

      const rows = await listCurrentUniverseSnapshotRanking(db);
      expect(rows.map((r) => r.symbol)).toEqual(["BRAVO", "ALPHA"]);
      expect(rows[0]).toMatchObject({ rank: 1, symbol: "BRAVO", credits: 800, ship_count: 5, agent_id: null, display_name: null });
      expect(rows[1]).toMatchObject({ rank: 2, symbol: "ALPHA", credits: 500, ship_count: 3 });
      // Unclaimed OLD-cycle agent must not appear; ALPHA resolves its agents row.
      expect(rows[1]!.agent_id).not.toBeNull();
      expect(rows[1]!.display_name).toBe("Alpha One");
    });

    it("includes unclaimed agents (no agents row) with null agent_id", async () => {
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T1", agent_symbol: "GHOST", credits: 10 });
      const rows = await listCurrentUniverseSnapshotRanking(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ symbol: "GHOST", agent_id: null });
    });
  });

  describe("listCurrentSnapshotSeries", () => {
    it("returns an empty series for null resetDate or no symbols", async () => {
      expect(await listCurrentSnapshotSeries(db, null, ["A"])).toEqual({ observedAts: [], bySymbol: new Map() });
      expect(await listCurrentSnapshotSeries(db, "2026-06-07", [])).toEqual({ observedAts: [], bySymbol: new Map() });
    });

    it("aligns each symbol to a shared ascending observed_at axis with null gaps", async () => {
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T1", agent_symbol: "A", credits: 10 });
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T2", agent_symbol: "A", credits: 20 });
      await insertSnap({ reset_date: "2026-06-07", observed_at: "T2", agent_symbol: "B", credits: 50 });
      // Different cycle — excluded.
      await insertSnap({ reset_date: "2026-06-01", observed_at: "T0", agent_symbol: "A", credits: 1 });

      const series = await listCurrentSnapshotSeries(db, "2026-06-07", ["A", "B"]);
      expect(series.observedAts).toEqual(["T1", "T2"]);
      expect(series.bySymbol.get("A")).toEqual([10, 20]);
      expect(series.bySymbol.get("B")).toEqual([null, 50]);
    });
  });
});
