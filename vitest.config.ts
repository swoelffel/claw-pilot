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
        lines: 50,
        statements: 50,
        functions: 78,
        branches: 72,
      },
    },
  },
});
