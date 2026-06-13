import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { getSeasonById, updateOpenSeason } from "../db/seasons";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  createSeason,
  currentSeason,
  listSeasons,
  updateSeason,
} from "./season-service";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

describe("createSeason validation", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("accepts a valid season and defaults the gap to 0", async () => {
    const result = await createSeason(db, { label: "  S1  ", cutoff_date: "2026-09-01" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe("S1");
      expect(result.value.unranked_gap_days).toBe(0);
      expect(result.value.closed_at).toBeNull();
    }
  });

  it("rejects an empty or oversized label", async () => {
    expect(await createSeason(db, { label: ' '.repeat(3), cutoff_date: "2026-09-01" })).toMatchObject({
      ok: false,
      reason: "invalid_label",
    });
    expect(
      await createSeason(db, { label: "x".repeat(101), cutoff_date: "2026-09-01" }),
    ).toMatchObject({ ok: false, reason: "invalid_label" });
  });

  it("rejects a malformed or non-calendar cutoff date", async () => {
    expect(await createSeason(db, { label: "S1", cutoff_date: "2026/09/01" })).toMatchObject({
      ok: false,
      reason: "invalid_cutoff",
    });
    // Well-formed but not a real date (Feb 30).
    expect(await createSeason(db, { label: "S1", cutoff_date: "2026-02-30" })).toMatchObject({
      ok: false,
      reason: "invalid_cutoff",
    });
  });

  it("rejects a negative or non-integer gap", async () => {
    expect(
      await createSeason(db, { label: "S1", cutoff_date: "2026-09-01", unranked_gap_days: -1 }),
    ).toMatchObject({ ok: false, reason: "invalid_gap" });
    expect(
      await createSeason(db, { label: "S1", cutoff_date: "2026-09-01", unranked_gap_days: 1.5 }),
    ).toMatchObject({ ok: false, reason: "invalid_gap" });
  });

  it("rejects a second open season", async () => {
    await createSeason(db, { label: "S1", cutoff_date: "2026-09-01" });
    expect(await createSeason(db, { label: "S2", cutoff_date: "2026-10-01" })).toMatchObject({
      ok: false,
      reason: "open_season_exists",
    });
  });
});

describe("updateSeason", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("updates only the provided fields", async () => {
    const created = await createSeason(db, {
      label: "S1",
      cutoff_date: "2026-09-01",
      unranked_gap_days: 2,
    });
    if (!created.ok) throw new Error("setup failed");

    const updated = await updateSeason(db, created.value.id, { cutoff_date: "2026-09-20" });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.cutoff_date).toBe("2026-09-20");
      expect(updated.value.unranked_gap_days).toBe(2); // unchanged
    }
  });

  it("validates inputs", async () => {
    const created = await createSeason(db, { label: "S1", cutoff_date: "2026-09-01" });
    if (!created.ok) throw new Error("setup failed");
    expect(
      await updateSeason(db, created.value.id, { cutoff_date: "bad" }),
    ).toMatchObject({ ok: false, reason: "invalid_cutoff" });
    expect(
      await updateSeason(db, created.value.id, { unranked_gap_days: -3 }),
    ).toMatchObject({ ok: false, reason: "invalid_gap" });
  });

  it("returns not_found for an unknown or closed season", async () => {
    expect(await updateSeason(db, 999, { unranked_gap_days: 1 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });

    const created = await createSeason(db, { label: "S1", cutoff_date: "2026-09-01" });
    if (!created.ok) throw new Error("setup failed");
    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(created.value.id)
      .run();
    expect(await updateSeason(db, created.value.id, { unranked_gap_days: 1 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("is a no-op (returns the row) when no fields are supplied", async () => {
    const created = await createSeason(db, { label: "S1", cutoff_date: "2026-09-01" });
    if (!created.ok) throw new Error("setup failed");
    const result = await updateSeason(db, created.value.id, {});
    expect(result.ok).toBe(true);
    // updateOpenSeason with no fields short-circuits to the current row.
    expect(await updateOpenSeason(db, created.value.id, {})).not.toBeNull();
  });
});

describe("listSeasons + currentSeason", () => {
  it("reports the open season and lists all seasons newest first", async () => {
    const db = await freshDb();
    expect(await currentSeason(db)).toBeNull();

    const s1 = await createSeason(db, { label: "S1", cutoff_date: "2026-09-01" });
    if (!s1.ok) throw new Error("setup failed");
    expect((await currentSeason(db))!.id).toBe(s1.value.id);

    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(s1.value.id)
      .run();
    await createSeason(db, { label: "S2", cutoff_date: "2026-10-01" });

    const all = await listSeasons(db);
    expect(all.map((s) => s.label)).toEqual(["S2", "S1"]);
    expect(await getSeasonById(db, s1.value.id)).not.toBeNull();
  });
});
