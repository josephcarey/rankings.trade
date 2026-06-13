import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    coverage: {
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/vitest-setup-client.ts",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        lines: 80,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          environment: "node",
          exclude: ["src/**/*.svelte.test.ts"],
          include: ["src/**/*.test.ts"],
          name: "server",
        },
      },
      {
        extends: true,
        plugins: [svelteTesting()],
        test: {
          environment: "jsdom",
          include: ["src/**/*.svelte.test.ts"],
          name: "client",
          setupFiles: ["./src/vitest-setup-client.ts"],
        },
      },
    ],
  },
});
