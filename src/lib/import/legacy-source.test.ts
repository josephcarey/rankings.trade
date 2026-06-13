/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  loadLegacyFromJson,
  loadLegacyFromSqliteFile,
  readLegacySnapshots,
} from "./legacy-source";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "legacy-source-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Build an in-memory legacy sqlite database with the old SpaceJam schema. */
async function legacyDb(): Promise<InstanceType<Awaited<ReturnType<typeof Database>>["Database"]>> {
  const SQL = await Database();
  const db = new SQL.Database();
  db.run(
    `CREATE TABLE snapshots (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       reset_date TEXT, observed_at TEXT, agent_symbol TEXT,
       credits INTEGER, credit_rank INTEGER, chart_count INTEGER, chart_rank INTEGER,
       ship_count INTEGER, total_agents INTEGER
     )`,
  );
  db.run(
    `INSERT INTO snapshots
       (reset_date, observed_at, agent_symbol, credits, credit_rank, chart_count, chart_rank, ship_count, total_agents)
     VALUES ('2024-11-01','2024-11-01T00:00','BAMES_JOND',1000,1,3,1,2,2),
            ('2024-11-01','2024-11-01T00:00','JBARHORST',800,2,NULL,NULL,1,2)`,
  );
  return db;
}

describe("readLegacySnapshots", () => {
  it("reads the legacy columns into loose rows", async () => {
    const rows = readLegacySnapshots(await legacyDb());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reset_date: "2024-11-01",
      agent_symbol: "BAMES_JOND",
      credits: 1000,
      ship_count: 2,
      total_agents: 2,
    });
  });

  it("returns an empty array for an empty table", async () => {
    const SQL = await Database();
    const db = new SQL.Database();
    db.run(
      `CREATE TABLE snapshots (
         reset_date TEXT, observed_at TEXT, agent_symbol TEXT,
         credits INTEGER, credit_rank INTEGER, ship_count INTEGER, total_agents INTEGER
       )`,
    );
    expect(readLegacySnapshots(db)).toEqual([]);
  });
});

describe("loadLegacyFromSqliteFile", () => {
  it("reads rows from a sqlite file on disk", async () => {
    const db = await legacyDb();
    const path = join(dir, "legacy.sqlite");
    await writeFile(path, Buffer.from(db.export()));
    const rows = await loadLegacyFromSqliteFile(path, () => Database());
    expect(rows.map((r) => r.agent_symbol)).toEqual(["BAMES_JOND", "JBARHORST"]);
  });
});

describe("loadLegacyFromJson", () => {
  it("reads a flat JSON array of rows", async () => {
    const path = join(dir, "legacy.json");
    await writeFile(
      path,
      JSON.stringify([
        { reset_date: "2024-11-01", observed_at: "t0", agent_symbol: "A", credits: 1 },
      ]),
    );
    const rows = await loadLegacyFromJson(path);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent_symbol).toBe("A");
  });

  it("rejects a non-array JSON export", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, JSON.stringify({ not: "an array" }));
    await expect(loadLegacyFromJson(path)).rejects.toThrow(/must be an array/);
  });

  it("rejects a row missing a required string field", async () => {
    const path = join(dir, "bad-row.json");
    await writeFile(path, JSON.stringify([{ reset_date: "2024-11-01", observed_at: "t0" }]));
    await expect(loadLegacyFromJson(path)).rejects.toThrow(/missing string field/);
  });
});
