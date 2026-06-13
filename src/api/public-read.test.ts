/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { CloudflareBindings } from "../platform";

import { generateToken } from "../lib/agents/token";
import { insertToken } from "../lib/db/agent-tokens";
import { createAgent } from "../lib/db/agents";
import { addMember } from "../lib/db/league-members";
import { createLeague } from "../lib/db/leagues";
import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { insertSeason, upsertSeasonStandings } from "../lib/db/seasons";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import { createPublicRateLimiter } from "../lib/read-api/rate-limit";
import { createPublicReadApi } from "./public-read";

const migrationsDir = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

let db: D1Database;

/** Mount the public-read router with optional limiter/clock injection. */
function makeApi(deps: Parameters<typeof createPublicReadApi>[0] = {}) {
  const api = new Hono<{ Bindings: CloudflareBindings }>();
  api.use("*", async (context, next) => {
    context.env = { DB: db } as never;
    await next();
  });
  api.route("/", createPublicReadApi(deps));
  return api;
}

/** Request a path and return the parsed JSON body (intermediate `res` avoids await-member lint). */
async function fetchJson(
  api: ReturnType<typeof makeApi>,
  path: string,
  init?: RequestInit,
): Promise<any> {
  const res = await api.request(path, init as never);
  return (await res.json()) as any;
}

async function insertRating(
  agentId: number,
  seasonId: number,
  rating: number,
  rd = 50,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO ratings (agent_id, season_id, rating, rd, volatility) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(agentId, seasonId, rating, rd, 0.06)
    .run();
}

/** Insert an open season; optionally stamp it closed so a later season is the open one. */
async function makeSeason(label: string, closed = false): Promise<number> {
  const season = await insertSeason(db, {
    label,
    cutoff_date: "2026-09-01",
    unranked_gap_days: 0,
  });
  if (closed) {
    await db
      .prepare(
        "UPDATE seasons SET closed_at = '2026-01-01 00:00:00' WHERE id = ?",
      )
      .bind(season.id)
      .run();
  }
  return season.id;
}

