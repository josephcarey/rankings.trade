import type { Component } from "svelte";

/**
 * Order applied to topics whose frontmatter omits a numeric `order`, so they
 * sort after explicitly ordered topics while still appearing on the index.
 */
const UNORDERED = Number.MAX_SAFE_INTEGER;

/**
 * A compiled markdown module as produced by mdsvex and surfaced through Vite's
 * `import.meta.glob`. `default` is the renderable Svelte component; `metadata`
 * holds the parsed frontmatter.
 */
export interface MarkdownModule {
  default: Component;
  metadata?: Record<string, unknown>;
}

/** A map of glob path → compiled markdown module. */
export type MarkdownModules = Record<string, MarkdownModule>;

/** Serializable metadata describing a single rules/help topic. */
export interface RuleTopic {
  order: number;
  slug: string;
  summary: string;
  title: string;
}

/**
 * Derives a URL slug from a content file path (the basename without its
 * extension), e.g. `/src/content/rules/leagues.md` → `leagues`.
 *
 * @param path - The module path from `import.meta.glob`.
 * @returns The lower-cased file basename without directory or `.md` extension.
 */
export function slugFromPath(path: string): string {
  const basename = path.split("/").pop() ?? path;

  return basename.replace(/\.md$/, "");
}

/**
 * Builds serializable {@link RuleTopic} metadata from a markdown module's
 * frontmatter. Returns `null` when required fields (`title`, `summary`) are
 * missing or not strings, so malformed content is skipped rather than crashing
 * the index.
 *
 * @param slug - The topic slug (already derived from the file path).
 * @param module - The compiled markdown module.
 * @returns The topic metadata, or `null` when the frontmatter is invalid.
 */
export function toTopic(slug: string, module: MarkdownModule): RuleTopic | null {
  const metadata = module.metadata ?? {};
  const { order, summary, title } = metadata;

  if (typeof title !== "string" || title.length === 0) {
    return null;
  }
  if (typeof summary !== "string" || summary.length === 0) {
    return null;
  }

  return {
    order: typeof order === "number" ? order : UNORDERED,
    slug,
    summary,
    title,
  };
}

/**
 * Builds the ordered topic index from a map of markdown modules. Topics are
 * sorted by ascending `order`, then alphabetically by `title` as a stable
 * tiebreak. Modules with invalid frontmatter are omitted.
 *
 * @param modules - The map of path → markdown module (from `import.meta.glob`).
 * @returns The list of valid topics in display order.
 */
export function buildTopicIndex(modules: MarkdownModules): RuleTopic[] {
  const topics: RuleTopic[] = [];

  for (const [path, module] of Object.entries(modules)) {
    const topic = toTopic(slugFromPath(path), module);
    if (topic) {
      topics.push(topic);
    }
  }

  return topics.toSorted(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

/**
 * Finds the markdown module whose path resolves to the given slug.
 *
 * @param modules - The map of path → markdown module (from `import.meta.glob`).
 * @param slug - The requested topic slug.
 * @returns The matching module, or `undefined` when no topic matches.
 */
export function findModule(
  modules: MarkdownModules,
  slug: string,
): MarkdownModule | undefined {
  for (const [path, module] of Object.entries(modules)) {
    if (slugFromPath(path) === slug) {
      return module;
    }
  }

  return undefined;
}
