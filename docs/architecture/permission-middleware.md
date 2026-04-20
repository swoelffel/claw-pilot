# Permission Middleware

> Part of [claw-pilot Functional Architecture](README.md)
>
> Design spec: `docs/superpowers/specs/2026-04-20-h1-permission-middleware-design.md`

---

## Purpose

H1 ships a pluggable extension point so Enterprise can inject a `FineGrainedRBACChecker`
into dashboard routes **without modifying any route file**. Community is mono-user admin by
design — the bootstrap only provisions the admin account, and the `users.role` column
(`admin/operator/viewer`) is a passive schema slot for Enterprise. There are therefore no
multi-role semantics to enforce in Community.

The default checker (`NullPermissionChecker`) always allows. Community carries the contract,
the route annotations, and the user propagation on the Hono context — but without enforcement.
Enterprise registers its own checker once at bootstrap; every annotated route then dispatches
to it automatically.

This mechanism satisfies discipline rule R3: the frozen paths under `src/dashboard/routes/**`
remain byte-identical between Community and Enterprise.

---

## The contract (`src/dashboard/middleware/permission.ts`)

### Types

```typescript
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: string;          // "admin" | "operator" | "viewer" (schema slot)
  source: "session" | "bearer";
}

export interface PermissionContext {
  user: AuthenticatedUser;
  action: string;        // e.g. "agent.create", "named-key.read"
  resource: { kind: string; id?: string; orgId?: string };
  attributes?: Record<string, unknown>;
}

export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string; requiresApproval?: boolean };

export interface PermissionChecker {
  check(ctx: PermissionContext): Promise<PermissionDecision>;
}
```

### Registration API

```typescript
/** Replace the default NullPermissionChecker. Call once before any request is served. */
export function registerPermissionChecker(checker: PermissionChecker): void;

/** Delegates to the registered impl, or NullPermissionChecker if none registered. */
export function getPermissionChecker(): PermissionChecker;

/** Reset to NullPermissionChecker. Test helper only — never call in production code. */
export function resetPermissionChecker(): void;
```

**Lock semantics** — `registerPermissionChecker()` is single-set-then-locked. A second call
throws `ClawPilotError(code: "PERMISSION_CHECKER_ALREADY_REGISTERED")`. This guarantees the
checker is stable for the process lifetime and cannot be replaced mid-run by a plugin or hook.

### Hono context typing

The module augments `ContextVariableMap` so `c.get("user")` returns
`AuthenticatedUser | undefined` everywhere in dashboard route code:

```typescript
declare module "hono" {
  interface ContextVariableMap {
    user: AuthenticatedUser | undefined;
  }
}
```

---

## The `permission()` middleware factory

`permission()` accepts a static descriptor and returns a Hono middleware:

```typescript
export function permission(opts: {
  action: string;
  resource: {
    kind: string;
    id?: string | ((c: Context) => string | undefined);
    orgId?: string | ((c: Context) => string | undefined);
  };
  attributes?: (c: Context) => Record<string, unknown>;
}): MiddlewareHandler;
```

At request time the middleware:

1. Reads `AuthenticatedUser` from `c.get("user")`.
2. Returns **401 UNAUTHENTICATED** (JSON `{ error, code: "UNAUTHENTICATED" }`) when no user
   is present on context.
3. Resolves lazy `id` and `orgId` resolver functions (called with `c`).
4. Builds the `PermissionContext`, using conditional spread for `exactOptionalPropertyTypes`:
   `...(id !== undefined ? { id } : {})`.
5. Calls `getPermissionChecker().check(ctx)`.
6. Returns **403 PERMISSION_DENIED** on deny:
   ```json
   { "error": "<reason>", "code": "PERMISSION_DENIED", "requiresApproval": true }
   ```
   (`requiresApproval` is omitted when `false`.)
7. Calls `await next()` on allow — the route handler runs normally.

### Example annotation

```typescript
app.post(
  "/api/instances/:slug/agents/:agentId/kickoff",
  permission({
    action: ACTIONS.AGENT_KICKOFF,
    resource: { kind: "agent", id: (c) => c.req.param("agentId") },
    attributes: (c) => ({ slug: c.req.param("slug") }),
  }),
  handler,
);
```

---

## The ACTIONS catalogue (`src/dashboard/middleware/permission-actions.ts`)

`ACTIONS` is an ergonomic const of dotted identifiers:

```typescript
export const ACTIONS = {
  // agents
  AGENT_CREATE:        "agent.create",
  AGENT_READ:          "agent.read",
  AGENT_UPDATE:        "agent.update",
  AGENT_DELETE:        "agent.delete",
  AGENT_KICKOFF:       "agent.kickoff",
  AGENT_STOP:          "agent.stop",
  // instances, named keys, blueprints, sessions, flows, etc.
  // ...
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];
```

