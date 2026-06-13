/**
 * Cross-cutting D1 platform constants.
 *
 * These describe limits of the D1 runtime itself, not any one feature, so they live in a
 * neutral module that feature stores (snapshots, ratings, ...) can import without coupling to
 * each other.
 */

/** D1 rejects batches larger than 100 statements. */
export const D1_MAX_BATCH = 100;
