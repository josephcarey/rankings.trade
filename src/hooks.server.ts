import type { Handle } from "@sveltejs/kit";

import { sequence } from "@sveltejs/kit/hooks";
import { createClerkClient, withClerkHandler } from "svelte-clerk/server";

import { api } from "./api/app";
import { createLocalUserHandle } from "./lib/auth/local-user";
import { clerkSessionHandle } from "./lib/auth/session";

const apiHandle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/api")) {
    return api.fetch(event.request, event.platform?.env);
  }

  return resolve(event);
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
  apiHandle,
);
