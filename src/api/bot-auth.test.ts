/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BotVariables } from "./bot-auth";

import { generateToken } from "../lib/agents/token";
import { insertToken, revokeToken } from "../lib/db/agent-tokens";
import { createAgent } from "../lib/db/agents";
import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import { logger } from "../logger";
import {
  createRequireAgentToken,
  parseBearer,
  requireAgentToken,
  shouldRefreshLastUsed,
} from "./bot-auth";

const migrationsDir = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

/**
 * Wrap a D1 facade so the advisory `touchLastUsed` write fails, simulating a transient D1
 * error on an otherwise-valid auth (audit §6.3). Every other statement passes through.
 */
function dbWithFailingTouch(inner: D1Database): D1Database {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== "prepare") return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        if (sql.includes("UPDATE agent_tokens SET last_used_at")) {
          throw new Error("simulated transient D1 failure");
        }
        return target.prepare(sql);
      };
    },
  });
}

function sqliteTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function get(app: Hono<{ Variables: BotVariables }>, auth?: string) {
  return app.request("/whoami", auth ? { headers: { Authorization: auth } } : {});
}

describe("parseBearer", () => {
  it("returns the token from a well-formed header", () => {
    expect(parseBearer("Bearer rtbot_abc")).toBe("rtbot_abc");
    expect(parseBearer("  Bearer rtbot_abc  ")).toBe("rtbot_abc");
  });

  it.each([null, undefined, "", "rtbot_abc", "Basic abc", "Bearer", "Bearer "])(
    "rejects %j",
    (header) => {
      expect(parseBearer(header as never)).toBeNull();
    },
  );
});

describe("shouldRefreshLastUsed", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("refreshes when never used", () => {
    expect(shouldRefreshLastUsed(null, now)).toBe(true);
  });

  it("refreshes when older than the threshold", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:49:00", now)).toBe(true);
  });

  it("does not refresh when within the threshold", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:55:00", now)).toBe(false);
  });

  it("refreshes exactly at the threshold boundary", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:50:00", now)).toBe(true);
  });

  it("refreshes on an unparseable timestamp", () => {
    expect(shouldRefreshLastUsed("not-a-date", now)).toBe(true);
  });
});

describe("requireAgentToken middleware", () => {
  let db: D1Database;
  let agentId: number;

  beforeEach(async () => {
    const SQL = await Database();
    db = createSqliteD1(new SQL.Database());
    const result = await runMigrations(db, await loadMigrations(migrationsDir));
    expect(result.success).toBe(true);
    // The migrations seed agents, so capture the real id rather than assuming 1.
    const agent = await createAgent(db, { owner_user_id: 7, symbol: "RANKBOT" });
    agentId = agent.id;
  });

  async function seedToken() {
    const generated = await generateToken();
    const row = await insertToken(db, {
      agent_id: agentId,
      label: "bot",
      owner_user_id: 7,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
    });
    return { raw: generated.token, row };
  }

  function botApp(now?: () => Date) {
    const app = new Hono<{ Variables: BotVariables }>();
    app.use("*", async (context, next) => {
      context.env = { DB: db } as never;
      await next();
    });
    app.use("*", now ? createRequireAgentToken({ now }) : requireAgentToken);
    app.get("/whoami", (context) =>
      context.json({ owner: context.get("agent").owner_user_id, symbol: context.get("agent").symbol }),
    );
    return app;
  }

  it("rejects a request with no Authorization header (401)", async () => {
    const response = await get(botApp());
    expect(response.status).toBe(401);
    expect(((await response.json()) as any).error.code).toBe("unauthorized");
  });

  it("rejects a malformed Authorization header (401)", async () => {
    const response = await get(botApp(), "Basic abc");
    expect(response.status).toBe(401);
  });

  it("rejects an unknown token (401)", async () => {
    const response = await get(botApp(), "Bearer rtbot_unknown");
    expect(response.status).toBe(401);
  });

  it("rejects a revoked token (401)", async () => {
    const { raw, row } = await seedToken();
    await revokeToken(db, row.id, agentId);
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("rejects a token whose snapshot owner no longer matches the agent (401)", async () => {
    const { raw } = await seedToken();
    // Ownership moved on (e.g. an admin transfer): the token's owner snapshot (7)
    // no longer equals the agent's current owner. Fail closed even though the
    // token row itself is not revoked.
    await db
      .prepare("UPDATE agents SET owner_user_id = ? WHERE id = ?")
      .bind(8, agentId)
      .run();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("rejects a token after its agent is released to unowned (401)", async () => {
    const { raw } = await seedToken();
    await db.prepare("UPDATE agents SET owner_user_id = NULL WHERE id = ?").bind(agentId).run();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("accepts a valid token and exposes the agent to handlers", async () => {
    const { raw } = await seedToken();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ owner: 7, symbol: "RANKBOT" });
  });

  it("stamps last_used_at on first use, then throttles a recent token", async () => {
    const { raw, row } = await seedToken();

    // Recently used (1 minute ago) → within throttle window → no rewrite.
    const recent = sqliteTime(new Date(Date.now() - 60 * 1000));
    await db
      .prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?")
      .bind(recent, row.id)
      .run();
    await get(botApp(), `Bearer ${raw}`);
    const afterRecent = await db
      .prepare("SELECT last_used_at AS t FROM agent_tokens WHERE id = ?")
      .bind(row.id)
      .first<{ t: string }>();
    expect(afterRecent?.t).toBe(recent);
  });

  it("rewrites last_used_at when the stored value is stale", async () => {
    const { raw, row } = await seedToken();

    const stale = sqliteTime(new Date(Date.now() - 30 * 60 * 1000));
    await db
      .prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?")
      .bind(stale, row.id)
      .run();
    await get(botApp(), `Bearer ${raw}`);
    const after = await db
      .prepare("SELECT last_used_at AS t FROM agent_tokens WHERE id = ?")
      .bind(row.id)
      .first<{ t: string }>();
    expect(after?.t).not.toBe(stale);
  });

  it("still authenticates when the advisory last_used_at write fails (§6.3)", async () => {
    const { raw, row } = await seedToken();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const app = new Hono<{ Variables: BotVariables }>();
    app.use("*", async (context, next) => {
      context.env = { DB: dbWithFailingTouch(db) } as never;
      await next();
    });
    app.use("*", requireAgentToken);
    app.get("/whoami", (context) =>
      context.json({ symbol: context.get("agent").symbol }),
    );

    // Auth must succeed even though touchLastUsed throws — the write is advisory.
    const response = await app.request("/whoami", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ symbol: "RANKBOT" });
    expect(warn).toHaveBeenCalledWith(
      "touchLastUsed failed",
      expect.objectContaining({ tokenId: row.id }),
    );

    // The failed advisory write left last_used_at untouched.
    const after = await db
      .prepare("SELECT last_used_at AS t FROM agent_tokens WHERE id = ?")
      .bind(row.id)
      .first<{ t: null | string }>();
    expect(after?.t).toBeNull();

    warn.mockRestore();
  });
});
