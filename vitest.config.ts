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
        // Enforced by CI — raise after adding tests, never lower.
        // Current: 2388 tests, 60.99% lines, 53.09% branches.
        lines: 60,
        statements: 59,
        functions: 63,
        branches: 53,
      },
    },
  },
});
