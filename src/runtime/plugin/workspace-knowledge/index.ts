// src/runtime/plugin/workspace-knowledge/index.ts
//
// Plugin that exposes ws_list_files and ws_search_files to every agent.
// Lets an agent discover and search the user- or agent-created files in its
// workspace without those files having to enter the system prompt.

import type { Plugin } from "../types.js";
import { createWorkspaceKnowledgeTools } from "./tools.js";

export const workspaceKnowledgePlugin: Plugin = (input) => {
  if (!input.db) return {};
  return {
    tools: () => createWorkspaceKnowledgeTools(input.db, input.instanceSlug, input.workDir),
  };
};
