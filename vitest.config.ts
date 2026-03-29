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
        // After feat/skills-management: skills routes + tests added (skills-routes.test.ts).
        lines: 43,
        statements: 38,
        functions: 46,
        branches: 37,
      },
    },
  },
});
