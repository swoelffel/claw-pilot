/**
 * @vitest-environment jsdom
 *
 * ui/src/services/__tests__/navigation.test.ts
 *
 * Unit tests for the navigation service. Uses jsdom for `window.location`,
 * `history.pushState`, and `PopStateEvent`. The rest of the UI tests stay
 * in the default `node` environment per `vitest.ui.config.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getCurrentRoute, navigateTo, onRouteChange, __resetForTests } from "../navigation.js";
import type { Route } from "../router.js";

/**
 * Reset jsdom URL + service state before every test. We must call
 * __resetForTests() so the lazy init runs again on the next public call,
 * picking up whatever URL the test set up.
 */
function setUrl(pathname: string, hash = ""): void {
  history.replaceState(null, "", `${pathname}${hash}`);
}

beforeEach(() => {
  setUrl("/");
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getCurrentRoute()
// ---------------------------------------------------------------------------

describe("getCurrentRoute()", () => {
  it("/ → home", () => {
    setUrl("/");
    expect(getCurrentRoute()).toEqual({ view: "home" });
  });

  it("/blueprints → blueprints", () => {
    setUrl("/blueprints");
    expect(getCurrentRoute()).toEqual({ view: "blueprints" });
  });

  it("/instances → cluster", () => {
    setUrl("/instances");
    expect(getCurrentRoute()).toEqual({ view: "cluster" });
  });

  it("/instances/prod/pilot → pilot", () => {
    setUrl("/instances/prod/pilot");
    expect(getCurrentRoute()).toEqual({ view: "pilot", slug: "prod" });
  });

  it("/instances/dev/flows/runs/42 → flow-run", () => {
    setUrl("/instances/dev/flows/runs/42");
    expect(getCurrentRoute()).toEqual({ view: "flow-run", slug: "dev", runId: 42 });
  });

  it("/ext/admin → extension with empty subPath", () => {
    setUrl("/ext/admin");
    expect(getCurrentRoute()).toEqual({ view: "extension", id: "admin", subPath: "" });
  });

  it("/ext/admin/users/123 → extension with subPath", () => {
    setUrl("/ext/admin/users/123");
    expect(getCurrentRoute()).toEqual({
      view: "extension",
      id: "admin",
      subPath: "users/123",
    });
  });

  it("unknown path → home fallback", () => {
    setUrl("/some/unknown/garbage");
    expect(getCurrentRoute()).toEqual({ view: "home" });
  });

  it("idempotent on repeated calls", () => {
    setUrl("/blueprints");
    const first = getCurrentRoute();
    const second = getCurrentRoute();
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Backward compat: legacy hash bookmarks
// ---------------------------------------------------------------------------

describe("backward compat — legacy hash bookmarks", () => {
  it("/#/blueprints rewrites to /blueprints", () => {
    setUrl("/", "#/blueprints");
    expect(getCurrentRoute()).toEqual({ view: "blueprints" });
    expect(window.location.pathname).toBe("/blueprints");
    expect(window.location.hash).toBe("");
  });

  it("/#/instances/prod/settings rewrites to /instances/prod/settings", () => {
    setUrl("/", "#/instances/prod/settings");
    expect(getCurrentRoute()).toEqual({ view: "instance-settings", slug: "prod" });
    expect(window.location.pathname).toBe("/instances/prod/settings");
  });

  it("/#blueprints (no leading slash in hash) also rewrites", () => {
    setUrl("/", "#blueprints");
    expect(getCurrentRoute()).toEqual({ view: "blueprints" });
    expect(window.location.pathname).toBe("/blueprints");
  });

  it("/#/ext/admin rewrites to /ext/admin", () => {
    setUrl("/", "#/ext/admin");
    expect(getCurrentRoute()).toEqual({ view: "extension", id: "admin", subPath: "" });
    expect(window.location.pathname).toBe("/ext/admin");
  });

  it("hash on a non-root path is ignored (path wins)", () => {
    setUrl("/blueprints", "#/instances");
    expect(getCurrentRoute()).toEqual({ view: "blueprints" });
    // We do not strip the hash in this branch — only the root-with-hash bookmark case is migrated.
    expect(window.location.pathname).toBe("/blueprints");
  });

  it("empty hash on root falls through to home", () => {
    setUrl("/", "");
    expect(getCurrentRoute()).toEqual({ view: "home" });
  });
});

// ---------------------------------------------------------------------------
// navigateTo()
// ---------------------------------------------------------------------------

describe("navigateTo()", () => {
  it("pushes a new history entry by default", () => {
    setUrl("/");
    const pushSpy = vi.spyOn(history, "pushState");

    navigateTo({ view: "blueprints" });

    expect(pushSpy).toHaveBeenCalledOnce();
    expect(pushSpy.mock.calls[0]![2]).toBe("/blueprints");
    expect(window.location.pathname).toBe("/blueprints");
    expect(getCurrentRoute()).toEqual({ view: "blueprints" });
  });

  it("uses replaceState when { replace: true }", () => {
    setUrl("/");
    const pushSpy = vi.spyOn(history, "pushState");
    const replaceSpy = vi.spyOn(history, "replaceState");

    navigateTo({ view: "agent-templates" }, { replace: true });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/agent-templates");
  });

  it("no-op when target equals current route", () => {
    setUrl("/blueprints");
    const pushSpy = vi.spyOn(history, "pushState");

    navigateTo({ view: "blueprints" });

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("notifies listeners on navigation", () => {
    setUrl("/");
    const listener = vi.fn();
    onRouteChange(listener);

    navigateTo({ view: "cluster" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ view: "cluster" });
  });

  it("handles instance-scoped routes", () => {
    setUrl("/");
    navigateTo({ view: "pilot", slug: "prod" });
    expect(window.location.pathname).toBe("/instances/prod/pilot");
    expect(getCurrentRoute()).toEqual({ view: "pilot", slug: "prod" });
  });

  it("handles extension routes", () => {
    setUrl("/");
    navigateTo({ view: "extension", id: "admin", subPath: "" });
    expect(window.location.pathname).toBe("/ext/admin");
    expect(getCurrentRoute()).toEqual({ view: "extension", id: "admin", subPath: "" });
  });

  it("handles extension routes with subPath", () => {
    setUrl("/");
    navigateTo({ view: "extension", id: "admin", subPath: "users/42" });
    expect(window.location.pathname).toBe("/ext/admin/users/42");
  });

  it("home navigates to /", () => {
    setUrl("/blueprints");
    navigateTo({ view: "home" });
    expect(window.location.pathname).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// onRouteChange()
// ---------------------------------------------------------------------------

describe("onRouteChange()", () => {
  it("returns an unsubscribe function", () => {
    setUrl("/");
    const listener = vi.fn();
    const unsubscribe = onRouteChange(listener);

    navigateTo({ view: "blueprints" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    navigateTo({ view: "agent-templates" });
    expect(listener).toHaveBeenCalledTimes(1); // not called after unsubscribe
  });

  it("supports multiple listeners", () => {
    setUrl("/");
    const a = vi.fn();
    const b = vi.fn();
    onRouteChange(a);
    onRouteChange(b);

    navigateTo({ view: "blueprints" });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("fires on popstate with state.route", () => {
    setUrl("/");
    const listener = vi.fn();
    onRouteChange(listener);

    // Simulate browser back/forward — dispatch a popstate with a state object.
    const route: Route = { view: "blueprints" };
    history.pushState({ route }, "", "/blueprints");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { route } }));

    expect(listener).toHaveBeenCalledWith({ view: "blueprints" });
  });

  it("fires on popstate without state.route by re-parsing pathname", () => {
    setUrl("/");
    const listener = vi.fn();
    onRouteChange(listener);

    // Simulate a popstate where state is null (e.g., browser navigated to a
    // history entry that was created via location.assign rather than pushState).
    history.pushState(null, "", "/agent-templates");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(listener).toHaveBeenCalledWith({ view: "agent-templates" });
  });
});
