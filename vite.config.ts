import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    coverage: {
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json"],
      thresholds: {
        lines: 80,
      },
    },
    include: ["src/**/*.test.ts"],
  },
});
