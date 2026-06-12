import type { Handle } from "@sveltejs/kit";
import type { SessionAuthObject } from "svelte-clerk/server";

/**
 * The minimal authenticated session the app exposes on `event.locals`.
 * Derived from Clerk's auth object but decoupled from the full SDK shape so the
 * rest of the app depends only on what it needs.
 */
export type AppSession = {
  id: string;
  userId: string;
};

/**
 * The Clerk-derived values populated on every request's `event.locals`.
 * Both are `null` for signed-out requests.
 */
export type SessionLocals = {
  session: AppSession | null;
  userId: string | null;
};

/** The subset of Clerk's auth object this module reads. */
type ClerkAuthLike = Pick<SessionAuthObject, "sessionId" | "userId">;

/** Reads the Clerk auth object from the request. Injectable so tests need no live Clerk. */
export type ClerkAuthResolver = (event: Parameters<Handle>[0]["event"]) => ClerkAuthLike;

/**
 * Maps a Clerk auth object to the app's session locals.
 *
 * A session is only considered present when both a user id and session id are
 * available; otherwise the request is treated as signed out.
 *
 * @param auth - The Clerk auth object (e.g. from `event.locals.auth()`).
 * @returns The session and user id to expose on `event.locals`.
 */
export function toSessionLocals(auth: ClerkAuthLike): SessionLocals {
  if (auth.userId && auth.sessionId) {
    return {
      session: { id: auth.sessionId, userId: auth.userId },
      userId: auth.userId,
    };
  }

  return { session: null, userId: null };
}

/**
 * Builds a SvelteKit `Handle` that populates `event.locals.session` and
 * `event.locals.userId` from the Clerk session on every request.
 *
 * Chain it after `withClerkHandler` (which provides `event.locals.auth`) via
 * `@sveltejs/kit/hooks` `sequence()`. The Clerk resolver is injectable so the
 * mapping can be unit-tested with a fake instead of live Clerk calls.
 *
 * @param resolveAuth - How to read the Clerk auth object; defaults to `event.locals.auth()`.
 * @returns A `Handle` that sets the session locals then continues the chain.
 */
export function clerkSessionHandle(
  resolveAuth: ClerkAuthResolver = (event) => event.locals.auth(),
): Handle {
  return ({ event, resolve }) => {
    const { session, userId } = toSessionLocals(resolveAuth(event));
    event.locals.session = session;
    event.locals.userId = userId;
    return resolve(event);
  };
}
