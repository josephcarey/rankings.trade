/**
 * The signed-in/out state the nav renders, derived from the request `locals`
 * populated by the Clerk session hook (card #15).
 */
export type NavState = {
  signedIn: boolean;
  userId: string | null;
};

/**
 * Derives the nav's auth state from `locals`.
 *
 * Pure so the nav rendering decision is unit-testable without a live Clerk
 * session: a request is "signed in" exactly when the session hook resolved a
 * Clerk `userId`.
 *
 * @param locals - The request locals carrying the resolved Clerk `userId`.
 * @returns The signed-in flag and the user id (null when signed out).
 */
export function toNavState(locals: { userId: string | null }): NavState {
  return {
    signedIn: locals.userId !== null,
    userId: locals.userId,
  };
}
