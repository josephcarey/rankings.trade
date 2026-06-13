import * as v from "valibot";

/** Inclusive upper bound for a league description. */
const DESCRIPTION_MAX = 500;

/** Inclusive upper bound for a league name (mirrors the DB `NAME_MAX`). */
const NAME_MAX = 80;

/**
 * Shared league details form schema, used for both creation and management.
 *
 * The name is trimmed and length-bounded; the description is optional (an empty
 * string is treated as "no description" by the page layer); visibility is a
 * closed enum that defaults to `private` to honour private-by-default.
 */
export const leagueDetailsSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "Give your league a name."),
    v.maxLength(NAME_MAX, `Use at most ${NAME_MAX} characters.`),
  ),
  description: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(DESCRIPTION_MAX, `Use at most ${DESCRIPTION_MAX} characters.`),
    ),
    "",
  ),
  visibility: v.optional(v.picklist(["private", "public"]), "private"),
});
