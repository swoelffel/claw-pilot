// src/runtime/provider/config-merge.ts
//
// Merges user-level provider config with instance-level config.
//
// Priority: instance overrides user profile (profile = fallback/base).
// This allows shared provider configs across instances while still
// permitting per-instance overrides.

import type { RuntimeConfig } from "../config/index.js";
import type { UserProviderConfig } from "../profile/types.js";

/**
 * Merge user-level providers into an instance RuntimeConfig.
 *
 * Merge rules:
 *   1. Start with user providers as base
 *   2. Instance providers override by provider_id (instance wins)
 *   3. Instance defaultModel overrides user defaultModel if explicitly set
 *
 * Returns a new RuntimeConfig object (does not mutate the input).
 */
export function mergeProviderConfig(
  instanceConfig: RuntimeConfig,
  userProviders: UserProviderConfig[],
  userDefaultModel: string | undefined,
): RuntimeConfig {
  // 1. Merge providers: user base + instance overrides
  const mergedProviders = mergeProviders(instanceConfig.providers, userProviders);

  // 2. Default model: instance wins if set, otherwise user, otherwise original default
  const mergedDefaultModel =
    instanceConfig.defaultModel !== "anthropic/claude-sonnet-4-5" // explicit instance override
      ? instanceConfig.defaultModel
      : (userDefaultModel ?? instanceConfig.defaultModel);

  return {
    ...instanceConfig,
    providers: mergedProviders,
    defaultModel: mergedDefaultModel,
  };
}

/**
 * Merge providers: user-level as base, instance-level overrides by provider_id.
 */
function mergeProviders(
  instanceProviders: RuntimeConfig["providers"],
  userProviders: UserProviderConfig[],
): RuntimeConfig["providers"] {
  // Build a map of instance providers for O(1) lookup
  const instanceMap = new Map(instanceProviders.map((p) => [p.id, p]));

  // Start with user providers, skip those overridden by instance
  const result: RuntimeConfig["providers"] = [];

  for (const userProv of userProviders) {
    if (!instanceMap.has(userProv.providerId)) {
      // User provider not overridden — convert to RuntimeConfig format
      result.push({
        id: userProv.providerId,
        baseUrl: userProv.baseUrl ?? undefined,
        authProfiles: [
          {
            id: `${userProv.providerId}-user`,
            providerId: userProv.providerId,
            apiKeyEnvVar: userProv.apiKeyEnvVar,
            priority: userProv.priority,
          },
        ],
        ...(userProv.headers ? { headers: userProv.headers } : {}),
      });
    }
  }

  // Add all instance providers (they always win)
  for (const instProv of instanceProviders) {
    result.push(instProv);
  }

  return result;
}
