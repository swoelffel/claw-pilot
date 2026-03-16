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
        // Lowered after PLAN-15e (memory decay/writer — filesystem+LLM I/O, hard to unit-test)
        lines: 49,
        statements: 49,
        functions: 76,
        branches: 72,
      },
    },
  },
});
