import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "../leagues/league-service";

import { createAgent } from "../db/agents";
import { loadMigrations } from "../db/loader";
import { insertLog, listLogsByAgent } from "../db/logs";
import { runMigrations } from "../db/migrate";
import { insertMilestone, listMilestonesByAgent } from "../db/milestones";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  canModerateAgentContent,
  deleteLog,
  deleteMilestone,
  listAgentLogsForModerator,
} from "./moderation-service";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

const OWNER: Actor = { userId: 7, isAdmin: false };
const ADMIN: Actor = { userId: 99, isAdmin: true };
const STRANGER: Actor = { userId: 2, isAdmin: false };

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

describe("canModerateAgentContent", () => {
  let db: D1Database;
  let ownedId: number;
  let unclaimedId: number;
  beforeEach(async () => {
    db = await makeDb();
    const owned = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    ownedId = owned.id;
    const unclaimed = await createAgent(db, { symbol: "SCRAPED" });
    unclaimedId = unclaimed.id;
  });

  it("allows the agent owner and any admin", async () => {
    expect(await canModerateAgentContent(db, OWNER, ownedId)).toBe(true);
    expect(await canModerateAgentContent(db, ADMIN, ownedId)).toBe(true);
  });

  it("denies a stranger", async () => {
    expect(await canModerateAgentContent(db, STRANGER, ownedId)).toBe(false);
  });

  it("denies everyone but an admin on an unclaimed agent", async () => {
    expect(await canModerateAgentContent(db, STRANGER, unclaimedId)).toBe(false);
    expect(await canModerateAgentContent(db, OWNER, unclaimedId)).toBe(false);
    expect(await canModerateAgentContent(db, ADMIN, unclaimedId)).toBe(true);
  });
});

describe("deleteLog", () => {
  let db: D1Database;
  let agentId: number;
  let logId: number;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    agentId = agent.id;
    const log = await insertLog(db, { agent_id: agentId, text: "spam" });
    logId = log.id;
  });

  it("lets the owner soft-delete and records the moderator + reason", async () => {
    const result = await deleteLog(db, OWNER, logId, "abuse");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.moderated_by_user_id).toBe(7);
      expect(result.value.moderation_reason).toBe("abuse");
    }
    expect(await listLogsByAgent(db, agentId)).toEqual([]);
  });

  it("lets an admin soft-delete", async () => {
    const result = await deleteLog(db, ADMIN, logId);
    expect(result.ok).toBe(true);
  });

  it("hides another owner's content from a stranger (not_found, IDOR) without deleting", async () => {
    const result = await deleteLog(db, STRANGER, logId);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.length).toBe(1);
  });

  it("returns not_found for an unknown id (same shape as unauthorized)", async () => {
    expect(await deleteLog(db, OWNER, 9999)).toEqual({ ok: false, reason: "not_found" });
  });

  it("is idempotent: a second delete returns not_found", async () => {
    const first = await deleteLog(db, OWNER, logId);
    expect(first.ok).toBe(true);
    expect(await deleteLog(db, OWNER, logId)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("deleteMilestone", () => {
  let db: D1Database;
  let agentId: number;
  let milestoneId: number;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    agentId = agent.id;
    const milestone = await insertMilestone(db, {
      agent_id: agentId,
      type: "first-jump",
      metadata: null,
    });
    milestoneId = milestone.id;
  });

  it("lets the owner delete and excludes it from reads", async () => {
    const result = await deleteMilestone(db, OWNER, milestoneId);
    expect(result.ok).toBe(true);
    expect(await listMilestonesByAgent(db, agentId)).toEqual([]);
  });

  it("hides another owner's milestone from a stranger (not_found)", async () => {
    expect(await deleteMilestone(db, STRANGER, milestoneId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    const milestones = await listMilestonesByAgent(db, agentId);
    expect(milestones.length).toBe(1);
  });
});

describe("listAgentLogsForModerator", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
    const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
    const agentId = agent.id;
    await insertLog(db, { agent_id: agentId, text: "one" });
  });

  it("returns logs for the owner and hides existence from a stranger", async () => {
    const owner = await listAgentLogsForModerator(db, OWNER, "RANKBOT");
    expect(owner.ok).toBe(true);
    if (owner.ok) expect(owner.value.length).toBe(1);
    expect(await listAgentLogsForModerator(db, STRANGER, "RANKBOT")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found for an unknown callsign", async () => {
    expect(await listAgentLogsForModerator(db, ADMIN, "NOPE")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
