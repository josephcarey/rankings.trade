import { error } from "@sveltejs/kit";

import type { PageLoad } from "./$types";

import { findModule, toTopic } from "../../../lib/content/rules";
import { ruleModules } from "../../../lib/content/rules-registry";

/**
 * Resolves the requested help topic's serializable metadata, or returns a 404
 * for an unknown slug. The compiled markdown component itself is rendered in
 * `+page.svelte` (component refs are not serializable load data).
 */
export const load: PageLoad = ({ params }) => {
  const module = findModule(ruleModules, params.slug);
  const topic = module ? toTopic(params.slug, module) : null;
  if (!topic) {
    error(404, "Help topic not found.");
  }

  return { topic };
};
