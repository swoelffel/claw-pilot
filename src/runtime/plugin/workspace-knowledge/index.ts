// src/runtime/plugin/workspace-knowledge/index.ts
//
// Plugin that exposes workspace-knowledge tools to every agent. Read tools
// (`ws_list_files`, `ws_search_files`) are always exposed; write tools
// (`ws_write_file`, `ws_delete_file`, `ws_write_shared_file`,
// `ws_delete_shared_file`) are gated by the agent's `fs_write_scope`
// (WS-WRITE-001) — see `tools.ts`.

import type { Plugin } from "../types.js";
import { createWorkspaceKnowledgeTools } from "./tools.js";

export const workspaceKnowledgePlugin: Plugin = (input) => {
  if (!input.db) return {};
  return {
    tools: (ctx) =>
      createWorkspaceKnowledgeTools(input.db, input.instanceSlug, input.workDir, ctx.agentId),
  };
};
