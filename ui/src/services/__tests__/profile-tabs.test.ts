/**
 * ui/src/services/__tests__/profile-tabs.test.ts
 *
 * Unit tests for the profile-tabs registry. Same shape as
 * `extension-views.test.ts` — pure registry behaviour.
 */

import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  getProfileTab,
  listProfileTabs,
  registerProfileTab,
  resetProfileTabs,
  type ProfileTab,
} from "../profile-tabs.js";

function fixture(over: Partial<ProfileTab> = {}): ProfileTab {
  return {
    id: "demo",
    label: "Demo",
    render: () => html`<div></div>`,
    ...over,
  };
}

afterEach(() => {
  resetProfileTabs();
});

describe("registerProfileTab", () => {
  it("rejects an invalid id", () => {
    expect(() => registerProfileTab(fixture({ id: "Bad-ID" }))).toThrow(/invalid/);
    expect(() => registerProfileTab(fixture({ id: "1leading-digit" }))).toThrow(/invalid/);
    expect(() => registerProfileTab(fixture({ id: "" }))).toThrow(/invalid/);
  });

  it("rejects duplicate registrations", () => {
    registerProfileTab(fixture({ id: "first" }));
    expect(() => registerProfileTab(fixture({ id: "first" }))).toThrow(/already registered/);
  });

  it("getProfileTab returns the registered tab", () => {
    const tab = fixture({ id: "my-access" });
    registerProfileTab(tab);
    expect(getProfileTab("my-access")).toBe(tab);
    expect(getProfileTab("absent")).toBeUndefined();
  });
});

describe("listProfileTabs", () => {
  it("returns an empty array on a fresh registry", () => {
    expect(listProfileTabs()).toEqual([]);
  });

  it("sorts by order then id", () => {
    registerProfileTab(fixture({ id: "z-first", label: "Z", order: 10 }));
    registerProfileTab(fixture({ id: "alpha-default", label: "A" }));
    registerProfileTab(fixture({ id: "beta-default", label: "B" }));
    const ids = listProfileTabs().map((t) => t.id);
    expect(ids).toEqual(["z-first", "alpha-default", "beta-default"]);
  });
});
