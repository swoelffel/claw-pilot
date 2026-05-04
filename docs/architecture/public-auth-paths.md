# Public Auth Paths

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The dashboard auth middleware blocks every request under `/api/*` that
does not present a valid session cookie or Bearer token. A small built-in
allow-list (`/api/auth/login`) carves out the password backend's public
endpoint so unauthenticated browsers can still submit credentials.

SSO backends like the Enterprise OIDC plugin need the same carve-out for
their authorization-code flow endpoints (`/api/auth/oidc/<provider>/start`,
`/api/auth/oidc/callback`). These routes ARE the auth flow — they cannot
require auth — but they are mounted via the
[`server-extensions`](server-extensions.md) hook AFTER the auth
middleware has been wired, so a static allow-list cannot reach them.

`registerPublicAuthPath(prefix)` lets a downstream module declare a
public path prefix that the auth middleware will skip.

## API

```typescript
// src/dashboard/public-paths.ts

export function registerPublicAuthPath(prefix: string): void;
export function isPublicAuthPath(path: string): boolean;
export function getRegisteredPublicAuthPaths(): readonly string[];
export function clearPublicAuthPaths(): void; // test-only
```

`prefix` must start with `/`. Matching is exact-or-prefix-with-slash:
`registerPublicAuthPath("/api/auth/oidc")` matches `/api/auth/oidc`,
`/api/auth/oidc/`, `/api/auth/oidc/callback`, and
`/api/auth/oidc/entra/start`, but **not** `/api/auth/oidcsomething`.

Re-registering the same prefix is a silent no-op.

## Wiring

The hook lives in `registerAuthMiddleware`:

```typescript
// Extension-Point: public-auth-paths
if (PUBLIC_ROUTES.some((r) => c.req.path === r) || isPublicAuthPath(c.req.path)) {
  return next();
}
```

The built-in `PUBLIC_ROUTES` array is intentionally tiny and remains
reserved for the Community password backend. Every other public path
must register itself through this API.

## Usage pattern

```typescript
// Inside an SSO plugin's bootstrap path:
import { registerPublicAuthPath } from "claw-pilot/dashboard/public-paths";

registerPublicAuthPath("/api/auth/oidc");
```

The registration call must run before `buildDashboardApp(...)` is
invoked — typically alongside the matching `registerServerExtension`
call.

## Security notes

- The middleware is the **only** authentication layer the dashboard has.
  A path registered here is reachable by **anyone** who can hit the
  dashboard. Routes under the prefix must implement their own auth-flow
  semantics (state cookies, signed callbacks, etc.) and must never
  expose authenticated functionality.
- Prefer registering the **narrowest** prefix that covers all routes a
  given backend needs. `/api/auth/oidc` is correct for OIDC; `/api/auth`
  would expose `/api/auth/me` and `/api/auth/logout`, which need auth.
- The registry is process-global. Tests must call
  `clearPublicAuthPaths()` to avoid leaking state across cases.

## Relationship to other extension points

- [`server-extensions`](server-extensions.md) — the broader hook that
  lets editions mount routes after the auth middleware. SSO backends
  typically pair `registerServerExtension(...)` (to mount routes) with
  `registerPublicAuthPath(...)` (to bypass auth on those routes).
- [`auth-providers`](auth-providers.md) — the H2 registry where SSO
  backends publish their `LoginDescriptor` so the login screen shows a
  button. The descriptor's `login_url` typically points into a path
  registered here.
