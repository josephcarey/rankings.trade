/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { insertToken, listTokensByAgent } from "../db/agent-tokens";
import { createAgent, getAgentBySymbol } from "../db/agents";
import { provisionUser } from "../db/users";
import { transferAgentOwnership } from "./ownership-service";

class SQLiteTestStatement {
  private bindings: unknown[] = [];
  constructor(
    private sql: string,
    private db: any,
  ) {}
  async all<T>(): Promise<{ results: T[]; success: true }> {
    const results = this.db.exec(this.sql, this.bindings);
    if (results.length === 0 || !results[0]) return { results: [], success: true };
    const columns = results[0].columns as string[];
    const rows = (results[0].values as unknown[][]).map((values) => {
      const row: Record<string, unknown> = {};
      for (const [index, col] of columns.entries()) row[col] = values[index];
      return row as T;
    });
    return { results: rows, success: true };
  }
  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }
  async first<T>(): Promise<T | undefined> {
    const results = this.db.exec(this.sql, this.bindings);
    if (results.length > 0 && results[0]?.values?.length > 0) {
      const columns = results[0].columns as string[];
      const values = results[0].values[0] as unknown[];
      const row: Record<string, unknown> = {};
      for (const [index, col] of columns.entries()) row[col] = values[index];
      return row as T;
    }
    return undefined;
  }
  async run() {
    this.db.run(this.sql, this.bindings);
    return { success: true };
  }
}

class SQLiteTestDatabase {
  constructor(private db: any) {}
  async batch(statements: SQLiteTestStatement[]) {
    this.db.run("SAVEPOINT batch_sp");
    try {
      const out = [];
      for (const st of statements) out.push(await st.run());
      this.db.run("RELEASE batch_sp");
      return out;
    } catch (error) {
      this.db.run("ROLLBACK TO batch_sp");
      this.db.run("RELEASE batch_sp");
      throw error;
    }
  }
  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
}

