import type { Handle } from "@sveltejs/kit";

import { api } from "./api/app";

export const handle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/api")) {
    return api.fetch(event.request, event.platform?.env);
  }

  return resolve(event);
};
