// src/dashboard/routes/profile.ts
//
// Routes for user profile.
// All routes require authentication (behind the /api/* auth middleware).

import type { Hono, Context } from "hono";
import { getCookie } from "hono/cookie";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { constants } from "../../lib/constants.js";
import { UserProfilePatchSchema } from "./profile-schema.js";
import { markAllDirty } from "../../runtime/session/system-prompt-dirty.js";
import { logger } from "../../lib/logger.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

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
  app.get(
    "/api/profile",
    permission({ action: ACTIONS.PROFILE_READ, resource: { kind: "profile" } }),
    (c) => {
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
        } catch (err) {
          logger.warn("[route:profile] uiPreferences JSON parse failed", { error: String(err) });
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
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /api/profile — update profile fields
  // -----------------------------------------------------------------------
  app.patch(
    "/api/profile",
    permission({ action: ACTIONS.PROFILE_UPDATE, resource: { kind: "profile" } }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch (err) {
        logger.warn("[route:profile] JSON parse failed", { error: String(err) });
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
      if (data.communicationStyle !== undefined)
        dbData.communication_style = data.communicationStyle;
      if (data.customInstructions !== undefined)
        dbData.custom_instructions = data.customInstructions;
      if (data.defaultModel !== undefined) dbData.default_model = data.defaultModel;
      if (data.avatarUrl !== undefined) dbData.avatar_url = data.avatarUrl;
      if (data.uiPreferences !== undefined) {
        dbData.ui_preferences = data.uiPreferences ? JSON.stringify(data.uiPreferences) : null;
      }

      const updated = registry.upsertUserProfile(targetUserId, dbData);

      // Invalidate all system prompt caches — profile data is injected into every prompt
      markAllDirty("profile");

      return c.json({
        ok: true,
        profile: { userId: updated.user_id, updatedAt: updated.updated_at },
      });
    },
  );
}