const SCHEMA = `
  CREATE TABLE users (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    clerk_user_id TEXT     NOT NULL UNIQUE,
    email         TEXT     NULL,
    display_name  TEXT     NULL,
    visibility    TEXT     NOT NULL DEFAULT 'public',
    dashboard_url TEXT     NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agents (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT     NOT NULL UNIQUE,
    display_name  TEXT     NULL,
    owner_user_id INTEGER  NULL,
    verified      INTEGER  NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agent_tokens (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    agent_id      INTEGER  NOT NULL,
    owner_user_id INTEGER  NOT NULL,
    token_hash    TEXT     NOT NULL UNIQUE,
    token_prefix  TEXT     NOT NULL,
    label         TEXT     NOT NULL CHECK (LENGTH(label) BETWEEN 1 AND 60),
    last_used_at  DATETIME NULL,
    revoked_at    DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agent_ownership_events (
    id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
    agent_id            INTEGER  NOT NULL,
    event_type          TEXT     NOT NULL,
    actor_user_id       INTEGER  NULL,
    prior_owner_user_id INTEGER  NULL,
    new_owner_user_id   INTEGER  NULL,
    reason              TEXT     NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

let hashSeq = 0;
async function seedToken(
  db: D1Database,
  agentId: number,
  ownerUserId: number,
  label = "tok",
) {
  hashSeq += 1;
  return insertToken(db, {
    agent_id: agentId,
    label,
    owner_user_id: ownerUserId,
    token_hash: `hash_${hashSeq}`,
    token_prefix: `rtbot_${hashSeq}`,
  });
}

async function userId(db: D1Database, clerkId: string): Promise<number> {
  const row = await db
    .prepare("SELECT id FROM users WHERE clerk_user_id = ?")
    .bind(clerkId)
    .first<{ id: number }>();
  return row?.id as number;
}

async function events(db: D1Database, agentId: number) {
  const { results } = await db
    .prepare("SELECT * FROM agent_ownership_events WHERE agent_id = ? ORDER BY id")
    .bind(agentId)
    .all<any>();
  return results;
}

describe("transferAgentOwnership", () => {
  let db: D1Database;
  let adminId: number;
  let aliceId: number;
  let bobId: number;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await provisionUser(db, { clerk_user_id: "user_admin", display_name: "Admin", email: null });
    await provisionUser(db, { clerk_user_id: "user_alice", display_name: "Alice", email: null });
    await provisionUser(db, { clerk_user_id: "user_bob", display_name: "Bob", email: null });
    adminId = await userId(db, "user_admin");
    aliceId = await userId(db, "user_alice");
    bobId = await userId(db, "user_bob");
  });

  it("transfers an owned agent, revoking only the prior owner's active tokens, and audits it", async () => {
    const agent = await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    await seedToken(db, agent.id, aliceId, "alice-1");
    await seedToken(db, agent.id, aliceId, "alice-2");
    // A pre-existing token Bob already holds for this agent must survive his transfer-in.
    const bobToken = await seedToken(db, agent.id, bobId, "bob-old");

    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      newOwnerClerkId: "user_bob",
      reason: "ownership dispute resolved",
      symbol: "rankbot",
    });

    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.value.agent.owner_user_id).toBe(bobId);
    expect(result.value.priorOwnerUserId).toBe(aliceId);
    expect(result.value.revokedTokens).toBe(2);

    const tokens = await listTokensByAgent(db, agent.id);
    const aliceTokens = tokens.filter((t) => t.owner_user_id === aliceId);
    expect(aliceTokens.every((t) => t.revoked_at !== null)).toBe(true);
    const survived = tokens.find((t) => t.id === bobToken.id);
    expect(survived?.revoked_at).toBeNull();

    const log = await events(db, agent.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor_user_id: adminId,
      event_type: "transfer",
      new_owner_user_id: bobId,
      prior_owner_user_id: aliceId,
      reason: "ownership dispute resolved",
    });
  });

  it("transfers an unowned agent with no revocation and a null prior owner in the audit", async () => {
    const agent = await createAgent(db, { owner_user_id: null, symbol: "FREEBOT" });

    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      newOwnerClerkId: "user_alice",
      symbol: "FREEBOT",
    });

    if (!result.ok) throw new Error("expected ok");
    expect(result.value.revokedTokens).toBe(0);
    expect(result.value.priorOwnerUserId).toBeNull();

    const log = await events(db, agent.id);
    expect(log[0]?.prior_owner_user_id).toBeNull();
    expect(log[0]?.new_owner_user_id).toBe(aliceId);
  });

  it("returns agent_not_found for an unknown callsign", async () => {
    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      newOwnerClerkId: "user_bob",
      symbol: "NOSUCH",
    });
    expect(result).toEqual({ ok: false, reason: "agent_not_found" });
  });

  it("returns user_not_found for an unknown target user, without mutating", async () => {
    await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      newOwnerClerkId: "user_ghost",
      symbol: "RANKBOT",
    });
    expect(result).toEqual({ ok: false, reason: "user_not_found" });
    const agent = await getAgentBySymbol(db, "RANKBOT");
    expect(agent?.owner_user_id).toBe(aliceId);
  });

  it("returns unchanged when transferring to the current owner (no token revocation)", async () => {
    const agent = await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    await seedToken(db, agent.id, aliceId, "keep");

    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      newOwnerClerkId: "user_alice",
      symbol: "RANKBOT",
    });

    expect(result).toEqual({ ok: false, reason: "unchanged" });
    const tokens = await listTokensByAgent(db, agent.id);
    expect(tokens[0]?.revoked_at).toBeNull();
  });

  it.each([
    ["empty target id", { newOwnerClerkId: " ".repeat(3), reason: null }],
    ["overlong reason", { newOwnerClerkId: "user_bob", reason: "x".repeat(501) }],
  ])("returns invalid_input for %s", async (_name, overrides) => {
    await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    const result = await transferAgentOwnership(db, {
      actorUserId: adminId,
      symbol: "RANKBOT",
      ...overrides,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("is all-or-nothing: a failure in the batch leaves the owner and tokens untouched", async () => {
    const agent = await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    const aliceToken = await seedToken(db, agent.id, aliceId, "alice-1");
    // Force the audit insert (last statement in the atomic batch) to fail so the
    // whole transfer — including the owner change and token revocation — rolls back.
    await db.prepare("DROP TABLE agent_ownership_events").run();

    await expect(
      transferAgentOwnership(db, {
        actorUserId: adminId,
        newOwnerClerkId: "user_bob",
        symbol: "RANKBOT",
      }),
    ).rejects.toBeTruthy();

    const after = await getAgentBySymbol(db, "RANKBOT");
    expect(after?.owner_user_id).toBe(aliceId); // owner change rolled back
    const tokens = await listTokensByAgent(db, agent.id);
    const survived = tokens.find((t) => t.id === aliceToken.id);
    expect(survived?.revoked_at).toBeNull(); // prior owner's token still active
  });

  it("returns conflict and writes nothing when ownership changes mid-transfer", async () => {
    const agent = await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
    const aliceToken = await seedToken(db, agent.id, aliceId, "alice-1");

    // Simulate a concurrent transfer (to a third user) landing just before our
    // atomic batch runs, so our compare-and-set matches no rows.
    const racing = {
      batch: async (statements: unknown[]) => {
        await db
          .prepare("UPDATE agents SET owner_user_id = ? WHERE symbol = ?")
          .bind(adminId, "RANKBOT")
          .run();
        return (db as any).batch(statements);
      },
      prepare: (sql: string) => db.prepare(sql),
    } as unknown as D1Database;

    const result = await transferAgentOwnership(racing, {
      actorUserId: adminId,
      newOwnerClerkId: "user_bob",
      symbol: "RANKBOT",
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    // The gated revoke/audit were no-ops: the prior owner's token is untouched
    // and no transfer event was recorded.
    const tokens = await listTokensByAgent(db, agent.id);
    expect(tokens.find((t) => t.id === aliceToken.id)?.revoked_at).toBeNull();
    expect(await events(db, agent.id)).toHaveLength(0);
  });
});
