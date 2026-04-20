# H1 — Permission middleware dashboard (design)

Date: 2026-04-20
Branch: `feature/permission-middleware-dashboard`
Related: `ai-docs/plan-enterprise-edition.md` §3 (H1), `docs/architecture/capability-registry.md`

## Goal

Deliver the pluggable extension point that lets Enterprise inject a fine-grained RBAC/ABAC checker into dashboard routes **without modifying any route file**, while keeping frozen paths byte-identical between Community and Enterprise (rule R3 of the discipline charter).

## Context that shapes the design

Community is mono-user admin by construction: the bootstrap only provisions the admin account and there is no UI to create other users. The `users.role` column (`admin/operator/viewer`) exists only as a passive schema slot for Enterprise. There is therefore **no RBAC semantics to implement in Community** — a single role does everything.

Consequence: H1 delivers a contract, a registration seam, route-level annotations, and user propagation on the request context. It does **not** deliver role-based enforcement, because there are no multiple roles in play.

## Public API

```typescript
// src/dashboard/middleware/permission.ts

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: string; // "admin" | "operator" | "viewer" (schema slot)
}

export interface PermissionContext {
  user: AuthenticatedUser;
  resource: { kind: string; id?: string; orgId?: string };
  action: string; // e.g. "agent.create", "named-key.read"
  attributes?: Record<string, unknown>;
}

export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string; requiresApproval?: boolean };

export interface PermissionChecker {
  check(ctx: PermissionContext): Promise<PermissionDecision>;
}

/** Replace the default checker. Must be called before any request is served. */
export function registerPermissionChecker(checker: PermissionChecker): void;

/** Reset to the default NullPermissionChecker. Test helper. */
export function resetPermissionChecker(): void;

/** Hono middleware factory — attach to any route that needs gating. */
export function permission(spec: {
  action: string;
  resource: { kind: string; id?: (c: Context) => string | undefined; orgId?: (c: Context) => string | undefined };
  attributes?: (c: Context) => Record<string, unknown>;
}): MiddlewareHandler;
```

## Default Community implementation

```typescript
class NullPermissionChecker implements PermissionChecker {
  async check(_ctx: PermissionContext): Promise<PermissionDecision> {
    return { allow: true };
  }
}
```

No `RoleBasedChecker`. No capability-guarded branches in Community code. When Enterprise registers its `FineGrainedRBACChecker`, the middleware invokes it exactly the same way — no behavioural toggle in Community.

The capability `rbac-fine` is the Enterprise switch for *Enterprise's own* checker logic (e.g. reading a `permissions` table). H1 Community does not consume `capabilities.has("rbac-fine")` — there is nothing to gate.

## Wire-up on the Hono auth middleware

`src/dashboard/server.ts` currently validates session/bearer but does not publish the user on the request context. H1 enriches it to call `c.set("user", authenticatedUser)` once auth succeeds (both session and bearer paths). Bearer-only requests (no user row) fall back to a synthetic admin identity equivalent to today's unrestricted behaviour — captured as `{ id: "bearer", username: "bearer", role: "admin" }`.

## Adoption strategy

Annotate **every mutation route** (POST/PATCH/PUT/DELETE) and **read routes that expose sensitive data** (named keys, secrets, audit feeds) with the `permission()` middleware. Each route declares `{ action, resource }` explicitly so Enterprise can key decisions on the exact verb and resource kind without pattern-matching the URL.

Initial action taxonomy (enumerated in one place, `src/dashboard/middleware/permission-actions.ts`, as a string union):

- `agent.*` (create/read/update/delete/start/stop/kickoff)
- `agent-blueprint.*`
- `blueprint.*`
- `instance.*` (create/read/update/delete/start/stop/config-patch)
- `team.*`
- `named-key.*` (including `read` — sensitive)
- `profile.*`
- `notification.*`
- `system.*`
- `auth.*` (login, logout, me)
- `flow.*`
- `task.*`
- `workspace.*`
- `search.*`

Exact per-route mapping produced during implementation.

## Articulation with `src/runtime/permission/`

The runtime already owns persisted permission rules (`rt_permissions` table) — these are **tool-call** permissions, orthogonal to dashboard route permissions. No merge; no shared abstraction at H1. A comment in `src/dashboard/middleware/permission.ts` documents the distinction to prevent future confusion.

## Error handling

When `check()` returns `{ allow: false }` the middleware short-circuits with:

```
403 { error: <reason>, code: "PERMISSION_DENIED", requiresApproval?: true }
```

The existing global `app.onError` handler remains untouched.

## Testing

- `permission-checker.test.ts` — registration, double-registration throws, reset helper, default null behaviour.
- `permission-middleware.test.ts` — dispatch to registered checker, 403 on deny, context shape (user + resource + action), bearer synthetic user path.
- No role-semantics tests (nothing to assert until Enterprise plugs a real checker).
- Existing route tests: sanity pass — all current routes still return 200 with authenticated admin (no regression).

## Out of scope

- Multi-user Community UI (provisioning, role assignment) — never planned.
- `RoleBasedChecker` — unneeded, explicitly rejected.
- Tool-call permissions refactor (`rt_permissions`) — separate concern.
- RBAC UI admin screens — Enterprise only.
- SSO / OIDC / SAML — covered by H2.

## Discipline gates

- **R1** (no enterprise flag): no `if (isEnterprise)` / `process.env.ENTERPRISE` anywhere.
- **R3** (frozen-path modifications): `src/dashboard/server.ts` and every `src/dashboard/routes/*.ts` touched. Commit trailer `Extension-Point: permission-middleware` required on each commit modifying those files.
- **R5** (no direct secret access): not relevant at H1.

## Rollout

Single PR on `feature/permission-middleware-dashboard` → `develop`, through standard gitflow (see root `CLAUDE.md`). Validation on MAC before merge.
