/**
 * ui/src/services/extension-views.ts
 *
 * Extension-Point: dashboard-extension-views
 *
 * Lets non-Community editions (Enterprise, third-party plugins) register
 * additional top-level views that the dashboard renders alongside the
 * built-in ones. Each extension owns the path prefix `/ext/<id>` and is
 * responsible for matching, rendering, and (optionally) showing a nav
 * button in the header.
 *
 * Community ships an empty registry. The hook is invoked unconditionally
 * by `app.ts` so consumers do not need a capability check at the call
 * site — capability gating happens at registration time on the consumer
 * side (e.g. EE only registers the RBAC views when `rbac-fine` is set).
 */
import type { TemplateResult } from "lit";

/**
 * Header nav button metadata. Omit on an `ExtensionView` to register a
 * hidden view that is only reachable via deep links from another view.
 */
export interface ExtensionViewNavItem {
  /** Plain label string. Consumers wrap with `msg()` before passing. */
  label: string;
  /** Order hint for sorting nav buttons (lower = earlier). Default 100. */
  order?: number;
}

export interface ExtensionViewMatch {
  /** Parsed sub-path parameters. Empty for a bare `/ext/<id>`. */
  params: Readonly<Record<string, string>>;
}

export interface ExtensionView {
  /** Stable identifier — also the URL prefix `/ext/<id>`. */
  id: string;
  /**
   * Optional sub-path matcher. Receives the substring after `/ext/<id>/`
   * (without a leading slash). Returns parsed params or `null` to refuse.
   * Default: only the empty sub-path matches (i.e. `/ext/<id>` itself).
   */
  matchSubPath?: (subPath: string) => ExtensionViewMatch | null;
  /**
   * Build the sub-path (without leading slash) for navigating to this view.
   * Returns "" for the bare `/ext/<id>`. Called by `buildExtensionPath`.
   */
  toPath: (params?: Readonly<Record<string, string>>) => string;
  /** Render the view body. */
  render: (match: ExtensionViewMatch) => TemplateResult;
  /** Header nav button. Omit to register a hidden view. */
  nav?: ExtensionViewNavItem;
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

const registry = new Map<string, ExtensionView>();

/**
 * Register an extension view. Throws if the id is invalid or already
 * registered. Idempotent re-registration is *not* supported on purpose —
 * a duplicate id signals two consumers fighting for the same slot.
 */
export function registerExtensionView(view: ExtensionView): void {
  if (!ID_RE.test(view.id)) {
    throw new Error(`Extension view id '${view.id}' is invalid. Must match /^[a-z][a-z0-9-]*$/`);
  }
  if (registry.has(view.id)) {
    throw new Error(`Extension view '${view.id}' is already registered`);
  }
  registry.set(view.id, view);
}

/** Test helper — clears the registry. */
export function resetExtensionViews(): void {
  registry.clear();
}

export function getExtensionView(id: string): ExtensionView | undefined {
  return registry.get(id);
}

export function listExtensionViews(): readonly ExtensionView[] {
  return Array.from(registry.values());
}

/**
 * Visible nav items, sorted by `nav.order` (default 100), with stable
 * tie-breaking on `id`. Used by `app.ts` to render header buttons.
 */
export function listExtensionNavItems(): ReadonlyArray<{
  id: string;
  nav: ExtensionViewNavItem;
}> {
  return Array.from(registry.values())
    .filter((v): v is ExtensionView & { nav: ExtensionViewNavItem } => v.nav !== undefined)
    .map((v) => ({ id: v.id, nav: v.nav }))
    .sort((a, b) => {
      const ao = a.nav.order ?? 100;
      const bo = b.nav.order ?? 100;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Resolve an extension `Route` into the registered view + parsed match,
 * or `null` if no extension claims that id (or the sub-path is invalid).
 *
 * Called from `app.ts._renderMain` to render the right extension body.
 */
export function matchExtensionRoute(
  id: string,
  subPath: string,
): { view: ExtensionView; match: ExtensionViewMatch } | null {
  const view = registry.get(id);
  if (!view) return null;
  if (view.matchSubPath) {
    const subMatch = view.matchSubPath(subPath);
    if (subMatch === null) return null;
    return { view, match: subMatch };
  }
  // Default: only the empty sub-path matches.
  if (subPath !== "") return null;
  return { view, match: { params: {} } };
}

/**
 * Compose the canonical pathname for a registered extension. Used by
 * extension consumers that need to deep-link from elsewhere; in-page
 * navigation should go through `navigation.navigateTo()` instead.
 */
export function buildExtensionPath(id: string, params?: Readonly<Record<string, string>>): string {
  const view = registry.get(id);
  if (!view) {
    throw new Error(`Extension view '${id}' is not registered`);
  }
  const sub = view.toPath(params);
  return sub === "" ? `/ext/${id}` : `/ext/${id}/${sub.replace(/^\/+/, "")}`;
}