The convention is `"<resource-kind>.<verb>"` — lowercase, singular. The `action` field on
`PermissionContext` is typed `string`, not `Action`, so Enterprise can register its own
action strings without depending on the Community-maintained union.

---

## Auth middleware wiring (`src/dashboard/server.ts`)

The auth middleware publishes `AuthenticatedUser` on the Hono context for every authenticated
request. It was extracted into `registerAuthMiddleware()` to satisfy the 150-line ESLint gate
when the new user-lookup logic was inlined.

**Session path** — looks up the `users` row by `session.userId` and attaches:

```typescript
{ id: user.id, username: user.username, role: user.role, source: "session" }
```

**Bearer path + query-token SSE fallback** — attaches a synthetic admin user to preserve
today's unrestricted programmatic and SSE behaviour:

```typescript
{ id: "bearer", username: "bearer", role: "admin", source: "bearer" }
```

The query-token path (`?token=…`) is used by SSE endpoints that cannot send `Authorization`
headers from `EventSource`. It falls through to the bearer synthetic user so SSE streams
remain fully authorized without any additional gating.

---

## Orthogonality with `src/runtime/permission/`

| Concern | Owner |
|---|---|
| HTTP route access control | `src/dashboard/middleware/permission.ts` (H1) |
| Tool-call permission rules | `src/runtime/permission/` (persisted in `rt_permissions`) |

The runtime `permission/` module governs which tool calls an agent may execute, persisting
`allow/deny/ask` rules per scope and pattern. The dashboard `permission()` middleware governs
which HTTP routes a caller may access. They are **independent concerns** — do not merge or
cross-call them.

---

## Community vs Enterprise

| Edition | Checker | Enforcement |
|---|---|---|
| Community | `NullPermissionChecker` (always `{ allow: true }`) | None — mono-user admin by design |
| Enterprise | `FineGrainedRBACChecker` registered at bootstrap | Full RBAC/ABAC per route action |

Enterprise registers its checker **before the first request is served**, at the top of its
bootstrap entry point (same timing requirement as `setCapabilityRegistry` — see
`docs/architecture/capability-registry.md`):

```typescript
// Enterprise repo — src/index.ts
import { registerPermissionChecker } from "./dashboard/middleware/permission.js";
import { FineGrainedRBACChecker } from "./rbac/checker.js";

registerPermissionChecker(new FineGrainedRBACChecker(licenceContext));
// … rest of bootstrap
```

The `CapabilityRegistry` (H5) gates Enterprise-specific capabilities (`rbac-fine`, `abac`)
independently. H1 itself does not consume `capabilities.has(...)` because Community has no
branching logic — the `NullPermissionChecker` is always active and always allows.

---

## Testing

Three vitest files cover the contract end-to-end.

### `src/dashboard/middleware/__tests__/permission.test.ts`

Contract-level tests (4 cases):

- Default is `NullPermissionChecker` — `getPermissionChecker()` resolves before any registration.
- Dispatch — a registered checker receives the correct `PermissionContext`.
- Double-registration throws `PERMISSION_CHECKER_ALREADY_REGISTERED`.
- `resetPermissionChecker()` restores the null default (test isolation).

### `src/dashboard/middleware/__tests__/permission-middleware.test.ts`

Middleware factory tests (6 cases):

- Allow path — `next()` is called and `ctx` shape is correct.
- 403 deny — response body includes `error`, `code: "PERMISSION_DENIED"`.
- `requiresApproval` surface — present in body when checker returns `requiresApproval: true`.
- Lazy `id`/`orgId` resolution — resolver functions are called with the Hono context.
- `attributes` passthrough — factory callback result reaches `PermissionContext.attributes`.
- 401 unauthenticated — returned when `c.get("user")` is `undefined`.

### `src/dashboard/__tests__/auth-context.test.ts`

Auth middleware context propagation (3 cases): session path, bearer path, query-token path.

### Shared test helper

`src/dashboard/__tests__/_helpers/inject-admin-user.ts` exports `TEST_ADMIN` (a fixed
`AuthenticatedUser`) and `injectAdminUser()` (a Hono middleware that sets `c.set("user",
TEST_ADMIN)`). Bare-harness unit tests that skip the server-level auth middleware use this
helper to pre-populate the context.

---

## Adoption coverage

146 routes annotated across `src/dashboard/routes/**` — every mutation and every sensitive
read. `/api/auth/login` is intentionally unannotated (public endpoint — no user on context
before authentication).
