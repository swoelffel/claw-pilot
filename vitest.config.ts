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
        // Phase 1 test coverage improvement: +151 tests covering compaction, cleanup,
        // middleware pipeline, memory system, built-in middleware, built-in tools.
        lines: 49,
        statements: 48,
        functions: 51,
        branches: 42,
      },
    },
  },
});
