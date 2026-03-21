// src/dashboard/routes/profile.ts
//
// CRUD routes for user profile, providers, and model aliases.
// All routes require authentication (behind the /api/* auth middleware).

import type { Hono, Context } from "hono";
import { getCookie } from "hono/cookie";
import * as path from "node:path";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { constants } from "../../lib/constants.js";
import { getDataDir } from "../../lib/platform.js";
import { writeEnvVar, readEnvVar, maskSecret } from "../../lib/dotenv.js";
import {
  UserProfilePatchSchema,
  UserProviderUpsertSchema,
  ApiKeyWriteSchema,
  UserModelAliasesSchema,
} from "./profile-schema.js";
import { loadRuntimeConfig } from "../../runtime/engine/config-loader.js";
import { PROVIDER_ENV_VARS } from "../../lib/providers.js";

/** Resolve the user-level .env path (~/.claw-pilot/.env) */
function getUserEnvPath(): string {
  return path.join(getDataDir(), ".env");
}

/**
 * Extract the authenticated userId from the session cookie.
 * Returns undefined if no valid session (should not happen behind auth middleware).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSessionUserId(c: Context<any, any, any>, deps: RouteDeps): number | undefined {
  const sid = getCookie(c, constants.SESSION_COOKIE_NAME);
  if (!sid) return undefined;
  const session = deps.sessionStore.validate(sid);
  return session?.userId;
}

export function registerProfileRoutes(app: Hono, deps: RouteDeps): void {
  const { registry } = deps;

  // -----------------------------------------------------------------------
  // GET /api/profile — read current user's profile
  // -----------------------------------------------------------------------
  app.get("/api/profile", (c) => {
    const userId = getSessionUserId(c, deps);

    // Fallback: single-user mode — get admin profile
    const profile = userId ? registry.getUserProfile(userId) : registry.getAdminProfile();

    if (!profile) {
      return c.json({
        profile: null,
        message: "No profile configured yet",
      });
    }

    // Parse JSON blobs for the response
    let uiPreferences: Record<string, unknown> | null = null;
    if (profile.ui_preferences) {
      try {
        uiPreferences = JSON.parse(profile.ui_preferences) as Record<string, unknown>;
      } catch {
        /* malformed JSON */
      }
    }

    return c.json({
      profile: {
        userId: profile.user_id,
        displayName: profile.display_name,
        language: profile.language,
        timezone: profile.timezone,
        communicationStyle: profile.communication_style,
        customInstructions: profile.custom_instructions,
        defaultModel: profile.default_model,
        avatarUrl: profile.avatar_url,
        uiPreferences,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /api/profile — update profile fields
  // -----------------------------------------------------------------------
  app.patch("/api/profile", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = UserProfilePatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const userId = getSessionUserId(c, deps);
    // Fallback: single-user mode
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found to update profile for");
    }

    const data = parsed.data;
    const dbData: Record<string, unknown> = {};
    if (data.displayName !== undefined) dbData.display_name = data.displayName;
    if (data.language !== undefined) dbData.language = data.language;
    if (data.timezone !== undefined) dbData.timezone = data.timezone;
    if (data.communicationStyle !== undefined) dbData.communication_style = data.communicationStyle;
    if (data.customInstructions !== undefined) dbData.custom_instructions = data.customInstructions;
    if (data.defaultModel !== undefined) dbData.default_model = data.defaultModel;
    if (data.avatarUrl !== undefined) dbData.avatar_url = data.avatarUrl;
    if (data.uiPreferences !== undefined) {
      dbData.ui_preferences = data.uiPreferences ? JSON.stringify(data.uiPreferences) : null;
    }

    const updated = registry.upsertUserProfile(targetUserId, dbData);
    return c.json({
      ok: true,
      profile: { userId: updated.user_id, updatedAt: updated.updated_at },
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/profile/providers — list user-level providers
  // -----------------------------------------------------------------------
  app.get("/api/profile/providers", (c) => {
    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return c.json({ providers: [] });
    }

    const providers = registry.getUserProviders(targetUserId);
    const envPath = getUserEnvPath();

    return c.json({
      providers: providers.map((p) => {
        // Check if the API key is set in the user-level .env
        const rawKey = readEnvVar(envPath, p.api_key_env_var);
        let headers: Record<string, string> | null = null;
        if (p.headers) {
          try {
            headers = JSON.parse(p.headers) as Record<string, string>;
          } catch {
            /* malformed JSON */
          }
        }

        return {
          providerId: p.provider_id,
          apiKeyEnvVar: p.api_key_env_var,
          baseUrl: p.base_url,
          priority: p.priority,
          headers,
          hasApiKey: rawKey !== null && rawKey.length > 0,
          apiKeyMasked: rawKey ? maskSecret(rawKey) : null,
        };
      }),
    });
  });

  // -----------------------------------------------------------------------
  // PUT /api/profile/providers/:providerId — add/update a provider
  // -----------------------------------------------------------------------
  app.put("/api/profile/providers/:providerId", async (c) => {
    const providerId = c.req.param("providerId");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = UserProviderUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    const data = parsed.data;
    registry.upsertUserProvider(targetUserId, {
      provider_id: providerId,
      api_key_env_var: data.apiKeyEnvVar,
      base_url: data.baseUrl ?? null,
      priority: data.priority,
      headers: data.headers ? JSON.stringify(data.headers) : null,
    });

    return c.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/profile/providers/:providerId — remove a provider
  // -----------------------------------------------------------------------
  app.delete("/api/profile/providers/:providerId", (c) => {
    const providerId = c.req.param("providerId");

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    registry.removeUserProvider(targetUserId, providerId);
    return c.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // PATCH /api/profile/providers/:providerId/key — write API key to ~/.claw-pilot/.env
  // -----------------------------------------------------------------------
  app.patch("/api/profile/providers/:providerId/key", async (c) => {
    const providerId = c.req.param("providerId");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = ApiKeyWriteSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    // Find the provider to get the env var name
    const providers = registry.getUserProviders(targetUserId);
    const provider = providers.find((p) => p.provider_id === providerId);
    if (!provider) {
      return apiError(
        c,
        404,
        "PROVIDER_NOT_FOUND",
        `Provider "${providerId}" not found in profile`,
      );
    }

    // Write the API key to the user-level .env
    const envPath = getUserEnvPath();
    await writeEnvVar(envPath, provider.api_key_env_var, parsed.data.apiKey);

    return c.json({ ok: true, masked: maskSecret(parsed.data.apiKey) });
  });

  // -----------------------------------------------------------------------
  // GET /api/profile/models — list user-level model aliases
  // -----------------------------------------------------------------------
  app.get("/api/profile/models", (c) => {
    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return c.json({ models: [] });
    }

    const aliases = registry.getUserModelAliases(targetUserId);
    return c.json({
      models: aliases.map((a) => ({
        aliasId: a.alias_id,
        provider: a.provider,
        model: a.model,
        contextWindow: a.context_window,
      })),
    });
  });

  // -----------------------------------------------------------------------
  // PUT /api/profile/models — replace all model aliases
  // -----------------------------------------------------------------------
  app.put("/api/profile/models", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, "INVALID_BODY", "Invalid JSON body");
    }

    const parsed = UserModelAliasesSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", parsed.error.message);
    }

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    registry.setUserModelAliases(
      targetUserId,
      parsed.data.map((a) => ({
        alias_id: a.aliasId,
        provider: a.provider,
        model: a.model,
        context_window: a.contextWindow ?? null,
      })),
    );

    return c.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // POST /api/profile/import-providers/:slug — import providers from an instance
  // -----------------------------------------------------------------------
  app.post("/api/profile/import-providers/:slug", async (c) => {
    const slug = c.req.param("slug");

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    // Load the instance to get its state_dir
    const instance = registry.getInstance(slug);
    if (!instance) {
      return apiError(c, 404, "INSTANCE_NOT_FOUND", `Instance "${slug}" not found`);
    }

    // Load the instance's runtime.json
    let config;
    try {
      config = loadRuntimeConfig(instance.state_dir);
    } catch {
      return apiError(c, 400, "CONFIG_LOAD_ERROR", `Failed to load runtime.json for "${slug}"`);
    }

    let importedProviders = 0;
    let importedAliases = 0;
    let importedKeys = 0;

    const userEnvPath = getUserEnvPath();
    const instanceEnvPath = path.join(instance.state_dir, ".env");

    // 1. Import providers
    for (const provider of config.providers) {
      // Determine the env var name — from the first auth profile, or from PROVIDER_ENV_VARS
      const envVar =
        provider.authProfiles[0]?.apiKeyEnvVar ??
        PROVIDER_ENV_VARS[provider.id] ??
        `${provider.id.toUpperCase()}_API_KEY`;

      registry.upsertUserProvider(targetUserId, {
        provider_id: provider.id,
        api_key_env_var: envVar,
        base_url: provider.baseUrl ?? null,
        priority: provider.authProfiles[0]?.priority ?? 0,
        headers: provider.headers ? JSON.stringify(provider.headers) : null,
      });
      importedProviders++;

      // Copy the API key from instance .env to user .env (if it exists)
      const keyValue = readEnvVar(instanceEnvPath, envVar);
      if (keyValue) {
        await writeEnvVar(userEnvPath, envVar, keyValue);
        importedKeys++;
      }
    }

    // 2. Import model aliases
    if (config.models.length > 0) {
      registry.setUserModelAliases(
        targetUserId,
        config.models.map((a) => ({
          alias_id: a.id,
          provider: a.provider,
          model: a.model,
          context_window: a.contextWindow ?? null,
        })),
      );
      importedAliases = config.models.length;
    }

    // 3. Import default model
    if (config.defaultModel) {
      registry.upsertUserProfile(targetUserId, {
        default_model: config.defaultModel,
      });
    }

    return c.json({
      ok: true,
      imported: {
        providers: importedProviders,
        modelAliases: importedAliases,
        apiKeys: importedKeys,
        defaultModel: config.defaultModel ?? null,
      },
    });
  });
}
