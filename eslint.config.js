import js from "@eslint/js";
import depend from "eslint-plugin-depend";
import perfectionist from "eslint-plugin-perfectionist";
import security from "eslint-plugin-security";
import svelte from "eslint-plugin-svelte";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".svelte-kit/**",
      ".trellis/**",
      ".wrangler/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "kanban/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  unicorn.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
  depend.configs["flat/recommended"],
  security.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "perfectionist/sort-enums": "off",
      "perfectionist/sort-interfaces": "off",
      "perfectionist/sort-intersection-types": "off",
      "perfectionist/sort-modules": "off",
      "perfectionist/sort-objects": "off",
      "perfectionist/sort-object-types": "off",
      "perfectionist/sort-union-types": "off",
      "security/detect-object-injection": "off",
      "unicorn/import-style": "off",
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: [".svelte"],
        parser: tseslint.parser,
      },
    },
  },
);
