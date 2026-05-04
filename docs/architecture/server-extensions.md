# Server Extensions

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

`registerServerExtension(...)` lets downstream editions wire additional
dashboard features (route modules, background workers, deferred provider
registrations) without modifying `src/dashboard/server.ts` itself. It is
the generic counterpart to feature-specific hooks like
`trigger-runtime-bootstrap` and `trigger-dashboard-routes`, and is
intended for use cases that do not warrant their own named extension
point.

Community ships no extensions — the registry is empty by default and the
boot path runs the loop with zero iterations. Enterprise editions push
extensions onto the registry from their bootstrap path so that, by the
time `await buildDashboardApp(...)` returns, every Enterprise-specific
route is mounted and every Enterprise-specific scheduler is running.

## API

```typescript
// src/dashboard/server-extensions.ts
import type { Hono } from "hono";
import type { RouteDeps } from "./route-deps.js";

export type ServerExtension = (deps: RouteDeps, app: Hono) => void | Promise<void>;

export function registerServerExtension(extension: ServerExtension): void;
export function getRegisteredServerExtensions(): readonly ServerExtension[];
export function clearServerExtensions(): void; // test-only
```

## Lifecycle

Extensions are invoked once during dashboard server boot, in
`buildDashboardApp(...)`, AFTER every Community route module has been
registered (so an extension may mount additional routes alongside the
built-ins) and BEFORE the HTTP listener accepts traffic (so users never
see a half-wired dashboard).

Extensions run sequentially, in registration order. Failures propagate
and abort the boot — extensions that need to degrade gracefully must
swallow their own errors.

The hook lives in `server.ts` as:

```typescript
// Extension-Point: server-extensions
for (const extension of getRegisteredServerExtensions()) {
  await extension(deps, app);
}
```

## Usage pattern

```typescript
// Inside an Enterprise edition's bootstrap module:
import { registerServerExtension } from "claw-pilot/dashboard/server-extensions";

registerServerExtension(async (deps, app) => {
  // 1. Mount Enterprise-only routes
  registerEnterpriseSsoRoutes(app, deps);

  // 2. Register Enterprise auth providers (gated behind a capability)
  if (capabilities.has("sso-oidc")) {
    for (const row of providersRepo.listAllEnabled()) {
      registerAuthProvider(new OidcAuthProvider(row));
    }
  }

  // 3. Start a background worker tied to the dashboard lifecycle
  startEnterpriseStateReaper(deps.db);
});
```

The registration call must run before `buildDashboardApp(...)` is
invoked — typically at module load time on the Enterprise CLI entry
point, since `import` side-effects in ES modules execute before the CLI
root command parses its arguments.

## Idempotency

Re-registering the same callback function is a silent no-op. This makes
the API safe to call from modules that may be re-imported in test
contexts or hot-reload scenarios.

`clearServerExtensions()` is reserved for test fixtures that need to
isolate extension state between cases. Production code should not call
it.

## Relationship to other extension points

- `trigger-runtime-bootstrap` (TRIGGER-001) — feature-specific hook for
  runtime trigger schedulers. Predates `server-extensions` and remains
  the canonical place for trigger-related boot code.
- `trigger-dashboard-routes` (TRIGGER-001) — feature-specific hook for
  trigger CRUD routes. Same rationale.
- `flow-context-providers` (FLOW-2026-04) — runtime-side hook for
  template variable providers. Outside the dashboard server lifecycle.

When in doubt, prefer a named feature-specific extension point. Use
`server-extensions` only when the integration is genuinely cross-cutting
(SSO, RBAC, audit sinks) or when no named hook exists yet.
