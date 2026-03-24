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
        // Ratcheted to current coverage — lowered for @vitest/coverage-v8 v4 recalibration
        lines: 45,
        statements: 44,
        functions: 47,
        branches: 39,
      },
    },
  },
});
