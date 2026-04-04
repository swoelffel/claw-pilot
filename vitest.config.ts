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
        // Phase 5 test coverage: +230 tests covering agent defaults, model catalog,
        // provider resolution, usage tracker, message builder, workspace cache,
        // and 4 repository modules.
        lines: 54,
        statements: 53,
        functions: 57,
        branches: 47,
      },
    },
  },
});
