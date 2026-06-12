/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Agent,
  claimAgent,
  createAgent,
  getAgentById,
  getAgentBySymbol,
  isValidSymbol,
  listAgentsByOwner,
  normalizeSymbol,
  recordOwnershipEvent,
  setAgentOwner,
} from "./agents";

// ---------------------------------------------------------------------------
// In-memory SQLite adapter (mirrors the one in users.test.ts; `all` returns the
// D1 `{ results }` shape so production destructuring works under test too).
// ---------------------------------------------------------------------------

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
  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
}

// Mirrors migrations/0003_agents.sql (the audit + agents tables exercised here).
const SCHEMA = `
  CREATE TABLE agents (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT     NOT NULL UNIQUE
                           CHECK (symbol = UPPER(symbol) AND LENGTH(symbol) BETWEEN 3 AND 20),
    display_name  TEXT     NULL,
    owner_user_id INTEGER  NULL,
    verified      INTEGER  NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agent_ownership_events (
    id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
    agent_id            INTEGER  NOT NULL,
    event_type          TEXT     NOT NULL
                                 CHECK (event_type IN ('claim', 'transfer', 'admin_release')),
    actor_user_id       INTEGER  NULL,
    prior_owner_user_id INTEGER  NULL,
    new_owner_user_id   INTEGER  NULL,
    reason              TEXT     NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const sqliteDb = new SQL.Database();
  sqliteDb.run(SCHEMA);
  return new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
}

async function countEvents(db: D1Database, agentId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM agent_ownership_events WHERE agent_id = ?")
    .bind(agentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeSymbol", () => {
  it("trims and upper-cases", () => {
    expect(normalizeSymbol("  rankbot ")).toBe("RANKBOT");
  });
});

describe("isValidSymbol", () => {
  it.each([
    ["RANKBOT", true],
    ["A1_-Z", true],
    ["AB", false], // too short
    ["A".repeat(21), false], // too long
    ["bad lower", false], // space + lowercase
    ["WITH.DOT", false], // disallowed char
  ])("validates %s -> %s", (symbol, expected) => {
    expect(isValidSymbol(symbol)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createAgent / getters
// ---------------------------------------------------------------------------

describe("createAgent", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("creates an unclaimed, unverified agent and normalizes the symbol", async () => {
    const agent = await createAgent(db, { symbol: " rankbot " });
    expect(agent.symbol).toBe("RANKBOT");
    expect(agent.owner_user_id).toBeNull();
    expect(agent.verified).toBe(0);
  });

  it("creates an already-owned agent when given an owner", async () => {
    const agent = await createAgent(db, { symbol: "OWNED", owner_user_id: 7 });
    expect(agent.owner_user_id).toBe(7);
  });

  it("throws on an invalid symbol", async () => {
    await expect(createAgent(db, { symbol: "no" })).rejects.toThrow(/invalid symbol/);
  });
});

describe("getAgentBySymbol / getAgentById", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns null when nothing matches", async () => {
    expect(await getAgentBySymbol(db, "NOPE")).toBeNull();
    expect(await getAgentById(db, 999)).toBeNull();
  });

  it("finds by normalized symbol and by id", async () => {
    const created = await createAgent(db, { symbol: "FINDME" });
    const bySymbol = await getAgentBySymbol(db, "  findme ");
    const byId = await getAgentById(db, created.id);
    expect(bySymbol?.id).toBe(created.id);
    expect(byId?.symbol).toBe("FINDME");
  });
});

describe("listAgentsByOwner", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns only the owner's agents, newest first", async () => {
    await createAgent(db, { symbol: "MINE1", owner_user_id: 1 });
    await createAgent(db, { symbol: "MINE2", owner_user_id: 1 });
    await createAgent(db, { symbol: "THEIRS", owner_user_id: 2 });
    await createAgent(db, { symbol: "UNOWNED" });

    const mine = await listAgentsByOwner(db, 1);
    expect(mine.map((a: Agent) => a.symbol)).toEqual(["MINE2", "MINE1"]);
  });

  it("returns an empty array when the user owns nothing", async () => {
    expect(await listAgentsByOwner(db, 42)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// claimAgent — the one-active-owner invariant
// ---------------------------------------------------------------------------

describe("claimAgent", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("claims an unseen symbol, creating the row and a claim audit event", async () => {
    const result = await claimAgent(db, " rankbot ", 1);
    expect(result.status).toBe("claimed");
    expect(result.agent?.symbol).toBe("RANKBOT");
    expect(result.agent?.owner_user_id).toBe(1);
    expect(result.agent?.verified).toBe(0);
    expect(await countEvents(db, result.agent!.id)).toBe(1);
  });

  it("claims a pre-seeded unclaimed agent", async () => {
    const seeded = await createAgent(db, { symbol: "SCRAPED" });
    const result = await claimAgent(db, "SCRAPED", 5);
    expect(result.status).toBe("claimed");
    expect(result.agent?.id).toBe(seeded.id);
    expect(result.agent?.owner_user_id).toBe(5);
  });

  it("is idempotent for the existing owner (already_owner, no new event)", async () => {
    const first = await claimAgent(db, "DUP", 1);
    const again = await claimAgent(db, "DUP", 1);
    expect(again.status).toBe("already_owner");
    expect(await countEvents(db, first.agent!.id)).toBe(1);
  });

  it("rejects a second user claiming an owned agent (already_claimed)", async () => {
    const first = await claimAgent(db, "CONTESTED", 1);
    const second = await claimAgent(db, "CONTESTED", 2);
    expect(second.status).toBe("already_claimed");
    expect(second.agent?.owner_user_id).toBe(1);
    // The conditional upsert never overwrote the owner.
    const reread = await getAgentBySymbol(db, "CONTESTED");
    expect(reread?.owner_user_id).toBe(1);
    expect(await countEvents(db, first.agent!.id)).toBe(1);
  });

  it("returns invalid_symbol without writing anything", async () => {
    const result = await claimAgent(db, "x", 1);
    expect(result.status).toBe("invalid_symbol");
    expect(result.agent).toBeNull();
    expect(await getAgentBySymbol(db, "x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setAgentOwner / recordOwnershipEvent
// ---------------------------------------------------------------------------

describe("setAgentOwner", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("changes and clears the owner", async () => {
    const agent = await createAgent(db, { symbol: "MOVE", owner_user_id: 1 });
    const moved = await setAgentOwner(db, agent.id, 2);
    expect(moved?.owner_user_id).toBe(2);
    const cleared = await setAgentOwner(db, agent.id, null);
    expect(cleared?.owner_user_id).toBeNull();
  });
});

describe("recordOwnershipEvent", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("persists a transfer event with actor and owner fields", async () => {
    const agent = await createAgent(db, { symbol: "AUDIT", owner_user_id: 1 });
    await recordOwnershipEvent(db, {
      agent_id: agent.id,
      event_type: "transfer",
      actor_user_id: 99,
      prior_owner_user_id: 1,
      new_owner_user_id: 2,
      reason: "dispute resolved",
    });
    const row = await db
      .prepare("SELECT * FROM agent_ownership_events WHERE agent_id = ?")
      .bind(agent.id)
      .first<Record<string, unknown>>();
    expect(row?.event_type).toBe("transfer");
    expect(row?.actor_user_id).toBe(99);
    expect(row?.prior_owner_user_id).toBe(1);
    expect(row?.new_owner_user_id).toBe(2);
    expect(row?.reason).toBe("dispute resolved");
  });
});
