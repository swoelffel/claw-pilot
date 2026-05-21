import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  outDir: "dist",
  // Only clean CLI output at dist/ root — leave dist/ui/ (produced by `vite build ui/`) untouched.
  // `clean: true` would nuke the entire dist/, breaking `pnpm build:cli` after `pnpm build:ui`.
  clean: ["dist/*.{js,mjs,cjs,map,d.ts,d.mts}"],
  dts: false,
  outExtensions: () => ({ js: ".js" }),
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3", "@hono/node-server"],
  // Disable tree-shaking: rolldown aggressively eliminates property assignments
  // on objects that are serialized via JSON.stringify / c.json() at runtime.
  treeshake: false,
});