async function insertSnapshot(
  symbol: string,
  resetDate: string,
  observedAt: string,
  credits: number,
  creditRank: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots
        (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(resetDate, observedAt, symbol, credits, creditRank, 100, 5, "COSMIC")
    .run();
}

/** Insert a finalized round and return its id. */
async function makeFinalizedRound(resetDate: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO rounds (reset_date, finalized_at, is_ranked)
       VALUES (?, '2026-02-01 00:00:00', 0) RETURNING id`,
    )
    .bind(resetDate)
    .first<{ id: number }>();
  return row!.id;
}

async function insertLeagueStanding(
  roundId: number,
  leagueId: number,
  symbol: string,
  agentId: number,
  credits: number,
  rank: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_standings
        (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(roundId, leagueId, symbol, agentId, credits, rank)
    .run();
}

async function tokenFor(agentId: number, ownerUserId: number): Promise<string> {
  const generated = await generateToken();
  await insertToken(db, {
    agent_id: agentId,
    owner_user_id: ownerUserId,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
    label: "bot",
  });
  return generated.token;
}

beforeEach(async () => {
  const SQL = await Database();
  db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
});

describe("GET /agents/:symbol — open-season scoping (DEC-I2)", () => {
  it("scopes current rating to the OPEN season and never leaks the closed season", async () => {
    const agent = await createAgent(db, { symbol: "MEMBOT", owner_user_id: 7 });
    const closed = await makeSeason("S1", true);
    await insertRating(agent.id, closed, 1800);
    await upsertSeasonStandings(db, [
      {
        season_id: closed,
        agent_id: agent.id,
        final_rating: 1800,
        final_rd: 40,
        final_volatility: 0.06,
        final_rank: 1,
        title: "Captain",
        established: true,
        ranked_rounds: 5,
      },
    ]);
    const open = await makeSeason("S2");
    await insertRating(agent.id, open, 1500);
    await insertSnapshot(
      "MEMBOT",
      "2026-02-15",
      "2026-02-15T00:00:00Z",
      9999,
      2,
    );

    const api = makeApi();
    const res = await api.request("/agents/MEMBOT");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.season.id).toBe(open);
    expect(body.season.label).toBe("S2");
    expect(body.current.season_id).toBe(open);
    expect(body.current.rating).toBe(1500);
    expect(body.credits.credits).toBe(9999);
    expect(body.history).toHaveLength(1);
    expect(body.history[0].title).toBe("Captain");
    expect(body.history[0].final_rating).toBe(1800);
  });

  it("is case-insensitive on the callsign", async () => {
    await createAgent(db, { symbol: "LOWBOT", owner_user_id: 7 });
    const api = makeApi();
    const res = await api.request("/agents/lowbot");
    expect(res.status).toBe(200);
  });

  it("returns null current when there is no open season but still 200s with history", async () => {
    const agent = await createAgent(db, {
      symbol: "HISTBOT",
      owner_user_id: 7,
    });
    const closed = await makeSeason("S1", true);
    await upsertSeasonStandings(db, [
      {
        season_id: closed,
        agent_id: agent.id,
        final_rating: 1700,
        final_rd: 45,
        final_volatility: 0.06,
        final_rank: 2,
        title: "Commander",
        established: true,
        ranked_rounds: 4,
      },
    ]);

    const api = makeApi();
    const res = await api.request("/agents/HISTBOT");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.season).toBeNull();
    expect(body.current).toBeNull();
    expect(body.history).toHaveLength(1);
  });

  it("404s an unknown callsign", async () => {
    const api = makeApi();
    const res = await api.request("/agents/NOBODY");
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });
});

describe("GET /universe/leaderboard — open-season scoping + pagination", () => {
  beforeEach(async () => {
    const closed = await makeSeason("S1", true);
    const ghost = await createAgent(db, { symbol: "GHOST", owner_user_id: 1 });
    await insertRating(ghost.id, closed, 3000); // closed season — must never appear

    const open = await makeSeason("S2");
    for (let i = 0; i < 5; i++) {
      const a = await createAgent(db, { symbol: `LEAD${i}`, owner_user_id: 1 });
      await insertRating(a.id, open, 1500 + i * 10);
    }
  });

  it("returns only open-season agents, ranked, with total before slicing", async () => {
    const api = makeApi();
    const res = await api.request("/universe/leaderboard");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
    expect(body.items[0].rating).toBe(1540); // highest first
    expect(body.items[0].rank).toBe(1);
    // The closed season's 3000-rated GHOST is absent.
    expect(body.items.some((r: any) => r.rating === 3000)).toBe(false);
  });

  it("clamps limit above the max and honours offset", async () => {
    const api = makeApi();
    const big = await fetchJson(api, "/universe/leaderboard?limit=9999");
    expect(big.limit).toBe(100);
    expect(big.items).toHaveLength(5);

    const page = await fetchJson(api, "/universe/leaderboard?limit=2&offset=4");
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(4);
    expect(page.items).toHaveLength(1);
  });

  it("defaults a missing/invalid limit to 25 and a bad offset to 0", async () => {
    const api = makeApi();
    const body = await fetchJson(
      api,
      "/universe/leaderboard?limit=abc&offset=-3",
    );
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(0);
  });

  it("returns an empty page with null season when none is open", async () => {
    // Fresh db without seasons.
    const SQL = await Database();
    db = createSqliteD1(new SQL.Database());
    await runMigrations(db, await loadMigrations(migrationsDir));
    const api = makeApi();
    const body = await fetchJson(api, "/universe/leaderboard");
    expect(body.season).toBeNull();
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });
});

describe("GET /leagues/:id/standings — visibility & IDOR", () => {
  it("serves a public league to anyone", async () => {
    const league = await createLeague(db, {
      name: "Open",
      owner_user_id: 7,
      visibility: "public",
    });
    const agent = await createAgent(db, { symbol: "PUBA", owner_user_id: 7 });
    const round = await makeFinalizedRound("2026-02-10");
    await insertLeagueStanding(round, league.id, "PUBA", agent.id, 500, 1);

    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.league.visibility).toBe("public");
    expect(body.standings).toHaveLength(1);
    expect(body.round.id).toBe(round);
  });

  it("hides a private league from anonymous callers as an indistinguishable 404", async () => {
    const league = await createLeague(db, { name: "Secret", owner_user_id: 7 });
    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("not_found");

    // A non-existent league returns the byte-identical envelope (no existence leak).
    const missing = await api.request(`/leagues/99999/standings`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(body);
  });

  it("grants a private league to a member's token", async () => {
    const league = await createLeague(db, { name: "Secret", owner_user_id: 7 });
    const member = await createAgent(db, {
      symbol: "MEMBERA",
      owner_user_id: 7,
    });
    await addMember(db, { league_id: league.id, agent_id: member.id });
    const round = await makeFinalizedRound("2026-02-10");
    await insertLeagueStanding(round, league.id, "MEMBERA", member.id, 800, 1);
    const token = await tokenFor(member.id, 7);

    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).standings).toHaveLength(1);
  });

  it("grants a private league when the token's owner owns a member agent", async () => {
    const league = await createLeague(db, { name: "Secret", owner_user_id: 7 });
    const member = await createAgent(db, {
      symbol: "MEMBERB",
      owner_user_id: 7,
    });
    await addMember(db, { league_id: league.id, agent_id: member.id });
    // A different agent owned by the same user 7 — not itself a member.
    const sibling = await createAgent(db, {
      symbol: "SIBLING",
      owner_user_id: 7,
    });
    const token = await tokenFor(sibling.id, 7);

    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("404s a private league for a non-member token (IDOR-safe)", async () => {
    const league = await createLeague(db, { name: "Secret", owner_user_id: 7 });
    const outsider = await createAgent(db, {
      symbol: "OUTSIDER",
      owner_user_id: 9,
    });
    const token = await tokenFor(outsider.id, 9);

    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("treats an invalid/garbage token as anonymous (404, never an auth error)", async () => {
    const league = await createLeague(db, { name: "Secret", owner_user_id: 7 });
    const api = makeApi();
    const res = await api.request(`/leagues/${league.id}/standings`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });

  it("returns round:null and empty standings for a league with no finalized rounds", async () => {
    const league = await createLeague(db, {
      name: "Empty",
      owner_user_id: 7,
      visibility: "public",
    });
    const api = makeApi();
    const body = await fetchJson(api, `/leagues/${league.id}/standings`);
    expect(body.round).toBeNull();
    expect(body.standings).toEqual([]);
  });
});

describe("GET /seasons/current", () => {
  it("returns the open season", async () => {
    const open = await makeSeason("S2");
    const api = makeApi();
    const body = await fetchJson(api, "/seasons/current");
    expect(body.season.id).toBe(open);
    expect(body.season.label).toBe("S2");
  });

  it("returns null when no season is open", async () => {
    const api = makeApi();
    const body = await fetchJson(api, "/seasons/current");
    expect(body.season).toBeNull();
  });
});

describe("rate-limit headers", () => {
  it("emits X-RateLimit-* on success and 429s once the budget is spent", async () => {
    const api = makeApi({
      limiter: createPublicRateLimiter({ limit: 2, windowMs: 60_000 }),
      now: () => new Date(1_000_000),
    });

    const first = await api.request("/seasons/current");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("1");
    expect(first.headers.get("X-RateLimit-Reset")).not.toBeNull();

    await api.request("/seasons/current"); // 2nd — still allowed
    const third = await api.request("/seasons/current");
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).not.toBeNull();
    expect(((await third.json()) as any).error.code).toBe("rate_limited");
  });
});

describe("GET /openapi.json", () => {
  it("publishes a valid OpenAPI 3.1 document covering every endpoint", async () => {
    const api = makeApi();
    const res = await api.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as any;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).toSorted()).toEqual([
      "/agents/{symbol}",
      "/leagues/{id}/standings",
      "/seasons/current",
      "/universe/leaderboard",
    ]);
    // Every path declares a GET and every $ref resolves to a defined schema.
    for (const path of Object.values<any>(doc.paths)) {
      expect(path.get).toBeDefined();
    }
    const json = JSON.stringify(doc);
    for (const ref of json.match(/#\/components\/schemas\/(\w+)/g) ?? []) {
      const name = ref.split("/").pop()!;
      expect(doc.components.schemas[name]).toBeDefined();
    }
  });
});
