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
        // Ratcheted to current coverage — raise after each test batch
        lines: 50,
        statements: 50,
        functions: 77,
        branches: 75,
      },
    },
  },
});
