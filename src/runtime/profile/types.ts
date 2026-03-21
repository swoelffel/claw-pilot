// src/runtime/profile/types.ts
//
// User profile abstraction — single source of truth for user preferences,
// provider configs, and model aliases.
//
// Community edition: single-user (admin) backed by SQLite.
// Enterprise edition: swappable module with RBAC + SSO support.

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

/** Core user profile data — injected into agent prompts */
export interface UserProfile {
  userId: number;
  displayName: string | null;
  /** ISO 639-1 language code (e.g. "en", "fr") */
  language: string;
  /** IANA timezone (e.g. "Europe/Paris") */
  timezone: string | null;
  communicationStyle: "concise" | "detailed" | "technical";
  /** Markdown instructions injected into every agent prompt. Max 10 000 chars. */
  customInstructions: string | null;
  /** Default model in "provider/model" format */
  defaultModel: string | null;
  avatarUrl: string | null;
  /** Opaque JSON blob for dashboard UI preferences */
  uiPreferences: Record<string, unknown> | null;
}

/** Provider config at the user level (shared across instances) */
export interface UserProviderConfig {
  providerId: string;
  /** Name of the env var in ~/.claw-pilot/.env that holds the API key */
  apiKeyEnvVar: string;
  /** Override base URL (required for Ollama, optional for others) */
  baseUrl: string | null;
  priority: number;
  /** Extra HTTP headers */
  headers: Record<string, string> | null;
}

/** Model alias at the user level (shared across instances) */
export interface UserModelAlias {
  aliasId: string;
  provider: string;
  model: string;
  contextWindow: number | null;
}

// ---------------------------------------------------------------------------
// ProfileResolver interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for resolving user profile, providers, and model aliases.
 *
 * Community impl (`CommunityProfileResolver`) uses SQLite via `UserProfileRepository`.
 * Enterprise impl can swap in RBAC + SSO + external DB by implementing this interface.
 *
 * In single-user mode, `userId` parameters are optional — the resolver defaults
 * to the admin user.
 */
export interface ProfileResolver {
  /** Resolve profile for a user (single-user: always the admin if userId omitted) */
  getActiveProfile(userId?: number): UserProfile | undefined;

  /** List user-level provider configs */
  getProviders(userId?: number): UserProviderConfig[];

  /** List user-level model aliases */
  getModelAliases(userId?: number): UserModelAlias[];

  /** Update profile fields (partial update, returns full profile) */
  updateProfile(data: Partial<Omit<UserProfile, "userId">>, userId?: number): UserProfile;

  /** Add or update a provider config */
  upsertProvider(data: UserProviderConfig, userId?: number): void;

  /** Remove a provider config */
  removeProvider(providerId: string, userId?: number): void;

  /** Replace all model aliases */
  setModelAliases(aliases: UserModelAlias[], userId?: number): void;
}
