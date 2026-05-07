/**
 * ui/src/services/navigation.ts
 *
 * Singleton navigation service. The single source of truth for the dashboard
 * URL — `window.location.pathname` driven via History API.
 *
 * Why a service rather than two-way sync between Lit state and `location.hash`:
 * the previous design (state ⇆ hash) had three ways to drift apart (initial
 * render before URL was read, hashchange feedback loop, extension hash being
 * authoritative for some flows but not others). Centralizing everything here
 * makes the URL the only source of truth and removes the entire class of bugs.
 *
 * Public API:
 *   - getCurrentRoute() — read the current route (initialises on first call)
 *   - navigateTo(route, options?) — push or replace history entry
 *   - onRouteChange(callback) — subscribe to popstate + navigateTo updates
 *
 * Backward compat: legacy hash bookmarks like `/#/blueprints` are detected
 * once at boot and rewritten in place via `history.replaceState` so that
 * the next render sees the canonical path.
 */

import { pathToRoute, routeToPath, type Route } from "./router.js";

type Listener = (route: Route) => void;

let currentRoute: Route = { view: "home" };
let initialized = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const cb of listeners) cb(currentRoute);
}

/**
 * Read the URL once, attach the popstate listener, and migrate legacy
 * hash bookmarks. Idempotent — subsequent calls are no-ops.
 *
 * Must run before the first render so that `getCurrentRoute()` returns the
 * route that matches the URL the user actually loaded. Triggered lazily on
 * the first access to any public function below.
 */
function initFromLocation(): void {
  if (initialized) return;
  initialized = true;

  // Backward compat: if the user landed via a legacy hash bookmark
  // (`/#/blueprints` or just `#blueprints`) AND the pathname is the root,
  // promote the hash to a real path before reading.
  const legacyHash = window.location.hash.replace(/^#\/?/, "");
  if (legacyHash && window.location.pathname === "/") {
    const legacyRoute = pathToRoute(`/${legacyHash}`);
    const newPath = routeToPath(legacyRoute);
    history.replaceState({ route: legacyRoute }, "", newPath);
    currentRoute = legacyRoute;
  } else {
    currentRoute = pathToRoute(window.location.pathname);
  }

  window.addEventListener("popstate", (e: PopStateEvent) => {
    const stateRoute =
      e.state && typeof e.state === "object" && "route" in e.state
        ? (e.state as { route: Route }).route
        : null;
    currentRoute = stateRoute ?? pathToRoute(window.location.pathname);
    notify();
  });
}

/** Read the current route. Initialises the service on first call. */
export function getCurrentRoute(): Route {
  initFromLocation();
  return currentRoute;
}

/**
 * Navigate to a new route. Pushes a new history entry by default;
 * pass `{ replace: true }` to replace the current entry (used for
 * canonicalizing URLs without polluting the back/forward stack).
 *
 * No-op if the target path is identical to the current URL — avoids
 * spurious history entries when a click handler navigates to the
 * already-active view.
 */
export function navigateTo(route: Route, options: { replace?: boolean } = {}): void {
  initFromLocation();
  const path = routeToPath(route);
  const currentPath = window.location.pathname;
  if (path === currentPath && routesEqual(route, currentRoute)) {
    return;
  }
  if (options.replace) {
    history.replaceState({ route }, "", path);
  } else {
    history.pushState({ route }, "", path);
  }
  currentRoute = route;
  notify();
}

/**
 * Convenience wrapper for callers that hold a string path (e.g. from a
 * notification payload or a search result) rather than a typed Route.
 * Parses and delegates to `navigateTo`.
 */
export function navigateToPath(path: string, options: { replace?: boolean } = {}): void {
  navigateTo(pathToRoute(path), options);
}

/**
 * Subscribe to route changes. The listener fires whenever:
 *   - the user navigates via popstate (back/forward, manual hash edit)
 *   - any code calls `navigateTo()`
 *
 * Returns an unsubscribe function — call it on component teardown.
 */
export function onRouteChange(callback: Listener): () => void {
  initFromLocation();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Structural equality for `Route` values. Compares discriminator plus all
 * own enumerable string/number fields, which is sufficient because every
 * Route variant is a flat object with primitive fields.
 */
function routesEqual(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false;
  const aKeys = Object.keys(a) as Array<keyof typeof a>;
  const bKeys = Object.keys(b) as Array<keyof typeof b>;
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (
      (a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]
    ) {
      return false;
    }
  }
  return true;
}

/** Test helper — resets the singleton state. Not exported in production builds. */
export function __resetForTests(): void {
  currentRoute = { view: "home" };
  initialized = false;
  listeners.clear();
}
