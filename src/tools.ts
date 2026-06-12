/**
 * This file serves to inform knip that CLI tools are intentionally used via package.json scripts.
 * These are not imported in code but are essential for the build/test/lint pipeline.
 */

// Used in package.json scripts
import "svelte";
import "vite";
import "svelte-check";
import "typescript";
import "knip";
import "eslint";
import "prettier";
import "vitest";
import "@sveltejs/kit";

