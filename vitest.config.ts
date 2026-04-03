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
        // Phase 3 test coverage: +44 tests covering CLI withContext, schema v24-v26,
        // shell, errors, platform utilities.
        lines: 51,
        statements: 50,
        functions: 53,
        branches: 44,
      },
    },
  },
});
