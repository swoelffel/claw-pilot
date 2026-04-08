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
        // Phase 7 coverage: 2083 tests, coverage ~62% lines.
        // Enforced by CI — raise after adding tests, never lower.
        lines: 61,
        statements: 60,
        functions: 63,
        branches: 53,
      },
    },
  },
});
