/**
 * ui/src/services/auth-state.ts
 *
 * Closed module for the dashboard Bearer token.
 *
 * Replaces the previous pattern of storing the token as `window.__CP_TOKEN__`
 * (a global mutable property accessible to any script on the page).
 *
 * The token is now held in module-private state and exposed only through
 * explicit getters/setters. This limits the blast radius of an XSS attack:
 * the token is no longer trivially accessible via `window.__CP_TOKEN__`.
 */

let _token: string | null = null;

/** Store the dashboard Bearer token. Called after successful auth. */
export function setToken(token: string): void {
  _token = token;
}

/** Retrieve the dashboard Bearer token, or an empty string if not set. */
export function getToken(): string {
  return _token ?? "";
}

/** Clear the dashboard Bearer token. Called on logout or session expiry. */
export function clearToken(): void {
  _token = null;
}

/** Returns true if a token is currently set. */
export function hasToken(): boolean {
  return _token !== null && _token.length > 0;
}
