// src/dashboard/middleware/permission.ts
//
// H1 extension point — pluggable permission checker for dashboard routes.
//
// Community ships NullPermissionChecker (always allow) because Community is
// mono-user admin by design. Enterprise registers a FineGrainedRBACChecker
// via registerPermissionChecker() without modifying any route file.
//
// Note: this module is orthogonal to src/runtime/permission/* which handles
// tool-call permissions persisted in the rt_permissions table. Do not merge
// the two concerns.

import type { Context, MiddlewareHandler } from "hono";
import { ClawPilotError } from "../../lib/errors.js";

export interface AuthenticatedUser {
  id: string;
  username: string;
  /** "admin" | "operator" | "viewer" — schema slot, Community is always admin. */
  role: string;
  /** How the request authenticated. */
  source: "session" | "bearer";
}

export interface PermissionContext {
  user: AuthenticatedUser;
  /** Dotted action identifier, e.g. "agent.create", "named-key.read". */
  action: string;
  resource: {
    kind: string;
    id?: string;
    orgId?: string;
  };
  attributes?: Record<string, unknown>;
}

export type PermissionDecision =
  | { allow: true }
  | { allow: false; reason: string; requiresApproval?: boolean };

export interface PermissionChecker {
  check(ctx: PermissionContext): Promise<PermissionDecision>;
}

class NullPermissionChecker implements PermissionChecker {
  async check(_ctx: PermissionContext): Promise<PermissionDecision> {
    return { allow: true };
  }
}

const DEFAULT: PermissionChecker = new NullPermissionChecker();
let current: PermissionChecker = DEFAULT;
let registered = false;

/**
 * Replace the default checker. Called exactly once at bootstrap by editions
 * that ship a non-null checker (e.g. Enterprise). A second call throws a
 * ClawPilotError with code "PERMISSION_CHECKER_ALREADY_REGISTERED".
 * @param checker The PermissionChecker implementation to register.
 */
export function registerPermissionChecker(checker: PermissionChecker): void {
  if (registered) {
    throw new ClawPilotError(
      "PermissionChecker already registered",
      "PERMISSION_CHECKER_ALREADY_REGISTERED",
    );
  }
  current = checker;
  registered = true;
}

/** Test helper — clears registration and restores NullPermissionChecker. */
export function resetPermissionChecker(): void {
  current = DEFAULT;
  registered = false;
}

/** Access the current checker. Route middleware calls this on every request. */
export function getPermissionChecker(): PermissionChecker {
  return current;
}

// --- Hono middleware factory ---

export interface PermissionSpec {
  action: string;
  resource: {
    kind: string;
    /** Resolve the resource id from the request context (params, body, etc.). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id?: (c: Context<any, any, any>) => string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgId?: (c: Context<any, any, any>) => string | undefined;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: (c: Context<any, any, any>) => Record<string, unknown>;
}

/**
 * Hono middleware factory. Each annotated route declares its permission
 * metadata explicitly; the middleware reads the authenticated user from the
 * Hono context (`c.get("user")`, published by the auth middleware), builds a
 * PermissionContext, dispatches to the registered PermissionChecker, and
 * either calls next() or returns 403 PERMISSION_DENIED.
 *
 * @param spec permission metadata for the route (action + resource + optional attributes)
 */
export function permission(spec: PermissionSpec): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as AuthenticatedUser | undefined;
    if (!user) {
      return c.json({ error: "Unauthenticated", code: "UNAUTHENTICATED" }, 401);
    }

    const id = spec.resource.id?.(c);
    const orgId = spec.resource.orgId?.(c);
    const attributes = spec.attributes?.(c);

    const ctx: PermissionContext = {
      user,
      action: spec.action,
      resource: {
        kind: spec.resource.kind,
        ...(id !== undefined ? { id } : {}),
        ...(orgId !== undefined ? { orgId } : {}),
      },
      ...(attributes !== undefined ? { attributes } : {}),
    };

    const decision = await getPermissionChecker().check(ctx);
    if (decision.allow) {
      return next();
    }

    return c.json(
      {
        error: decision.reason,
        code: "PERMISSION_DENIED",
        ...(decision.requiresApproval ? { requiresApproval: true } : {}),
      },
      403,
    );
  };
}
