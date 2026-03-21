// src/dashboard/routes/profile.ts
//
// CRUD routes for user profile, providers, and model aliases.
// All routes require authentication (behind the /api/* auth middleware).

import type { Hono, Context } from "hono";
import { getCookie } from "hono/cookie";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { constants } from "../../lib/constants.js";
import { getDataDir } from "../../lib/platform.js";
import { writeEnvVar, readEnvVar, maskSecret } from "../../lib/dotenv.js";
import {
  UserProfilePatchSchema,
  UserProviderUpsertSchema,
  ApiKeyWriteSchema,
} from "./profile-schema.js";
import { join } from "node:path";
import { discoverModels } from "../../runtime/provider/model-discovery.js";

/** Resolve the user-level .env path (~/.claw-pilot/.env) */
function getUserEnvPath(): string {
  return join(getDataDir(), ".env");
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
  // POST /api/profile/providers/:providerId/models — discover available models
  // -----------------------------------------------------------------------
  app.post("/api/profile/providers/:providerId/models", async (c) => {
    const providerId = c.req.param("providerId");

    const userId = getSessionUserId(c, deps);
    const targetUserId = userId ?? registry.getAdminProfile()?.user_id;
    if (!targetUserId) {
      return apiError(c, 404, "NO_USER", "No user found");
    }

    // Find the provider to get the env var name and base URL
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

    // Read the API key from the user-level .env
    const envPath = getUserEnvPath();
    const apiKey = readEnvVar(envPath, provider.api_key_env_var) ?? "";

    try {
      const models = await discoverModels(providerId, apiKey, provider.base_url);
      return c.json({ models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ models: [], error: msg }, 200);
    }
  });
}
