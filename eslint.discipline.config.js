// eslint.discipline.config.js
//
// Flat config dedicated to discipline gates R1 + R5 (see CLAUDE.md
// §"Discipline Community ↔ Enterprise"). Runs as `pnpm lint:discipline:fast`.
// Kept separate from `eslint.config.js` so the complexity gate stays isolated
// and each job stays single-purpose.

import discipline from "./tools/eslint-plugin-clawpilot-discipline/index.js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: false },
    },
    linterOptions: {
      // Existing `// eslint-disable-next-line @typescript-eslint/...` comments
      // reference rules owned by oxlint. Silence "Definition for rule not
      // found" so this config stays single-purpose (R1 + R5 only).
      reportUnusedDisableDirectives: "off",
    },
    plugins: { discipline, "@typescript-eslint": tsPlugin },
    rules: {
      "discipline/no-enterprise-flag": "error",
      "discipline/no-direct-secret-access": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
];
