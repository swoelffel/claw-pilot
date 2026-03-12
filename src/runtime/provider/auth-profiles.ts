/**
 * runtime/provider/auth-profiles.ts
 *
 * Auth profile rotation system for claw-runtime.
 * Inspired by OpenClaw's auth-profiles.ts.
 *
 * Manages multiple API keys per provider with:
 * - Round-robin ordering by priority
 * - Cooldown tracking after failures
 * - Automatic failover to the next available profile
 * - Failure classification (rate_limit, billing, auth_invalid, etc.)
 */

import type { InstanceSlug, ProviderId, AuthProfile, AuthFailureReason } from "../types.js";

// ---------------------------------------------------------------------------
// In-memory store (persisted to DB via the repository layer in Phase 1)
// ---------------------------------------------------------------------------

const _stores = new Map<InstanceSlug, Map<string, AuthProfile>>();

function getStore(slug: InstanceSlug): Map<string, AuthProfile> {
  let store = _stores.get(slug);
  if (!store) {
    store = new Map();
    _stores.set(slug, store);
  }
  return store;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Register or update an auth profile */
export function upsertAuthProfile(profile: AuthProfile): void {
  const store = getStore(profile.instanceSlug);
  store.set(profile.id, { ...profile, updatedAt: new Date() });
}

/** Get all profiles for a provider, sorted by priority (ascending = highest priority first) */
export function getAuthProfiles(slug: InstanceSlug, providerId: ProviderId): AuthProfile[] {
  const store = getStore(slug);
  return Array.from(store.values())
    .filter((p) => p.providerId === providerId)
    .sort((a, b) => a.priority - b.priority);
}

/** Remove an auth profile */
export function removeAuthProfile(slug: InstanceSlug, profileId: string): void {
  getStore(slug).delete(profileId);
}

/** Clear all profiles for an instance (called on instance destroy) */
export function clearAuthProfiles(slug: InstanceSlug): void {
  _stores.delete(slug);
}

// ---------------------------------------------------------------------------
// Rotation logic
// ---------------------------------------------------------------------------

const COOLDOWN_DURATIONS_MS: Record<AuthFailureReason, number> = {
  rate_limit: 60_000, // 1 minute
  billing: 300_000, // 5 minutes
  auth_invalid: 3_600_000, // 1 hour (likely permanent)
  context_overflow: 0, // No cooldown — not an auth issue
  timeout: 30_000, // 30 seconds
  server_error: 30_000, // 30 seconds
  unknown: 60_000, // 1 minute
};

/**
 * Get the next available auth profile for a provider.
 * Skips profiles in cooldown.
 * Returns undefined if no profile is available.
 */
export function getNextAvailableProfile(
  slug: InstanceSlug,
  providerId: ProviderId,
): AuthProfile | undefined {
  const profiles = getAuthProfiles(slug, providerId);
  const now = new Date();

  return profiles.find((p) => {
    if (!p.cooldownUntil) return true;
    return p.cooldownUntil <= now;
  });
}

/**
 * Mark a profile as failed and put it in cooldown.
 * Returns the next available profile (for immediate failover), or undefined.
 */
export function markProfileFailed(
  slug: InstanceSlug,
  profileId: string,
  reason: AuthFailureReason,
): AuthProfile | undefined {
  const store = getStore(slug);
  const profile = store.get(profileId);
  if (!profile) return undefined;

  const cooldownMs = COOLDOWN_DURATIONS_MS[reason];
  const now = new Date();

  store.set(profileId, {
    ...profile,
    failureCount: profile.failureCount + 1,
    lastError: reason,
    cooldownUntil: cooldownMs > 0 ? new Date(now.getTime() + cooldownMs) : undefined,
    updatedAt: now,
  });

  // Return the next available profile for failover
  return getNextAvailableProfile(slug, profile.providerId);
}

/**
 * Mark a profile as successful — reset failure count and cooldown.
 */
export function markProfileSuccess(slug: InstanceSlug, profileId: string): void {
  const store = getStore(slug);
  const profile = store.get(profileId);
  if (!profile) return;

  store.set(profileId, {
    ...profile,
    failureCount: 0,
    lastError: undefined,
    cooldownUntil: undefined,
    updatedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Classify an error into an AuthFailureReason.
 * Inspects HTTP status codes and error messages.
 */
export function classifyFailure(error: unknown): AuthFailureReason {
  if (!error || typeof error !== "object") return "unknown";

  const err = error as Record<string, unknown>;

  // HTTP status code
  const status = (err["status"] ?? err["statusCode"]) as number | undefined;
  if (status === 401 || status === 403) return "auth_invalid";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status && status >= 500) return "server_error";

  // Error message patterns
  const message = String(err["message"] ?? "").toLowerCase();
  if (message.includes("rate limit") || message.includes("too many requests")) return "rate_limit";
  if (message.includes("billing") || message.includes("quota") || message.includes("credit"))
    return "billing";
  if (message.includes("invalid api key") || message.includes("unauthorized"))
    return "auth_invalid";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("context") && message.includes("length")) return "context_overflow";

  return "unknown";
}

// ---------------------------------------------------------------------------
// Snapshot (for persistence in Phase 1)
// ---------------------------------------------------------------------------

/** Export all profiles for an instance (for DB persistence) */
export function exportAuthProfiles(slug: InstanceSlug): AuthProfile[] {
  return Array.from(getStore(slug).values());
}

/** Import profiles from DB into the in-memory store */
export function importAuthProfiles(profiles: AuthProfile[]): void {
  for (const profile of profiles) {
    upsertAuthProfile(profile);
  }
}
