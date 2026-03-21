// src/runtime/profile/community-resolver.ts
//
// Community edition implementation of ProfileResolver.
// Single-user mode: all operations target the admin user's profile.
// Enterprise edition replaces this module with RBAC + SSO support.

import type { ProfileResolver, UserProfile, UserProviderConfig } from "./types.js";
import type { UserProfileRepository } from "../../core/repositories/user-profile-repository.js";
import type { UserProfileRecord, UserProviderRecord } from "../../core/registry-types.js";

// ---------------------------------------------------------------------------
// Record → Domain mapping helpers
// ---------------------------------------------------------------------------

function toUserProfile(record: UserProfileRecord): UserProfile {
  let uiPreferences: Record<string, unknown> | null = null;
  if (record.ui_preferences) {
    try {
      uiPreferences = JSON.parse(record.ui_preferences) as Record<string, unknown>;
    } catch {
      // Malformed JSON — treat as null
    }
  }

  return {
    userId: record.user_id,
    displayName: record.display_name,
    language: record.language,
    timezone: record.timezone,
    communicationStyle: record.communication_style,
    customInstructions: record.custom_instructions,
    defaultModel: record.default_model,
    avatarUrl: record.avatar_url,
    uiPreferences,
  };
}

function toProviderConfig(record: UserProviderRecord): UserProviderConfig {
  let headers: Record<string, string> | null = null;
  if (record.headers) {
    try {
      headers = JSON.parse(record.headers) as Record<string, string>;
    } catch {
      // Malformed JSON — treat as null
    }
  }

  return {
    providerId: record.provider_id,
    apiKeyEnvVar: record.api_key_env_var,
    baseUrl: record.base_url,
    priority: record.priority,
    headers,
  };
}

// ---------------------------------------------------------------------------
// CommunityProfileResolver
// ---------------------------------------------------------------------------

/**
 * Community edition profile resolver.
 *
 * In single-user mode, `userId` is optional on all methods — the resolver
 * defaults to the first admin user's profile. This simplifies call sites
 * that don't have a user context (e.g. CLI daemon mode).
 */
export class CommunityProfileResolver implements ProfileResolver {
  constructor(private repo: UserProfileRepository) {}

  /** Resolve the effective userId: explicit arg > admin user */
  private resolveUserId(userId?: number): number | undefined {
    if (userId !== undefined) return userId;
    const adminProfile = this.repo.getAdminProfile();
    return adminProfile?.user_id;
  }

  getActiveProfile(userId?: number): UserProfile | undefined {
    const uid = this.resolveUserId(userId);
    if (uid === undefined) return undefined;
    const record = this.repo.getProfile(uid);
    return record ? toUserProfile(record) : undefined;
  }

  getProviders(userId?: number): UserProviderConfig[] {
    const uid = this.resolveUserId(userId);
    if (uid === undefined) return [];
    return this.repo.getProviders(uid).map(toProviderConfig);
  }

  updateProfile(data: Partial<Omit<UserProfile, "userId">>, userId?: number): UserProfile {
    const uid = this.resolveUserId(userId);
    if (uid === undefined) {
      throw new Error("No user found to update profile for");
    }

    // Map domain fields to DB column names
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

    const record = this.repo.upsertProfile(uid, dbData);
    return toUserProfile(record);
  }

  upsertProvider(data: UserProviderConfig, userId?: number): void {
    const uid = this.resolveUserId(userId);
    if (uid === undefined) {
      throw new Error("No user found to update provider for");
    }

    this.repo.upsertProvider(uid, {
      provider_id: data.providerId,
      api_key_env_var: data.apiKeyEnvVar,
      base_url: data.baseUrl,
      priority: data.priority,
      headers: data.headers ? JSON.stringify(data.headers) : null,
    });
  }

  removeProvider(providerId: string, userId?: number): void {
    const uid = this.resolveUserId(userId);
    if (uid === undefined) return;
    this.repo.removeProvider(uid, providerId);
  }
}
