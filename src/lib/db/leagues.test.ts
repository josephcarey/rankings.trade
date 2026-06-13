import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createLeague,
  getLeagueById,
  isValidLeagueName,
  type League,
  listLeaguesByOwner,
  listPublicLeagues,
  updateLeague,
  type Visibility,
} from "./leagues";
import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

describe("isValidLeagueName", () => {
  it("accepts 1-80 char names and rejects empty/blank/too-long", () => {
    expect(isValidLeagueName("A")).toBe(true);
    expect(isValidLeagueName("x".repeat(80))).toBe(true);
    expect(isValidLeagueName("")).toBe(false);
    expect(isValidLeagueName(' '.repeat(3))).toBe(false);
    expect(isValidLeagueName("x".repeat(81))).toBe(false);
  });
});

describe("createLeague", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("creates a private league by default and trims the name", async () => {
    const league = await createLeague(db, { name: "  Friends  ", owner_user_id: 1 });
    expect(league.name).toBe("Friends");
    expect(league.visibility).toBe("private");
    expect(league.description).toBeNull();
    expect(league.owner_user_id).toBe(1);
  });

  it("honours an explicit visibility and description", async () => {
    const visibility: Visibility = "public";
    const league = await createLeague(db, {
      name: "Open",
      owner_user_id: 2,
      visibility,
      description: "An opt-in challenge",
    });
    expect(league.visibility).toBe("public");
    expect(league.description).toBe("An opt-in challenge");
  });

  it("rejects an invalid name", async () => {
    await expect(
      createLeague(db, { name: ' '.repeat(3), owner_user_id: 1 }),
    ).rejects.toThrow();
  });
});

describe("league reads", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("getLeagueById returns the row or null", async () => {
    const created = await createLeague(db, { name: "L", owner_user_id: 1 });
    const found = await getLeagueById(db, created.id);
    expect(found?.id).toBe(created.id);
    expect(await getLeagueById(db, 9999)).toBeNull();
  });

  it("listLeaguesByOwner returns only that owner's leagues", async () => {
    await createLeague(db, { name: "A", owner_user_id: 1 });
    await createLeague(db, { name: "B", owner_user_id: 1 });
    await createLeague(db, { name: "C", owner_user_id: 2 });

    const ownerOne = await listLeaguesByOwner(db, 1);
    expect(ownerOne.map((l: League) => l.name).toSorted()).toEqual(["A", "B"]);
  });

  it("listPublicLeagues returns only public leagues", async () => {
    await createLeague(db, { name: "Priv", owner_user_id: 1 });
    await createLeague(db, { name: "Pub", owner_user_id: 1, visibility: "public" });

    const publics = await listPublicLeagues(db);
    expect(publics.map((l: League) => l.name)).toEqual(["Pub"]);
  });
});

describe("updateLeague", () => {
  let db: D1Database;
  let id: number;
  beforeEach(async () => {
    db = await makeDb();
    const created = await createLeague(db, { name: "Orig", owner_user_id: 1 });
    id = created.id;
  });

  it("renames and changes visibility", async () => {
    const updated = await updateLeague(db, id, { name: "Renamed", visibility: "public" });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.visibility).toBe("public");
  });

  it("sets and clears the description", async () => {
    const withDesc = await updateLeague(db, id, { description: "hello" });
    expect(withDesc?.description).toBe("hello");
    const cleared = await updateLeague(db, id, { description: null });
    expect(cleared?.description).toBeNull();
  });

  it("returns the unchanged league when no fields are given", async () => {
    const same = await updateLeague(db, id, {});
    expect(same?.name).toBe("Orig");
  });

  it("rejects an invalid new name", async () => {
    await expect(updateLeague(db, id, { name: "" })).rejects.toThrow();
  });

  it("returns null for an unknown league", async () => {
    expect(await updateLeague(db, 4242, { name: "X" })).toBeNull();
  });
});
