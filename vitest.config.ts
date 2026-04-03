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
        // Phase 2 test coverage: +90 tests covering tool-set-builder, tool registry,
        // channel router, telegram formatter, plugin system, server/local.
        lines: 50,
        statements: 49,
        functions: 53,
        branches: 43,
      },
    },
  },
});
