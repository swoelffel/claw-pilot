// src/runtime/plugin/system-tools/index.ts
//
// Plugin that provides direct DB-backed system management tools to the
// system-pilot agent (cp-system). Replaces the old system-dashboard plugin
// which routed everything through the dashboard REST API.

import type { Plugin } from "../types.js";
import { createSystemTools } from "./tools.js";

/** System tools plugin -- provides cp_* tools for managing the ClawPilot installation. */
export const systemToolsPlugin: Plugin = (input) => {
  // Plugin tools require the DB handle (added in v0.73)
  if (!input.db) return {};
  return {
    tools: () => createSystemTools(input.db, input.instanceSlug),
  };
};
