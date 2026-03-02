// src/core/config-updater.ts
//
// Barrel re-export — maintains backward compatibility with existing importers.
// Implementation is split across:
//   - config-types.ts   — interfaces + Zod schema
//   - config-helpers.ts — env parsing, masking, deep-merge (internal)
//   - config-reader.ts  — readInstanceConfig
//   - config-writer.ts  — classifyChanges + applyConfigPatch

export type {
  ProviderEntry,
  InstanceConfigPayload,
  ConfigPatch,
  ChangeClassification,
  ConfigPatchResult,
} from "./config-types.js";

export { ConfigPatchSchema } from "./config-types.js";
export { readInstanceConfig } from "./config-reader.js";
export { classifyChanges, applyConfigPatch } from "./config-writer.js";
