declare module "*.md" {
  import type { Component } from "svelte";

  /** Frontmatter parsed by mdsvex from the markdown file. */
  export const metadata: Record<string, unknown>;

  /** The compiled markdown rendered as a Svelte component. */
  const component: Component;
  export default component;
}
