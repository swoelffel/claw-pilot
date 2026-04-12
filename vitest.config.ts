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
        // Quality session: 2157 tests, coverage ~60% lines.
        // Enforced by CI — raise after adding tests, never lower.
        lines: 59,
        statements: 58,
        functions: 61,
        branches: 52,
      },
    },
  },
});
