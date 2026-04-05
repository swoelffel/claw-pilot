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
        // Phase 6 test coverage: +104 tests covering mime, log-rotate, process,
        // search-tool, channel-factory, request-id, profile routes,
        // agent-blueprint routes, and key-migration.
        lines: 57,
        statements: 56,
        functions: 60,
        branches: 50,
      },
    },
  },
});
