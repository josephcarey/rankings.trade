/* eslint-disable security/detect-non-literal-fs-filename */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));
const mergeScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/ops/merge-users.sql", import.meta.url)),
  "utf8",
);

describe("scripts/ops/merge-users.sql", () => {
  let raw: import("sql.js").Database;
  let db: D1Database;
  let agentId: number;
  let leagueId: number;

  beforeEach(async () => {
    const SQL = await Database();
    raw = new SQL.Database();
    db = createSqliteD1(raw);
    const result = await runMigrations(db, await loadMigrations(migrationsDir));
    expect(result.success).toBe(true);

    // Two users: id 1 (stale) and id 10 (canonical). Distinct emails so the
    // 0019 unique index allows the seed; the merge keys on id, not email.
    await db
      .prepare("INSERT INTO users (id, clerk_user_id, email) VALUES (1, 'clerk_old', 'old@example.com'), (10, 'clerk_new', 'new@example.com')")
      .run();
    // References owned by the stale user 1 (auto-assigned ids to avoid colliding
    // with rows seeded by 0005).
    agentId = (await db
      .prepare("INSERT INTO agents (symbol, owner_user_id) VALUES ('ZMERGE', 1) RETURNING id")
      .first<{ id: number }>())!.id;
    leagueId = (await db
      .prepare("INSERT INTO leagues (name, owner_user_id) VALUES ('ZMergeLeague', 1) RETURNING id")
      .first<{ id: number }>())!.id;
    await db
      .prepare("INSERT INTO league_members (league_id, agent_id, added_by_user_id) VALUES (?, ?, 1)")
      .bind(leagueId, agentId)
      .run();
  });

  async function counts() {
    const u = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 1").first<{ n: number }>();
    const a = await db.prepare("SELECT owner_user_id AS o FROM agents WHERE id = ?").bind(agentId).first<{ o: number }>();
    const l = await db.prepare("SELECT owner_user_id AS o FROM leagues WHERE id = ?").bind(leagueId).first<{ o: number }>();
    const m = await db.prepare("SELECT added_by_user_id AS o FROM league_members WHERE league_id = ?").bind(leagueId).first<{ o: number }>();
    return { agent: a?.o, league: l?.o, member: m?.o, user1: u?.n };
  }

  it("repoints all references from user 1 to user 10 and deletes user 1", async () => {
    raw.run(mergeScript);
    expect(await counts()).toEqual({ agent: 10, league: 10, member: 10, user1: 0 });
  });

  it("is idempotent when re-run", async () => {
    raw.run(mergeScript);
    raw.run(mergeScript);
    expect(await counts()).toEqual({ agent: 10, league: 10, member: 10, user1: 0 });
  });

  it("does not delete user 1 when the canonical user 10 is absent (guard)", async () => {
    await db.prepare("DELETE FROM users WHERE id = 10").run();
    raw.run(mergeScript);
    const u = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 1").first<{ n: number }>();
    expect(u?.n).toBe(1);
  });
});
