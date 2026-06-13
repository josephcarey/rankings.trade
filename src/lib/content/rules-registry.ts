import type { MarkdownModule, MarkdownModules } from "./rules";

/**
 * Eagerly-globbed registry of every rules/help markdown topic, compiled to
 * Svelte components by mdsvex at build time. Keyed by absolute module path
 * (e.g. `/src/content/rules/leagues.md`); resolve entries with the helpers in
 * `./rules`.
 */
export const ruleModules: MarkdownModules = import.meta.glob<MarkdownModule>(
  "/src/content/rules/*.md",
  { eager: true },
);
