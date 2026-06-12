/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type AgentToken,
  findActiveTokenByHash,
  insertToken,
  isValidLabel,
  listTokensByAgent,
  revokeAllActiveTokensForOwner,
  revokeToken,
  rotateToken,
  touchLastUsed,
} from "./agent-tokens";

// ---------------------------------------------------------------------------
// In-memory SQLite adapter (`all` returns the D1 `{ results }` shape).
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

// Mirrors the agent_tokens table from migrations/0003_agents.sql.
const SCHEMA = `
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
`;

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const sqliteDb = new SQL.Database();
  sqliteDb.run(SCHEMA);
  return new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
}

let seq = 0;
function seed(
  db: D1Database,
  overrides: Partial<Pick<AgentToken, "agent_id" | "owner_user_id" | "label">> & {
    hash?: string;
  } = {},
) {
  seq += 1;
  const hash = overrides.hash ?? `hash_${seq}`;
  return insertToken(db, {
    agent_id: overrides.agent_id ?? 1,
    owner_user_id: overrides.owner_user_id ?? 10,
    token_hash: hash,
    token_prefix: `rtbot_${seq}`,
    label: overrides.label ?? `label ${seq}`,
  });
}

describe("isValidLabel", () => {
  it.each([
    ["a", true],
    ["x".repeat(60), true],
    ["", false],
    ["y".repeat(61), false],
  ])("validates length of %s -> %s", (label, expected) => {
    expect(isValidLabel(label)).toBe(expected);
  });
});

describe("insertToken", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("persists a token with the expected fields", async () => {
    const token = await seed(db, { label: "ci-bot" });
    expect(token.id).toBeGreaterThan(0);
    expect(token.label).toBe("ci-bot");
    expect(token.last_used_at).toBeNull();
    expect(token.revoked_at).toBeNull();
  });

  it("rejects an out-of-bounds label", async () => {
    await expect(
      insertToken(db, {
        agent_id: 1,
        owner_user_id: 10,
        token_hash: "h",
        token_prefix: "p",
        label: "",
      }),
    ).rejects.toThrow(/label must be/);
  });
});

describe("listTokensByAgent", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns active and revoked tokens for the agent, newest first", async () => {
    const first = await seed(db, { agent_id: 1 });
    const second = await seed(db, { agent_id: 1 });
    await seed(db, { agent_id: 2 });
    await revokeToken(db, first.id, 1);

    const tokens = await listTokensByAgent(db, 1);
    expect(tokens.map((t) => t.id)).toEqual([second.id, first.id]);
    expect(tokens.find((t) => t.id === first.id)?.revoked_at).not.toBeNull();
  });
});

describe("findActiveTokenByHash", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("finds an active token by hash", async () => {
    await seed(db, { hash: "live" });
    const found = await findActiveTokenByHash(db, "live");
    expect(found?.token_hash).toBe("live");
  });

  it("returns null for an unknown hash", async () => {
    expect(await findActiveTokenByHash(db, "missing")).toBeNull();
  });

  it("returns null once the token is revoked", async () => {
    const token = await seed(db, { hash: "dead" });
    await revokeToken(db, token.id, token.agent_id);
    expect(await findActiveTokenByHash(db, "dead")).toBeNull();
  });
});

describe("revokeToken", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes a token and is idempotent", async () => {
    const token = await seed(db, { agent_id: 1 });
    const revoked = await revokeToken(db, token.id, 1);
    expect(revoked?.revoked_at).not.toBeNull();
    const firstStamp = revoked?.revoked_at;
    const again = await revokeToken(db, token.id, 1);
    expect(again?.revoked_at).toBe(firstStamp);
  });

  it("refuses to revoke a token belonging to a different agent", async () => {
    const token = await seed(db, { agent_id: 1 });
    expect(await revokeToken(db, token.id, 999)).toBeNull();
    const stillActive = await findActiveTokenByHash(db, token.token_hash);
    expect(stillActive?.id).toBe(token.id);
  });
});

describe("revokeAllActiveTokensForOwner", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes only the named owner's active tokens for the agent", async () => {
    const a = await seed(db, { agent_id: 1, owner_user_id: 10 });
    const b = await seed(db, { agent_id: 1, owner_user_id: 10 });
    const other = await seed(db, { agent_id: 1, owner_user_id: 20 });
    await revokeToken(db, b.id, 1); // already revoked — not counted

    const count = await revokeAllActiveTokensForOwner(db, 1, 10);
    expect(count).toBe(1); // only `a` was active for owner 10
    expect(await findActiveTokenByHash(db, a.token_hash)).toBeNull();
    const otherActive = await findActiveTokenByHash(db, other.token_hash);
    expect(otherActive?.id).toBe(other.id);
  });
});

describe("rotateToken", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes the old token and issues a replacement with the same label", async () => {
    const old = await seed(db, { agent_id: 1, owner_user_id: 10, label: "deploy-key" });
    const fresh = await rotateToken(db, {
      id: old.id,
      agent_id: 1,
      token_hash: "rotated-hash",
      token_prefix: "rtbot_rot",
    });
    expect(fresh?.label).toBe("deploy-key");
    expect(fresh?.owner_user_id).toBe(10);
    expect(fresh?.token_hash).toBe("rotated-hash");
    expect(await findActiveTokenByHash(db, old.token_hash)).toBeNull();
    const rotated = await findActiveTokenByHash(db, "rotated-hash");
    expect(rotated?.id).toBe(fresh?.id);
  });

  it("returns null when the token is unknown or not the agent's", async () => {
    const old = await seed(db, { agent_id: 1 });
    expect(
      await rotateToken(db, {
        id: old.id,
        agent_id: 999,
        token_hash: "x",
        token_prefix: "p",
      }),
    ).toBeNull();
  });
});

describe("touchLastUsed", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("stamps last_used_at", async () => {
    const token = await seed(db);
    await touchLastUsed(db, token.id);
    const touched = await findActiveTokenByHash(db, token.token_hash);
    expect(touched?.last_used_at).not.toBeNull();
  });
});
