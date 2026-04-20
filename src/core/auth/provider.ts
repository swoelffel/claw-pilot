// src/core/auth/provider.ts

/**
 * Minimal shape representing an authenticated user returned by an AuthProvider.
 *
 * Matches the Community `users` table columns consumed by the dashboard
 * (id, username, role). Additional claims (email, groups, external subject)
 * can be added later as optional fields when Enterprise SSO providers ship.
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: string;
}

/**
 * Result of an authentication attempt.
 *
 * Providers never throw on bad credentials — they return `{ ok: false }` with
 * a machine-readable `code` and human-readable `message`. Transport errors
 * (DB down, OIDC endpoint unreachable) are the only case where a provider may
 * throw; the dispatcher surfaces such throws unchanged.
 */
export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; code: string; message: string };

/**
 * Pluggable authentication backend.
 *
 * Community ships a single implementation (`PasswordProvider`). Enterprise
 * editions register additional providers (`OIDCProvider`, `SAMLProvider`,
 * `AzureADProvider`, ...) via `registerAuthProvider()`. The `kind` field is
 * the discriminator used by `authenticate(kind, credentials)`.
 *
 * The optional SCIM lifecycle hooks are called by Enterprise provisioning
 * endpoints; Community never invokes them.
 */
export interface AuthProvider {
  readonly kind: string;
  authenticate(credentials: unknown): Promise<AuthResult>;
  onUserProvisioned?(user: AuthenticatedUser): Promise<void>;
  onUserDeprovisioned?(externalId: string): Promise<void>;
}
