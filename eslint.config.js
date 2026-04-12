// eslint.config.js
//
// Complexity-only ESLint config — runs alongside oxlint (which handles style/lint).
// Only two rules enabled: cognitive complexity + max function length.
// Goal: prevent new complex code; existing violations are baselined and tracked for refactoring.

import sonarjs from "eslint-plugin-sonarjs";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// Files that currently exceed thresholds — tracked for refactoring.
// Remove entries as files are simplified.
const BASELINE_FILES = [
  // Commands
  "src/commands/runtime.ts",
  "src/commands/doctor.ts",
  "src/commands/init.ts",
  "src/commands/team.ts",
  // Core
  "src/core/agent-sync.ts",
  "src/core/blueprint-deployer.ts",
  "src/core/dashboard-service.ts",
  "src/core/provisioner.ts",
  "src/core/team-import.ts",
  // Dashboard routes
  "src/dashboard/routes/instances/config.ts",
  "src/dashboard/routes/instances/runtime.ts",
  "src/dashboard/routes/instances/tasks.ts",
  "src/dashboard/routes/instances/tasks-crud.ts",
  "src/dashboard/routes/instances/flows.ts",
  "src/dashboard/routes/instances/config-patch-handlers.ts",
  "src/dashboard/routes/instances/runtime-chat.ts",
  "src/dashboard/routes/instances/runtime-messages.ts",
  "src/dashboard/routes/instances/lifecycle.ts",
  "src/dashboard/routes/instances/memory.ts",
  "src/dashboard/routes/instances/budgets.ts",
  "src/dashboard/routes/instances/agents/create.ts",
  "src/dashboard/routes/instances/agents/skills.ts",
  "src/dashboard/routes/instances/agents/sync.ts",
  "src/dashboard/routes/blueprints.ts",
  "src/dashboard/routes/agent-blueprints.ts",
  "src/dashboard/routes/teams.ts",
  "src/dashboard/routes/profile.ts",
  "src/dashboard/server.ts",
  "src/dashboard/route-deps.ts",
  // DB
  "src/db/schema.ts",
  // Lib
  "src/lib/guards.ts",
  "src/lib/platform.ts",
  // Runtime — engine & channels
  "src/runtime/channel/router.ts",
  "src/runtime/channel/telegram/channel.ts",
  "src/runtime/channel/telegram/formatter.ts",
  "src/runtime/engine/engine.ts",
  "src/runtime/mcp/client.ts",
  // Runtime — session
  "src/runtime/session/system-prompt.ts",
  "src/runtime/session/prompt-loop.ts",
  "src/runtime/session/message-builder.ts",
  "src/runtime/session/tool-set-builder.ts",
  "src/runtime/memory/index.ts",
  // Runtime — tools
  "src/runtime/tool/built-in/skill.ts",
  "src/runtime/tool/built-in/read.ts",
  "src/runtime/tool/task.ts",
  "src/runtime/tool/task-board.ts",
  "src/runtime/tool/send-message.ts",
  "src/runtime/tool/registry.ts",
  "src/runtime/plugin/system-dashboard/tools.ts",
];

export default [
  // Default: strict thresholds for all new/clean code
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
  // Baseline overrides for known complex files — remove entries as files are refactored
  {
    files: BASELINE_FILES,
    rules: {
      "sonarjs/cognitive-complexity": ["warn", 20],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
];
