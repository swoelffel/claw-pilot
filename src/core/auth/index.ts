// src/core/auth/index.ts
//
// Dispatcher and registry for pluggable authentication backends.
//
// Community registers a single `PasswordProvider` at dashboard bootstrap.
// Enterprise editions register additional SSO providers (OIDC, SAML,
// Azure AD, Google Workspace) gated behind the corresponding capability
// (`sso-oidc`, `sso-saml`, `sso-azuread`) inside each provider's own
// bootstrap path. Community never reads those capabilities.
//
// This module is the single entry point for anything auth-related —
// consumers should only import from `../core/auth/index.js`, never from
// `./providers/*` directly (except `new PasswordProvider(db)` at bootstrap).

import { ClawPilotError } from "../../lib/errors.js";
import type { AuthProvider, AuthResult, LoginDescriptor } from "./provider.js";

export type { AuthProvider, AuthResult, AuthenticatedUser, LoginDescriptor } from "./provider.js";
export { PasswordProvider } from "./providers/password.js";
export type { PasswordCredentials } from "./providers/password.js";

// Public password crypto utilities — used by user-creation flows (CLI `auth`
// command, e2e seed helpers). Re-exported here so consumers have a single
// `core/auth` entry point.
export { hashPassword, verifyPassword, generatePassword } from "./providers/password.js";

const providers = new Map<string, AuthProvider>();

/**
 * Register an auth provider. Throws if a provider with the same `kind` is
 * already registered — duplicate registrations are a bootstrap bug, not a
 * replacement mechanism.
 *
 * Tests that spin up multiple isolated dashboard contexts should call
 * `clearAuthProviders()` between runs.
 */
export function registerAuthProvider(provider: AuthProvider): void {
  if (providers.has(provider.kind)) {
    throw new ClawPilotError(
      `AuthProvider "${provider.kind}" is already registered`,
      "AUTH_PROVIDER_ALREADY_REGISTERED",
    );
  }
  providers.set(provider.kind, provider);
}

/**
 * Dispatch an authentication attempt to the registered provider matching
 * `kind`. Returns `{ ok: false, code: "UNKNOWN_AUTH_KIND" }` when no
 * provider is registered for the given kind — callers treat this as an
 * authentication failure, not a programmer error, so that misconfigured
 * SSO kinds cannot crash the login route.
 */
export async function authenticate(kind: string, credentials: unknown): Promise<AuthResult> {
  const provider = providers.get(kind);
  if (!provider) {
    return {
      ok: false,
      code: "UNKNOWN_AUTH_KIND",
      message: `No auth provider registered for kind "${kind}"`,
    };
  }
  return provider.authenticate(credentials);
}

/** Returns true if a provider is registered for the given `kind`. */
export function hasAuthProvider(kind: string): boolean {
  return providers.has(kind);
}

/**
 * Remove the provider registered for `kind`, if any. Returns true when a
 * provider was removed. Used by dashboard bootstrap to rebind the built-in
 * password provider to a fresh DB handle across test/server restarts.
 */
export function unregisterAuthProvider(kind: string): boolean {
  return providers.delete(kind);
}

/** Returns the list of registered provider kinds (order not guaranteed). */
export function listAuthProviderKinds(): string[] {
  return Array.from(providers.keys());
}

/**
 * Returns UI descriptors for every registered provider that exposes a login
 * button (i.e. implements `describeLogin()`). Used by `GET /api/auth/providers`
 * to render SSO buttons on the login page.
 *
 * In Community this is always `[]` because the only registered provider is
 * `PasswordProvider`, which does not implement `describeLogin()` (the
 * password form is rendered inline). Enterprise registers one descriptor per
 * enabled SSO row.
 */
export function listLoginableProviders(): LoginDescriptor[] {
  const out: LoginDescriptor[] = [];
  for (const provider of providers.values()) {
    const descriptor = provider.describeLogin?.();
    if (descriptor) out.push(descriptor);
  }
  return out;
}

/**
 * Test-only helper — clears every registered provider. Call in `beforeEach`
 * when setting up isolated dashboard fixtures, otherwise subsequent
 * `registerAuthProvider()` calls throw `AUTH_PROVIDER_ALREADY_REGISTERED`.
 */
export function clearAuthProviders(): void {
  providers.clear();
}
