import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "./agents";
import { recordTokenHit } from "./ingestion-rate";
import { addMember } from "./league-members";
import { loadMigrations } from "./loader";
import { insertLog, listLogsByAgent, softDeleteLog } from "./logs";
import { runMigrations } from "./migrate";
import {
  insertLeagueMilestoneType,
  isGlobalMilestoneType,
  isRecognizedType,
  listGlobalMilestoneTypes,
  listLeagueMilestoneTypes,
} from "./milestone-types";
import {
  getMilestoneById,
  insertMilestone,
  listMilestonesByAgent,
  softDeleteMilestone,
} from "./milestones";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

/** Insert a league directly and return its id. */
async function newLeague(db: D1Database): Promise<number> {
  const row = await db
    .prepare("INSERT INTO leagues (name, visibility) VALUES (?, 'private') RETURNING id")
    .bind("L")
    .first<{ id: number }>();
  return row?.id ?? 0;
}

describe("migration 0006/0007 — bot ingestion schema", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("creates the logs, milestones, milestone_types, and rate-limit tables", async () => {
    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
         AND name IN ('logs','milestones','milestone_types','ingestion_rate_limits')
         ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(tables.results.map((r) => r.name)).toEqual([
      "ingestion_rate_limits",
      "logs",
      "milestone_types",
      "milestones",
    ]);
  });

  it("seeds exactly the six DEC-4 default milestone types", async () => {
    const types = await listGlobalMilestoneTypes(db);
    expect(types.map((t) => t.key)).toEqual([
      "credits-10m",
      "credits-1m",
      "first-jump",
      "first-ship",
      "fleet-size-10",
      "system-charted",
    ]);
  });

  it("re-running the seed migration is idempotent", async () => {
    const again = await runMigrations(db, await loadMigrations(migrationsDir));
    expect(again.applied).toEqual([]);
    const types = await listGlobalMilestoneTypes(db);
    expect(types.length).toBe(6);
  });
});

describe("logs db helpers", () => {
  let db: D1Database;
  let agentId: number;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    agentId = agent.id;
  });

  it("inserts and lists non-deleted logs newest-first", async () => {
    await insertLog(db, { agent_id: agentId, text: "older" });
    await insertLog(db, { agent_id: agentId, text: "newer" });
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.map((l) => l.text)).toEqual(["newer", "older"]);
  });

  it("soft-deletes a log and excludes it from reads", async () => {
    const log = await insertLog(db, { agent_id: agentId, text: "spam" });
    const deleted = await softDeleteLog(db, log.id, 99, "abuse");
    expect(deleted?.deleted_at).not.toBeNull();
    expect(deleted?.moderated_by_user_id).toBe(99);
    expect(deleted?.moderation_reason).toBe("abuse");
    expect(await listLogsByAgent(db, agentId)).toEqual([]);
  });

  it("soft-delete is idempotent and returns null for an unknown id", async () => {
    const log = await insertLog(db, { agent_id: agentId, text: "x" });
    const first = await softDeleteLog(db, log.id, 99, null);
    const second = await softDeleteLog(db, log.id, 1, "other");
    // Second delete does not overwrite the original moderation metadata.
    expect(second?.moderated_by_user_id).toBe(99);
    expect(second?.deleted_at).toBe(first?.deleted_at);
    expect(await softDeleteLog(db, 9999, 1, null)).toBeNull();
  });
});

describe("milestones db helpers", () => {
  let db: D1Database;
  let agentId: number;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    agentId = agent.id;
  });

  it("stores a tolerant unknown type with metadata", async () => {
    const m = await insertMilestone(db, {
      agent_id: agentId,
      type: "warp-core-online",
      metadata: '{"sector":"X1-AB"}',
    });
    expect(m.type).toBe("warp-core-online");
    expect(m.metadata).toBe('{"sector":"X1-AB"}');
    const fetched = await getMilestoneById(db, m.id);
    expect(fetched?.id).toBe(m.id);
  });

  it("lists non-deleted milestones and soft-deletes", async () => {
    const a = await insertMilestone(db, { agent_id: agentId, type: "first-jump", metadata: null });
    await insertMilestone(db, { agent_id: agentId, type: "first-ship", metadata: null });
    await softDeleteMilestone(db, a.id, 99, null);
    const remaining = await listMilestonesByAgent(db, agentId);
    expect(remaining.map((m) => m.type)).toEqual(["first-ship"]);
  });
});

describe("milestone-types registry helpers", () => {
  let db: D1Database;
  let agentId: number;
  let leagueId: number;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    agentId = agent.id;
    leagueId = await newLeague(db);
  });

  it("recognizes global defaults regardless of context", async () => {
    expect(await isGlobalMilestoneType(db, "first-jump")).toBe(true);
    expect(await isRecognizedType(db, "first-jump", agentId)).toBe(true);
    expect(await isRecognizedType(db, "warp-core-online", agentId)).toBe(false);
  });

  it("registers a league custom type, unique per league", async () => {
    const created = await insertLeagueMilestoneType(db, {
      league_id: leagueId,
      key: "boss-down",
      label: "Boss Down",
      created_by_user_id: 7,
    });
    expect(created?.key).toBe("boss-down");
    // Duplicate key in the same league is rejected.
    const dup = await insertLeagueMilestoneType(db, {
      league_id: leagueId,
      key: "boss-down",
      label: null,
      created_by_user_id: 7,
    });
    expect(dup).toBeNull();
    const leagueTypes = await listLeagueMilestoneTypes(db, leagueId);
    expect(leagueTypes.map((t) => t.key)).toEqual([
      "boss-down",
    ]);
  });

  it("recognizes a league custom type only for active members in league context", async () => {
    await insertLeagueMilestoneType(db, {
      league_id: leagueId,
      key: "boss-down",
      label: null,
      created_by_user_id: 7,
    });
    // Not recognized without league context (profile/global view).
    expect(await isRecognizedType(db, "boss-down", agentId)).toBe(false);
    // Not recognized in the league until the agent is an active member.
    expect(await isRecognizedType(db, "boss-down", agentId, leagueId)).toBe(false);

    await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(await isRecognizedType(db, "boss-down", agentId, leagueId)).toBe(true);
  });
});

describe("ingestion rate-limit counter", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
    await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    await db
      .prepare(
        `INSERT INTO agent_tokens (agent_id, owner_user_id, token_hash, token_prefix, label)
         VALUES (1, 7, 'hash', 'rtbot_a', 'bot')`,
      )
      .run();
  });

  it("counts up within a window then resets on a new window", async () => {
    expect(await recordTokenHit(db, 1, 100)).toBe(1);
    expect(await recordTokenHit(db, 1, 100)).toBe(2);
    expect(await recordTokenHit(db, 1, 100)).toBe(3);
    // New window index → counter resets.
    expect(await recordTokenHit(db, 1, 101)).toBe(1);
    expect(await recordTokenHit(db, 1, 101)).toBe(2);
  });

  it("counts each token independently", async () => {
    await db
      .prepare(
        `INSERT INTO agent_tokens (id, agent_id, owner_user_id, token_hash, token_prefix, label)
         VALUES (2, 1, 7, 'hash2', 'rtbot_b', 'bot2')`,
      )
      .run();
    expect(await recordTokenHit(db, 1, 100)).toBe(1);
    expect(await recordTokenHit(db, 2, 100)).toBe(1);
    expect(await recordTokenHit(db, 1, 100)).toBe(2);
  });
});
