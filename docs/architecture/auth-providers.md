# Auth Providers

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The `AuthProvider` abstraction lets the dashboard accept multiple
authentication backends without modifying the login route or the session
layer. Community ships a single backend — password + scrypt — registered at
dashboard boot. Enterprise editions register additional SSO providers
(`OIDCProvider`, `SAMLProvider`, `AzureADProvider`,
`GoogleWorkspaceProvider`) behind the matching capability
(`sso-oidc`, `sso-saml`, `sso-azuread`).

This is hook **H2** of the Community → Enterprise separation plan
(see `ai-docs/plan-enterprise-edition.md`). The goal is that Enterprise
can add SSO **without** editing `src/dashboard/routes/auth.ts` or
`src/core/auth/index.ts`.

## Module layout

```
src/core/auth/
  index.ts              Registry, dispatcher, public re-exports
  provider.ts           AuthProvider interface + AuthResult / AuthenticatedUser types
  providers/
    password.ts         PasswordProvider (default) + scrypt helpers
  __tests__/
    registry.test.ts
    password-provider.test.ts
```

Consumers only import from `src/core/auth/index.js`. Importing directly
from `./providers/password.js` is reserved for bootstrap paths that need
to instantiate the default provider (currently `src/dashboard/server.ts`).

## API reference

### Types

```typescript
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: string;
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; code: string; message: string };

export interface AuthProvider {
  readonly kind: string;  // "password" | "oidc" | "saml" | "azuread" | …
  authenticate(credentials: unknown): Promise<AuthResult>;
  onUserProvisioned?(user: AuthenticatedUser): Promise<void>;
  onUserDeprovisioned?(externalId: string): Promise<void>;
}
```

### Registry functions

- `registerAuthProvider(provider: AuthProvider): void` — throws
  `ClawPilotError(code: "AUTH_PROVIDER_ALREADY_REGISTERED")` if a provider
  with the same `kind` is already registered. Duplicate registrations
  indicate a bootstrap bug; use `unregisterAuthProvider` to replace.
- `authenticate(kind: string, credentials: unknown): Promise<AuthResult>` —
  dispatches to the provider matching `kind`. Returns
  `{ ok: false, code: "UNKNOWN_AUTH_KIND" }` when no provider matches.
  Callers treat this as an authentication failure, not a programmer error.
- `hasAuthProvider(kind: string): boolean`
- `unregisterAuthProvider(kind: string): boolean`
- `listAuthProviderKinds(): string[]`
- `clearAuthProviders(): void` — test-only helper.

### Password utilities

`hashPassword`, `verifyPassword`, and `generatePassword` are re-exported
from `src/core/auth/index.js` for user-creation flows (CLI `auth` command,
e2e seed helpers). These are public utilities, not compat shims.

## Usage pattern

### Login route (dispatcher)

```typescript
import { authenticate } from "../../core/auth/index.js";

const result = await authenticate("password", { username, password });
if (!result.ok) {
  return apiError(c, 401, "INVALID_CREDENTIALS", "Invalid credentials");
}
const user = result.user;
// … create session, set cookie
```

The route stays agnostic to the provider kind. Enterprise can replace
`"password"` with a URL-derived `kind` query parameter (e.g.
`/api/auth/login?kind=oidc`) without further changes to the handler.

### Bootstrap (Community default)

```typescript
// src/dashboard/server.ts
import {
  PasswordProvider,
  registerAuthProvider,
  unregisterAuthProvider,
} from "../core/auth/index.js";

unregisterAuthProvider("password");
registerAuthProvider(new PasswordProvider(db));
```

The `unregister` call ensures that repeat bootstraps (tests, in-process
restarts) rebind the password provider to the current DB handle rather
than failing with `AUTH_PROVIDER_ALREADY_REGISTERED`.

### Implementing a new provider

```typescript
import { capabilities } from "../../core/capabilities.js";
import type { AuthProvider, AuthResult } from "../../core/auth/provider.js";

export class OIDCProvider implements AuthProvider {
  readonly kind = "oidc";

  async authenticate(credentials: unknown): Promise<AuthResult> {
    capabilities.require("sso-oidc");
    // … validate ID token, map claims to AuthenticatedUser
  }
}
```

Provider instances are stateful — carry their own deps (DB handle, HTTP
client, metadata cache) in constructor fields.

## Relationship to other hooks

- **H5 — CapabilityRegistry**: SSO providers gate their `authenticate`
  entry point behind `capabilities.require("sso-oidc" | "sso-saml" | …)`.
  Community never reads those capabilities (all default to `false`).
- **H1 — Permission middleware**: uses `AuthenticatedUser.role` for the
  Community `RoleBasedChecker`. Enterprise fine-grained RBAC consumes the
  full `AuthenticatedUser` plus ABAC attributes.
- **H4 — SecretProvider**: SSO providers fetch client secrets via
  `secretProvider.get(...)` instead of `process.env` directly.

## Testing guidance

Tests that exercise the login route or spin up isolated dashboard
fixtures should call `clearAuthProviders()` in `beforeEach` and
`registerAuthProvider(new PasswordProvider(db))` so the provider is bound
to the test's in-memory DB. See `src/dashboard/__tests__/auth-routes.test.ts`.

The registry itself is covered by `src/core/auth/__tests__/registry.test.ts`
and the default provider by `src/core/auth/__tests__/password-provider.test.ts`.
