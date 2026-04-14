// eslint.config.js
//
// Complexity-only ESLint config — runs alongside oxlint (which handles style/lint).
// Only two rules enabled: cognitive complexity + max function length.
// All code must pass these thresholds — no baseline exceptions.

import sonarjs from "eslint-plugin-sonarjs";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/__tests__/**", "src/e2e/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: false },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    plugins: { sonarjs, "@typescript-eslint": tsPlugin },
    rules: {
      "sonarjs/cognitive-complexity": ["error", 20],
      "max-lines-per-function": [
        "error",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      // Disable @typescript-eslint rules — only loaded so inline eslint-disable
      // comments don't cause "Definition for rule not found" errors.
      // Actual TS lint is handled by oxlint.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  },
];
