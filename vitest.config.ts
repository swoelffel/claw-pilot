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
        // Engineering excellence: 1972 tests, coverage ~57.5% lines.
        // Enforced by CI — raise after adding tests, never lower.
        lines: 57,
        statements: 56,
        functions: 60,
        branches: 50,
      },
    },
  },
});
