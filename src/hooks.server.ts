import type { Handle } from "@sveltejs/kit";

import { sequence } from "@sveltejs/kit/hooks";
import { createClerkClient, withClerkHandler } from "svelte-clerk/server";

import { api } from "./api/app";
import { requireAuthHandle } from "./lib/auth/guard";
import { createLocalUserHandle } from "./lib/auth/local-user";
import { clerkSessionHandle } from "./lib/auth/session";
import { injectThemeAttribute, parseThemeMode, THEME_COOKIE } from "./lib/theme";

const apiHandle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/api")) {
    return api.fetch(event.request, event.platform?.env);
  }

  return resolve(event);
};

/**
 * Stamps the persisted theme mode onto the server-rendered `<html data-theme>`
 * so first paint matches the user's choice with no flash of the wrong theme.
 * `system` is emitted literally and the CSS `prefers-color-scheme` query
 * decides; explicit `light`/`dark` win over the media query.
 */
const themeHandle: Handle = ({ event, resolve }) => {
  const mode = parseThemeMode(event.cookies.get(THEME_COOKIE));
  return resolve(event, {
    transformPageChunk: ({ html }) => injectThemeAttribute(html, mode),
  });
};

const localUserHandle = createLocalUserHandle({
  fetchClerkUser: (event, userId) => {
    const secretKey = event.platform?.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing required Clerk env var: CLERK_SECRET_KEY");
    }

    return createClerkClient({ secretKey }).users.getUser(userId);
  },
  getDb: (event) => event.platform?.env.DB,
});

export const handle: Handle = sequence(
  withClerkHandler(),
  clerkSessionHandle(),
  localUserHandle,
  requireAuthHandle,
  themeHandle,
  apiHandle,
);
