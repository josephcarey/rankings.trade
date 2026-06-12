import type { Handle } from "@sveltejs/kit";

import { sequence } from "@sveltejs/kit/hooks";
import { withClerkHandler } from "svelte-clerk/server";

import { api } from "./api/app";
import { clerkSessionHandle } from "./lib/auth/session";

const apiHandle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/api")) {
    return api.fetch(event.request, event.platform?.env);
  }

  return resolve(event);
};

export const handle: Handle = sequence(
  withClerkHandler(),
  clerkSessionHandle(),
  apiHandle,
);
