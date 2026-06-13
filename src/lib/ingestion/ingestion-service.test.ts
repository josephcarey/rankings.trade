import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "../db/agents";
import { loadMigrations } from "../db/loader";
import { listLogsByAgent } from "../db/logs";
import { runMigrations } from "../db/migrate";
import { listMilestonesByAgent } from "../db/milestones";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  enforceRateLimit,
  submitLog,
  submitMilestone,
} from "./ingestion-service";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function seedTokenAndAgent(db: D1Database): Promise<{ agentId: number; tokenId: number }> {
  const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
  const token = await db
    .prepare(
      `INSERT INTO agent_tokens (agent_id, owner_user_id, token_hash, token_prefix, label)
       VALUES (?, 7, 'hash', 'rtbot_a', 'bot') RETURNING id`,
    )
    .bind(agent.id)
    .first<{ id: number }>();
  return { agentId: agent.id, tokenId: token?.id ?? 0 };
}

describe("submitLog", () => {
  let db: D1Database;
  let agentId: number;
  beforeEach(async () => {
    db = await makeDb();
    ({ agentId } = await seedTokenAndAgent(db));
  });

  it("stores a trimmed log line", async () => {
    const result = await submitLog(db, agentId, "  jumped to X1-AB  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("jumped to X1-AB");
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.length).toBe(1);
  });

  it("rejects empty/oversized text without writing", async () => {
    expect(await submitLog(db, agentId, ' '.repeat(3))).toEqual({ ok: false, reason: "invalid_text" });
    expect(await submitLog(db, agentId, "a".repeat(2001))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.length).toBe(0);
  });
});

describe("submitMilestone", () => {
  let db: D1Database;
  let agentId: number;
  beforeEach(async () => {
    db = await makeDb();
    ({ agentId } = await seedTokenAndAgent(db));
  });

  it("stores a recognized default type", async () => {
    const result = await submitMilestone(db, agentId, { type: "first-jump" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("first-jump");
  });

  it("TOLERANTLY stores an unknown but well-formed type", async () => {
    const result = await submitMilestone(db, agentId, {
      type: "  Warp-Core-Online ",
      metadata: { sector: "X1-AB" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("warp-core-online");
      expect(result.value.metadata).toBe('{"sector":"X1-AB"}');
    }
    const milestones = await listMilestonesByAgent(db, agentId);
    expect(milestones.length).toBe(1);
  });

  it("rejects a malformed type without writing", async () => {
    expect(await submitMilestone(db, agentId, { type: "has space" })).toEqual({
      ok: false,
      reason: "invalid_type",
    });
    expect(await submitMilestone(db, agentId, { type: "" })).toEqual({
      ok: false,
      reason: "invalid_type",
    });
    const milestones = await listMilestonesByAgent(db, agentId);
    expect(milestones.length).toBe(0);
  });

  it("rejects non-object or oversized metadata", async () => {
    expect(await submitMilestone(db, agentId, { type: "first-jump", metadata: [1, 2] })).toEqual({
      ok: false,
      reason: "invalid_metadata",
    });
    expect(
      await submitMilestone(db, agentId, {
        type: "first-jump",
        metadata: { blob: "x".repeat(5000) },
      }),
    ).toEqual({ ok: false, reason: "invalid_metadata" });
  });
});

describe("enforceRateLimit", () => {
  let db: D1Database;
  let tokenId: number;
  beforeEach(async () => {
    db = await makeDb();
    ({ tokenId } = await seedTokenAndAgent(db));
  });

  it("allows up to the limit then blocks within a window", async () => {
    const config = { windowMs: 60_000, limit: 3 };
    const t = 10_000; // 10s into window 0
    for (let i = 1; i <= 3; i++) {
      const d = await enforceRateLimit(db, tokenId, t, config);
      expect(d.allowed).toBe(true);
      expect(d.count).toBe(i);
    }
    const blocked = await enforceRateLimit(db, tokenId, t, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfter).toBe(50);
  });

  it("resets in a new window", async () => {
    const config = { windowMs: 60_000, limit: 1 };
    const first = await enforceRateLimit(db, tokenId, 0, config);
    expect(first.allowed).toBe(true);
    const second = await enforceRateLimit(db, tokenId, 0, config);
    expect(second.allowed).toBe(false);
    // Next window.
    const third = await enforceRateLimit(db, tokenId, 60_000, config);
    expect(third.allowed).toBe(true);
  });
});
