let counter = 0;

/**
 * Deterministic per-instance id suffix for wiring `aria-controls`/`id` pairs.
 *
 * The counter advances in component-render order, which is identical on the
 * server and the client, so SSR-rendered ids hydrate without mismatch.
 */
export function uid(): string {
  counter += 1;
  return counter.toString(36);
}
