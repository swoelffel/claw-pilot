import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["ui/src/**/__tests__/**/*.test.ts"],
  },
});
