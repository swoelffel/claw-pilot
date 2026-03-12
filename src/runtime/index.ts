/**
 * runtime/index.ts
 *
 * Public API of claw-runtime.
 * Import from here in the rest of claw-pilot.
 */

export * from "./types.js";
export * from "./bus/index.js";
export * from "./permission/index.js";
export * from "./config/index.js";

// Session engine
export * from "./session/index.js";

// Tool system
export * from "./tool/index.js";

// Agent registry
export * from "./agent/index.js";

// Plugin system
export * from "./plugin/index.js";

// MCP integration
export * from "./mcp/index.js";

// Provider exports — explicit to avoid name conflicts with config types
export { MODEL_CATALOG, findModel, getProviderModels } from "./provider/models.js";
export {
  PROVIDER_REGISTRY,
  getProviderDescriptor,
  resolveLanguageModel,
  resolveModel,
} from "./provider/provider.js";
export type { ProviderConfig, ProviderDescriptor, ResolvedModel } from "./provider/provider.js";
export {
  upsertAuthProfile,
  getAuthProfiles,
  removeAuthProfile,
  clearAuthProfiles,
  getNextAvailableProfile,
  markProfileFailed,
  markProfileSuccess,
  classifyFailure,
  exportAuthProfiles,
  importAuthProfiles,
} from "./provider/auth-profiles.js";
