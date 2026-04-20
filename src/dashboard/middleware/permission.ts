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
