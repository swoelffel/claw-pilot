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
 * UI descriptor for an authentication backend that exposes a login button on
 * the login page (e.g. SSO providers). Consumed by `GET /api/auth/providers`
 * and rendered by the `<cp-auth-providers-list>` Lit component.
 *
 * Providers without a clickable affordance (e.g. `PasswordProvider`, which is
 * rendered as a form) MUST NOT implement `describeLogin()` so they are
 * excluded from the listing.
 */
export interface LoginDescriptor {
  /** Stable identifier per provider instance (e.g. "entra-prod", "okta-prod"). */
  id: string;
  /** Discriminator kind matching `AuthProvider.kind` (e.g. "oidc", "saml"). */
  kind: string;
  /** Human-readable label rendered on the login button. */
  display_name: string;
  /** URL the user is redirected to when they click the login button. */
  login_url: string;
}

/**
 * Pluggable authentication backend.
 *
 * Community ships a single implementation (`PasswordProvider`). Enterprise
 * editions register additional providers (`OIDCProvider`, `SAMLProvider`,
 * `AzureADProvider`, ...) via `registerAuthProvider()`. The `kind` field is
 * the discriminator used by `authenticate(kind, credentials)`.
 *
 * Providers that surface a login button (SSO) implement `describeLogin()` to
 * expose UI metadata. The default `PasswordProvider` does not — it is rendered
 * as the inline form on the login page.
 *
 * The optional SCIM lifecycle hooks are called by Enterprise provisioning
 * endpoints; Community never invokes them.
 */
export interface AuthProvider {
  readonly kind: string;
  authenticate(credentials: unknown): Promise<AuthResult>;
  describeLogin?(): LoginDescriptor;
  onUserProvisioned?(user: AuthenticatedUser): Promise<void>;
  onUserDeprovisioned?(externalId: string): Promise<void>;
}
