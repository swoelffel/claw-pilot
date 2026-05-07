/**
 * ui/src/services/profile-tabs.ts
 *
 * Extension-Point: profile-tabs
 *
 * Lets non-Community editions register additional tabs inside
 * `cp-profile-settings` (`#/profile`). Mirrors the semantics of
 * `extension-views.ts` but is scoped to the profile sidebar — the
 * profile component iterates the registry after rendering its
 * built-in tabs and shows extension entries below them.
 *
 * Community ships an empty registry. Capability gating happens on the
 * consumer side: register from a bootstrap module that is only
 * imported when the relevant capability is set, so Community stays
 * free of any "if Enterprise" branches.
 */
import type { TemplateResult } from "lit";

export interface ProfileTab {
  /** Stable identifier — used as the key in `_activeSection`. */
  id: string;
  /** Plain label string. Consumers wrap with `msg()` before passing. */
  label: string;
  /** Order hint for sorting (lower = earlier). Default 100. */
  order?: number;
  /** Tab body renderer. Invoked when the tab is active. */
  render: () => TemplateResult;
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const registry = new Map<string, ProfileTab>();

/** Throws on invalid id and on duplicate registration. */
export function registerProfileTab(tab: ProfileTab): void {
  if (!ID_RE.test(tab.id)) {
    throw new Error(`Profile tab id '${tab.id}' is invalid. Must match /^[a-z][a-z0-9-]*$/`);
  }
  if (registry.has(tab.id)) {
    throw new Error(`Profile tab '${tab.id}' is already registered`);
  }
  registry.set(tab.id, tab);
}

/** Test helper — clears the registry. */
export function resetProfileTabs(): void {
  registry.clear();
}

export function getProfileTab(id: string): ProfileTab | undefined {
  return registry.get(id);
}

/**
 * Tabs in render order — sorted by `order` (default 100), tie-broken
 * by `id`. Used by `cp-profile-settings` to render the sidebar
 * extension section.
 */
export function listProfileTabs(): readonly ProfileTab[] {
  return Array.from(registry.values()).sort((a, b) => {
    const ao = a.order ?? 100;
    const bo = b.order ?? 100;
    if (ao !== bo) return ao - bo;
    return a.id.localeCompare(b.id);
  });
}
