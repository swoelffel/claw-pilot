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
