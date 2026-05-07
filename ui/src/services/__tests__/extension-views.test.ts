/**
 * ui/src/services/__tests__/extension-views.test.ts
 *
 * Unit tests for the dashboard extension views registry. Pure functions
 * + a module-level Map — `resetExtensionViews()` is called between
 * tests to keep the registry isolated.
 */

import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExtensionPath,
  getExtensionView,
  listExtensionNavItems,
  listExtensionViews,
  matchExtensionRoute,
  registerExtensionView,
  resetExtensionViews,
  type ExtensionView,
} from "../extension-views.js";

function fixture(over: Partial<ExtensionView> = {}): ExtensionView {
  return {
    id: "demo",
    toPath: () => "",
    render: () => html`<div></div>`,
    ...over,
  };
}

afterEach(() => {
  resetExtensionViews();
});

describe("registerExtensionView", () => {
  it("rejects an invalid id", () => {
    expect(() => registerExtensionView(fixture({ id: "Bad-ID" }))).toThrow(/invalid/);
    expect(() => registerExtensionView(fixture({ id: "1leading-digit" }))).toThrow(/invalid/);
    expect(() => registerExtensionView(fixture({ id: "" }))).toThrow(/invalid/);
  });

  it("rejects duplicate registrations", () => {
    registerExtensionView(fixture({ id: "first" }));
    expect(() => registerExtensionView(fixture({ id: "first" }))).toThrow(/already registered/);
  });

  it("getExtensionView returns the registered view", () => {
    const v = fixture({ id: "rbac-roles" });
    registerExtensionView(v);
    expect(getExtensionView("rbac-roles")).toBe(v);
    expect(getExtensionView("absent")).toBeUndefined();
  });
});

describe("listExtensionViews", () => {
  it("returns an empty array on a fresh registry", () => {
    expect(listExtensionViews()).toEqual([]);
  });

  it("returns all registered views", () => {
    const a = fixture({ id: "alpha" });
    const b = fixture({ id: "beta" });
    registerExtensionView(a);
    registerExtensionView(b);
    expect(listExtensionViews()).toHaveLength(2);
    expect(listExtensionViews()).toEqual(expect.arrayContaining([a, b]));
  });
});

describe("listExtensionNavItems", () => {
  it("filters out views without nav metadata", () => {
    registerExtensionView(fixture({ id: "hidden" }));
    registerExtensionView(fixture({ id: "shown", nav: { label: "Shown" } }));
    const items = listExtensionNavItems();
    expect(items.map((i) => i.id)).toEqual(["shown"]);
  });

  it("sorts by order then id", () => {
    registerExtensionView(fixture({ id: "z-first", nav: { label: "Z", order: 10 } }));
    registerExtensionView(fixture({ id: "alpha-default", nav: { label: "A" } }));
    registerExtensionView(fixture({ id: "beta-default", nav: { label: "B" } }));
    const ids = listExtensionNavItems().map((i) => i.id);
    expect(ids).toEqual(["z-first", "alpha-default", "beta-default"]);
  });
});

describe("matchExtensionRoute", () => {
  it("returns null when the id is not registered", () => {
    expect(matchExtensionRoute("ghost", "")).toBeNull();
    registerExtensionView(fixture({ id: "demo" }));
    expect(matchExtensionRoute("other", "")).toBeNull();
  });

  it("matches the bare extension path with default sub-path matcher", () => {
    const v = fixture({ id: "demo" });
    registerExtensionView(v);
    const m = matchExtensionRoute("demo", "");
    expect(m).not.toBeNull();
    expect(m?.view).toBe(v);
    expect(m?.match.params).toEqual({});
  });

  it("rejects sub-paths when no matchSubPath is provided", () => {
    registerExtensionView(fixture({ id: "demo" }));
    expect(matchExtensionRoute("demo", "some-thing")).toBeNull();
  });

  it("delegates to matchSubPath when provided", () => {
    const calls: string[] = [];
    registerExtensionView(
      fixture({
        id: "users",
        matchSubPath: (sub) => {
          calls.push(sub);
          if (sub === "") return { params: {} };
          const m = sub.match(/^(\d+)$/);
          return m ? { params: { id: m[1]! } } : null;
        },
      }),
    );
    expect(matchExtensionRoute("users", "")?.match.params).toEqual({});
    expect(matchExtensionRoute("users", "42")?.match.params).toEqual({ id: "42" });
    expect(matchExtensionRoute("users", "not-a-number")).toBeNull();
    expect(calls).toEqual(["", "42", "not-a-number"]);
  });
});

describe("buildExtensionPath", () => {
  it("returns /ext/<id> when toPath returns empty", () => {
    registerExtensionView(fixture({ id: "demo", toPath: () => "" }));
    expect(buildExtensionPath("demo")).toBe("/ext/demo");
  });

  it("appends the sub-path returned by toPath", () => {
    registerExtensionView(
      fixture({
        id: "users",
        toPath: (params) => (params?.id ? `/${params.id}` : ""),
      }),
    );
    expect(buildExtensionPath("users")).toBe("/ext/users");
    expect(buildExtensionPath("users", { id: "42" })).toBe("/ext/users/42");
  });

  it("throws when the extension is not registered", () => {
    expect(() => buildExtensionPath("ghost")).toThrow(/not registered/);
  });
});
