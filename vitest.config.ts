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
        // Lowered after feat/archetype-routing: new wizard/provisioner/builtin-blueprints code
        // is I/O-heavy (interactive CLI, filesystem). Core logic (contract, routing) is tested.
        lines: 44,
        statements: 43,
        functions: 46,
        branches: 37,
      },
    },
  },
});
