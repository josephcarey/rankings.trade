import * as v from "valibot";

import { SYMBOL_PATTERN } from "../../lib/db/agents";

/**
 * Agent-claim form schema. The callsign is trimmed and upper-cased before
 * validation so users can type any case, and must match the canonical symbol
 * format (3–20 chars: A–Z, 0–9, `_`, `-`). The transform means `form.data.symbol`
 * is already normalized when it reaches the claim helper.
 */
export const claimSchema = v.object({
  symbol: v.pipe(
    v.string(),
    v.trim(),
    v.transform((value) => value.toUpperCase()),
    v.regex(
      SYMBOL_PATTERN,
      "Use 3–20 characters: letters, numbers, underscore or hyphen.",
    ),
  ),
});
