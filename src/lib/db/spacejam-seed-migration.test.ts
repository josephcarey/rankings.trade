import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

const ROSTER = [
  "BAMES_JOND",
  "JBARHORST",
  "OLSON_AGENT",
  "S41N7-II",
  "SPACEJAM-DK-2",
  "SPARKY",
  "STARFOX-5",
  "TYLERMASTERY",
  "TYLERMASTERY2",
] as const;

describe("0005_seed_spacejam_league migration", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    db = createSqliteD1(new SQL.Database());

    const migrations = await loadMigrations(migrationsDir);
    const result = await runMigrations(db, migrations);
    expect(result.success).toBe(true);
    expect(result.applied).toContain("0005_seed_spacejam_league");
  });

  it("creates a public, system-owned SpaceJam starter league", async () => {
    const league = await db
      .prepare("SELECT visibility, owner_user_id FROM leagues WHERE name = ?")
      .bind("SpaceJam")
      .first<{ owner_user_id: number | null; visibility: string }>();

    expect(league?.visibility).toBe("public");
    expect(league?.owner_user_id).toBeNull();
  });

  it("seeds the 9 roster agents as unclaimed (no owner, unverified)", async () => {
    for (const symbol of ROSTER) {
      const agent = await db
        .prepare("SELECT owner_user_id, verified FROM agents WHERE symbol = ?")
        .bind(symbol)
        .first<{ owner_user_id: number | null; verified: number }>();

      expect(agent, `agent ${symbol} should exist`).not.toBeNull();
      expect(agent?.owner_user_id).toBeNull();
      expect(agent?.verified).toBe(0);
    }
  });

  it("maps roster display names onto the seeded agents", async () => {
    const christian = await db
      .prepare("SELECT display_name FROM agents WHERE symbol = ?")
      .bind("BAMES_JOND")
      .first<{ display_name: string | null }>();

    expect(christian?.display_name).toBe("Christian");
  });

  it("adds exactly 9 active members to the SpaceJam league", async () => {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM league_members lm
           JOIN leagues l ON l.id = lm.league_id
          WHERE l.name = ? AND lm.left_at IS NULL`,
      )
      .bind("SpaceJam")
      .first<{ n: number }>();

    expect(row?.n).toBe(9);
  });

  it("does not duplicate agents already present before the seed", async () => {
    // S41N7-II is a legacy dev callsign that may pre-exist; the seed uses
    // INSERT OR IGNORE so there is never a duplicate row for any symbol.
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM agents WHERE symbol = ?")
      .bind("S41N7-II")
      .first<{ n: number }>();

    expect(row?.n).toBe(1);
  });
});
