// src/dashboard/public-paths.ts
//
// Registry for additional public path prefixes that bypass the dashboard
// auth middleware. Community ships only `/api/auth/login` as public; the
// Enterprise OIDC backend extends this set with `/api/auth/oidc` so the
// authorization-code flow endpoints (start + callback) can be reached by
// unauthenticated browsers — they ARE the auth flow.
//
// Extension-Point: public-auth-paths

import { logger } from "../lib/logger.js";

const publicPathPrefixes: string[] = [];

/**
 * Register a path prefix as public — the auth middleware will skip it.
 * The prefix is matched as either an exact path or via `startsWith(prefix + "/")`,
 * so registering `/api/auth/oidc` covers `/api/auth/oidc`, `/api/auth/oidc/`,
 * `/api/auth/oidc/<provider>/start`, `/api/auth/oidc/callback`, etc.
 *
 * Idempotent — re-registering the same prefix is a no-op.
 *
 * @throws Error when prefix does not start with `/`
 */
export function registerPublicAuthPath(prefix: string): void {
  if (!prefix.startsWith("/")) {
    throw new Error(`registerPublicAuthPath: prefix must start with "/" (got "${prefix}")`);
  }
  if (publicPathPrefixes.includes(prefix)) {
    return;
  }
  publicPathPrefixes.push(prefix);
  logger.debug("[auth] public path registered", { prefix });
}

/** Reset the registry. Test-only. */
export function clearPublicAuthPaths(): void {
  publicPathPrefixes.length = 0;
}

/** True when `path` matches any registered prefix. Used by the auth middleware. */
export function isPublicAuthPath(path: string): boolean {
  return publicPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Read-only snapshot of registered prefixes. */
export function getRegisteredPublicAuthPaths(): readonly string[] {
  return [...publicPathPrefixes];
}
