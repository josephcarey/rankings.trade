import type { ClerkSvelteKitMiddlewareOptions } from "svelte-clerk/server";

/**
 * The Clerk keys the app needs at runtime.
 *
 * `publishableKey` is typed against `svelte-clerk`'s own `withClerkHandler`
 * option so card #15's hooks wiring stays in sync with the SDK surface. The
 * publishable key is client-safe; the secret key must never reach the client.
 */
export type ClerkKeys = {
  publishableKey: NonNullable<ClerkSvelteKitMiddlewareOptions["publishableKey"]>;
  secretKey: string;
};

/**
 * The runtime environment shape the Clerk keys are read from.
 *
 * Both values are sourced from the Cloudflare-Worker runtime env established in
 * Epic A (`event.platform.env`): the secret key as a Worker secret, the
 * publishable key as a `PUBLIC_`-prefixed var so SvelteKit can also expose it to
 * the browser for the client SDK in a later card.
 */
export type ClerkKeyEnv = {
  CLERK_SECRET_KEY?: string;
  PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
};

const PUBLISHABLE_KEY_VAR = "PUBLIC_CLERK_PUBLISHABLE_KEY";
const SECRET_KEY_VAR = "CLERK_SECRET_KEY";

/**
 * Reads and validates the Clerk publishable and secret keys from the runtime
 * environment.
 *
 * Missing keys are an unrecoverable startup misconfiguration (the auth layer
 * cannot function without them), so this throws rather than returning a Result.
 *
 * @param env - The runtime env carrying the Clerk vars (e.g. `event.platform.env`).
 * @returns Both validated Clerk keys.
 * @throws If either key is missing or empty.
 */
export function getClerkKeys(env: ClerkKeyEnv): ClerkKeys {
  const publishableKey = env.PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();

  if (!publishableKey) {
    throw new Error(`Missing required Clerk env var: ${PUBLISHABLE_KEY_VAR}`);
  }
  if (!secretKey) {
    throw new Error(`Missing required Clerk env var: ${SECRET_KEY_VAR}`);
  }

  return { publishableKey, secretKey };
}
