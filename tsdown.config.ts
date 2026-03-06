import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3", "@hono/node-server"],
  // Disable tree-shaking: rolldown aggressively eliminates property assignments
  // on objects that are serialized via JSON.stringify / c.json() at runtime.
  treeshake: false,
});
