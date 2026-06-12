import type { ProvisionUserInput } from "../db/users";

/**
 * The minimal structural shape of a Clerk backend `User` this app reads.
 *
 * Declared structurally (rather than importing Clerk's `User` class) so the
 * mapper is unit-testable with a plain object and is insensitive to which
 * `@clerk/backend` version supplies the live user.
 */
export type ClerkUserLike = {
  id: string;
  emailAddresses: { emailAddress: string; id: string }[];
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  username: string | null;
};

/**
 * Maps a Clerk user to the local provisioning identity.
 *
 * - `email` is the primary email address (falling back to the first on file).
 * - `display_name` is the full name (first + last), falling back to the
 *   username, else `null`.
 *
 * Pure, so the provisioning identity derivation is unit-testable without a live
 * Clerk user.
 *
 * @param user - A Clerk backend user (or structural equivalent).
 * @returns The identity fields to provision the local user with.
 */
export function clerkIdentity(user: ClerkUserLike): ProvisionUserInput {
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  const email =
    primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;

  const fullName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName = fullName || user.username || null;

  return {
    clerk_user_id: user.id,
    display_name: displayName,
    email,
  };
}
