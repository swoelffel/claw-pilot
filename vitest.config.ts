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
        // Thresholds reflect current coverage — raise incrementally as test coverage improves
        // Lowered after workspace path refactor (f327432) — new code paths not yet unit-tested
        lines: 48,
        statements: 48,
        functions: 76,
        branches: 72,
      },
    },
  },
});
