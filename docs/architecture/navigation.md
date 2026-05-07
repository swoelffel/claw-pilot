# Dashboard navigation

The dashboard is a single-page app served at `/`. Routing is path-based
(History API, RESTful URLs like `/blueprints` and `/instances/prod/pilot`)
with a single source of truth: `window.location.pathname`.

## Why a service

Earlier versions used hash-based routing (`#/blueprints`) with two-way sync
between the Lit `_route` state and `location.hash`. That design had three
desync paths:

1. The first render happened with a default `_route = "home"` before the
   URL was read, then `_syncHashFromRoute` overwrote a non-default URL
   like `#/blueprints` back to `#/home`.
2. Built-in nav-tab clicks mutated `_route` only and relied on the sync
   to push the hash; a defensive short-circuit added for extension hashes
   suppressed the sync entirely when leaving an extension view.
3. Extensions wrote `location.hash` directly, side-stepping the route
   state, which made the active-tab indicator inconsistent.

The fix is to centralise all navigation in a service so the URL is the
only source of truth and Lit state mirrors it via a subscription.

## Architecture

```
                          ┌──────────────────────┐
                          │  navigation service  │
                          │  ui/src/services/    │
                          │  navigation.ts       │
                          └──────────┬───────────┘
                                     │
   exports navigateTo(route) ────────┤
   exports navigateToPath(path) ─────┤
   exports getCurrentRoute() ────────┤
   exports onRouteChange(callback) ──┘

                                     │
                                     │ history.pushState
                                     ▼
                          ┌──────────────────────┐
                          │  window.location     │  ← single source of truth
                          │  + popstate event    │
                          └──────────┬───────────┘
                                     │
                                     │ popstate
                                     ▼
                          ┌──────────────────────┐
                          │  app.ts (cp-app)     │
                          │  subscribes to the   │
                          │  service, renders    │
                          │  the right view      │
                          └──────────────────────┘
```

## Public API

`ui/src/services/navigation.ts`:

```typescript
function getCurrentRoute(): Route
function navigateTo(route: Route, options?: { replace?: boolean }): void
function navigateToPath(path: string, options?: { replace?: boolean }): void
function onRouteChange(callback: (route: Route) => void): () => void
```

- `getCurrentRoute` reads the URL on first call, attaches the `popstate`
  listener, and returns the current route. Idempotent.
- `navigateTo` pushes (or replaces) a history entry and notifies all
  subscribers. No-op when the target is the active route.
- `navigateToPath` is a thin wrapper for callers holding a string path
  (e.g. notification payloads, search results).
- `onRouteChange` returns an unsubscribe function — call it on component
  teardown to avoid memory leaks.

## Discipline rule

**Never write `window.location.*` or `history.*` directly outside this
service.** All navigation goes through `navigateTo` / `navigateToPath`.

This keeps the URL ↔ state contract single-source: every transition
flows through one funnel, every subscriber sees the same sequence of
events, and there are no parallel paths that can drift.

The `cp-app` Lit component is the only consumer of `onRouteChange`. It
mirrors the service into its own `_route` reactive state and renders
the right view. Child components dispatch `@navigate` custom events;
the parent translates them into `navigateTo` calls.

## Backward compatibility

Legacy hash bookmarks (`/#/blueprints`, `/#/instances/prod/settings`) are
detected once at boot. If `window.location.hash` is non-empty AND
`window.location.pathname === "/"`, the service:

1. Parses the hash as a path.
2. Calls `history.replaceState` to rewrite the URL in place.
3. Sets the current route from the parsed path.

The next render sees the canonical path. No further hash logic runs.

This handles bookmarks created during the hash era without breaking
them. Future cleanup can drop this branch once telemetry confirms zero
hash arrivals.

## Server requirement

The dashboard server must serve `index.html` for any unknown path so the
SPA can route client-side. This is already in place at
`src/dashboard/server.ts:437` (`app.get("*", ...)` → returns `index.html`
with `Cache-Control: no-cache`).

If a deployment introduces a custom reverse-proxy, the same fallback
must be configured upstream.

## Extension views

Third-party / Enterprise editions register extension views via
`registerExtensionView({ id, render, toPath, matchSubPath?, nav? })`.
Each extension owns the path prefix `/ext/<id>` and renders into the
main area when the route matches.

The `Route` union has a dedicated `extension` variant
(`{ view: "extension"; id: string; subPath: string }`). Built-in routes
take precedence; the extension is rendered only if the URL matches an
`/ext/<id>` prefix.

The nav-button label, sub-path matcher, and `toPath` builder are owned
by each extension. The dashboard simply lists nav items, navigates by
pushing the extension `Route`, and resolves the registered view at
render time via `matchExtensionRoute(id, subPath)`.

## Testing

- `ui/src/services/__tests__/navigation.test.ts` — unit tests against
  jsdom for the service (init, navigateTo, popstate, backward compat).
- `ui/src/services/__tests__/router.test.ts` — pure unit tests for the
  path ↔ route converters.
- `ui/src/services/__tests__/extension-views.test.ts` — registry tests.
- `e2e-browser/tests/navigation.spec.ts` — Playwright E2E covering the
  three regressions that motivated this design (F5 keeps the route,
  leaving an extension updates the URL, legacy hash bookmark redirects).

## Files

| File | Purpose |
|---|---|
| `ui/src/services/router.ts` | Pure path ↔ Route converters (no side effects). |
| `ui/src/services/navigation.ts` | Stateful navigation service (singleton). |
| `ui/src/services/extension-views.ts` | Registry for `/ext/<id>` views. |
| `ui/src/app.ts` | The only consumer of `onRouteChange` — owns the rendered route state. |
