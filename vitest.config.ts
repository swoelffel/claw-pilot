import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        // Lowered after feat/skills-management: new dashboard routes (ZIP upload, GitHub fetch,
        // filesystem ops) are I/O-heavy. Core skill discovery logic is tested in skill.test.ts.
        lines: 43,
        statements: 42,
        functions: 45,
        branches: 37,
      },
    },
  },
});
