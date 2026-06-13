/**
 * OpenAPI 3.1 description of the public read API (Epic M).
 *
 * Hand-authored (no codegen dependency) and served verbatim at `GET /api/openapi.json`. This is
 * the canonical contract bots integrate against and the document the Epic L rules pages should
 * link to — L links to this spec rather than this module editing L's pages.
 *
 * Every endpoint here is READ-ONLY. The shared error envelope is `{ error: { code, message } }`.
 * "Current" rating/rank/title fields are scoped to the open season (DEC-I2); a closed season's
 * data lives only in the archived season history.
 */

/** OpenAPI version this document conforms to. */
const OPENAPI_VERSION = "3.1.0";

const errorEnvelope = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

const rateLimitHeaders = {
  "X-RateLimit-Limit": {
    description: "Request budget for the current fixed window.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Remaining": {
    description: "Requests remaining in the current window.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Reset": {
    description: "Seconds until the current window resets.",
    schema: { type: "integer" },
  },
} as const;

const notFoundResponse = {
  description:
    "Resource not found (also returned for private leagues the caller may not view).",
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
} as const;

const rateLimitedResponse = {
  description: "Rate limit exceeded.",
  headers: {
    ...rateLimitHeaders,
    "Retry-After": {
      description: "Seconds to wait before retrying.",
      schema: { type: "integer" },
    },
  },
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
} as const;

/** The full OpenAPI document for the public read API. */
export const openApiDocument = {
  openapi: OPENAPI_VERSION,
  info: {
    title: "rankings.trade public read API",
    version: "1.0.0",
    description:
      "Read-only HTTP API for bots and tools to fetch their own and public rankings data. " +
      "All 'current' rating/rank/title values are scoped to the open season.",
  },
  servers: [{ url: "/api", description: "Same-origin API mount." }],
  tags: [
    { name: "agents", description: "Per-agent public data." },
    {
      name: "leagues",
      description: "League standings (private leagues require a bot token).",
    },
    { name: "universe", description: "Open-season Universe leaderboard." },
    { name: "seasons", description: "Season state." },
  ],
  paths: {
    "/agents/{symbol}": {
      get: {
        tags: ["agents"],
        operationId: "getAgent",
        summary:
          "An agent's current open-season standing, live credits, and season history.",
        parameters: [
          {
            name: "symbol",
            in: "path",
            required: true,
            description: "The agent callsign (case-insensitive).",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The agent profile.",
            headers: rateLimitHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentView" },
              },
            },
          },
          "404": notFoundResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/leagues/{id}/standings": {
      get: {
        tags: ["leagues"],
        operationId: "getLeagueStandings",
        summary: "A league's latest finalized standings.",
        description:
          "Public leagues are open. Private leagues require an `Authorization: Bearer <agent " +
          "token>` whose agent is an active member (or whose owner owns an active member); " +
          "otherwise the response is an indistinguishable 404.",
        security: [{}, { agentToken: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The league id.",
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "The league standings.",
            headers: rateLimitHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LeagueStandingsView" },
              },
            },
          },
          "404": notFoundResponse,
          "429": rateLimitedResponse,
        },
      },
    },
    "/universe/leaderboard": {
      get: {
        tags: ["universe"],
        operationId: "getUniverseLeaderboard",
        summary: "The open season's Universe leaderboard, paginated.",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size (1–100, default 25).",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
          {
            name: "offset",
            in: "query",
            required: false,
            description: "Zero-based offset.",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
        ],
        responses: {
          "200": {
            description: "A page of the leaderboard.",
            headers: rateLimitHeaders,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LeaderboardView" },
              },
            },
          },
          "429": rateLimitedResponse,
        },
      },
    },
    "/seasons/current": {
      get: {
        tags: ["seasons"],
        operationId: "getCurrentSeason",
        summary: "The current (open) season state, or null when none is open.",
        responses: {
          "200": {
            description: "The current season state.",
            headers: rateLimitHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["season"],
                  properties: {
                    season: {
                      oneOf: [
                        { $ref: "#/components/schemas/Season" },
                        { type: "null" },
                      ],
                    },
                  },
                },
              },
            },
          },
          "429": rateLimitedResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      agentToken: {
        type: "http",
        scheme: "bearer",
        description: "A per-agent API token (Epic C).",
      },
    },
    schemas: {
      Error: errorEnvelope,
      Season: {
        type: "object",
        required: [
          "id",
          "label",
          "cutoff_date",
          "unranked_gap_days",
          "opened_at",
        ],
        properties: {
          id: { type: "integer" },
          label: { type: "string" },
          cutoff_date: { type: "string" },
          unranked_gap_days: { type: "integer" },
          opened_at: { type: "string" },
          closed_at: { type: ["string", "null"] },
          unranked_until: { type: ["string", "null"] },
        },
      },
      CurrentStanding: {
        type: "object",
        required: [
          "season_id",
          "rank",
          "rating",
          "rd",
          "volatility",
          "established",
          "ranked_rounds",
        ],
        properties: {
          season_id: { type: "integer" },
          rank: { type: "integer" },
          rating: { type: "number" },
          rd: { type: "number" },
          volatility: { type: "number" },
          title: { type: ["string", "null"] },
          established: { type: "boolean" },
          ranked_rounds: { type: "integer" },
        },
      },
      Credits: {
        type: "object",
        required: [
          "credits",
          "credit_rank",
          "total_agents",
          "reset_date",
          "observed_at",
        ],
        properties: {
          credits: { type: "integer" },
          credit_rank: { type: "integer" },
          total_agents: { type: "integer" },
          reset_date: { type: "string" },
          observed_at: { type: "string" },
        },
      },
      AgentHistory: {
        type: "object",
        required: [
          "season_id",
          "label",
          "final_rank",
          "final_rating",
          "established",
          "ranked_rounds",
        ],
        properties: {
          season_id: { type: "integer" },
          label: { type: "string" },
          closed_at: { type: ["string", "null"] },
          final_rank: { type: "integer" },
          final_rating: { type: "number" },
          final_rd: { type: "number" },
          title: { type: ["string", "null"] },
          established: { type: "boolean" },
          ranked_rounds: { type: "integer" },
        },
      },
      AgentView: {
        type: "object",
        required: ["agent", "season", "current", "credits", "history"],
        properties: {
          agent: {
            type: "object",
            required: ["symbol", "display_name", "verified"],
            properties: {
              symbol: { type: "string" },
              display_name: { type: ["string", "null"] },
              verified: { type: "boolean" },
            },
          },
          season: {
            oneOf: [{ $ref: "#/components/schemas/Season" }, { type: "null" }],
          },
          current: {
            oneOf: [
              { $ref: "#/components/schemas/CurrentStanding" },
              { type: "null" },
            ],
          },
          credits: {
            oneOf: [{ $ref: "#/components/schemas/Credits" }, { type: "null" }],
          },
          history: {
            type: "array",
            items: { $ref: "#/components/schemas/AgentHistory" },
          },
        },
      },
      LeagueStandingRow: {
        type: "object",
        required: [
          "rank",
          "agent_symbol",
          "agent_id",
          "credits",
          "participated",
        ],
        properties: {
          rank: { type: "integer" },
          agent_symbol: { type: "string" },
          agent_id: { type: ["integer", "null"] },
          credits: { type: ["integer", "null"] },
          participated: { type: "boolean" },
        },
      },
      LeagueStandingsView: {
        type: "object",
        required: ["league", "round", "standings"],
        properties: {
          league: {
            type: "object",
            required: ["id", "name", "visibility"],
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
              visibility: { type: "string", enum: ["private", "public"] },
            },
          },
          round: {
            oneOf: [
              {
                type: "object",
                required: ["id", "reset_date"],
                properties: {
                  id: { type: "integer" },
                  reset_date: { type: "string" },
                  finalized_at: { type: ["string", "null"] },
                },
              },
              { type: "null" },
            ],
          },
          standings: {
            type: "array",
            items: { $ref: "#/components/schemas/LeagueStandingRow" },
          },
        },
      },
      LeaderboardRow: {
        type: "object",
        required: [
          "rank",
          "agent_id",
          "rating",
          "rd",
          "established",
          "ranked_rounds",
        ],
        properties: {
          rank: { type: "integer" },
          agent_id: { type: "integer" },
          rating: { type: "number" },
          rd: { type: "number" },
          title: { type: ["string", "null"] },
          established: { type: "boolean" },
          ranked_rounds: { type: "integer" },
        },
      },
      LeaderboardView: {
        type: "object",
        required: ["season", "items", "total", "limit", "offset"],
        properties: {
          season: {
            oneOf: [{ $ref: "#/components/schemas/Season" }, { type: "null" }],
          },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/LeaderboardRow" },
          },
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      },
    },
  },
} as const;
