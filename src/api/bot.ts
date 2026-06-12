import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { BotVariables } from "./bot-auth";

import { requireAgentToken } from "./bot-auth";

type BotEnv = {
  Bindings: CloudflareBindings;
  Variables: BotVariables;
};

/**
 * Builds the bot-only `/api/bot` router. Every route requires a valid per-agent
 * Bearer token (see {@link requireAgentToken}); a Clerk session does not apply.
 *
 * `/whoami` is the representative endpoint demonstrating end-to-end protection:
 * it echoes the authenticated agent resolved from the token.
 */
export function createBotApi() {
  const app = new Hono<BotEnv>();
  app.use("*", requireAgentToken);

  app.get("/whoami", (context) => {
    const agent = context.get("agent");
    return context.json({
      agent: {
        id: agent.id,
        owner_user_id: agent.owner_user_id,
        symbol: agent.symbol,
        verified: agent.verified,
      },
    });
  });

  return app;
}
