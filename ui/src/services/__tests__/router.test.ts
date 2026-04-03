/**
 * ui/src/services/__tests__/router.test.ts
 *
 * Unit tests for the hash-based router.
 * Pure functions — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { routeToHash, hashToRoute } from "../router.js";
import type { Route } from "../router.js";

// ---------------------------------------------------------------------------
// routeToHash
// ---------------------------------------------------------------------------

describe("routeToHash", () => {
  it("cluster → /", () => {
    expect(routeToHash({ view: "cluster" })).toBe("/");
  });

  it("agents-builder → /instances/:slug/builder", () => {
    expect(routeToHash({ view: "agents-builder", slug: "my-team" })).toBe(
      "/instances/my-team/builder",
    );
  });

  it("instance-settings → /instances/:slug/settings", () => {
    expect(routeToHash({ view: "instance-settings", slug: "prod" })).toBe(
      "/instances/prod/settings",
    );
  });

  it("pilot → /instances/:slug/pilot", () => {
    expect(routeToHash({ view: "pilot", slug: "dev" })).toBe("/instances/dev/pilot");
  });

  it("costs → /instances/:slug/costs", () => {
    expect(routeToHash({ view: "costs", slug: "dev" })).toBe("/instances/dev/costs");
  });

  it("activity → /instances/:slug/activity", () => {
    expect(routeToHash({ view: "activity", slug: "dev" })).toBe("/instances/dev/activity");
  });

  it("memory → /instances/:slug/memory", () => {
    expect(routeToHash({ view: "memory", slug: "dev" })).toBe("/instances/dev/memory");
  });

  it("heartbeat → /instances/:slug/heartbeat", () => {
    expect(routeToHash({ view: "heartbeat", slug: "dev" })).toBe("/instances/dev/heartbeat");
  });

  it("session-logs → /instances/:slug/session-logs", () => {
    expect(routeToHash({ view: "session-logs", slug: "dev" })).toBe("/instances/dev/session-logs");
  });

  it("blueprints → /blueprints", () => {
    expect(routeToHash({ view: "blueprints" })).toBe("/blueprints");
  });

  it("blueprint-builder → /blueprints/:id/builder", () => {
    expect(routeToHash({ view: "blueprint-builder", blueprintId: 42 })).toBe(
      "/blueprints/42/builder",
    );
  });

  it("agent-templates → /agent-templates", () => {
    expect(routeToHash({ view: "agent-templates" })).toBe("/agent-templates");
  });

  it("agent-template-detail → /agent-templates/:id", () => {
    expect(routeToHash({ view: "agent-template-detail", templateId: "tpl-abc" })).toBe(
      "/agent-templates/tpl-abc",
    );
  });

  it("profile → /profile", () => {
    expect(routeToHash({ view: "profile" })).toBe("/profile");
  });
});

// ---------------------------------------------------------------------------
// hashToRoute
// ---------------------------------------------------------------------------

describe("hashToRoute", () => {
  it("empty string → cluster", () => {
    expect(hashToRoute("")).toEqual({ view: "cluster" });
  });

  it("/ → cluster", () => {
    expect(hashToRoute("/")).toEqual({ view: "cluster" });
  });

  it("#/ → cluster", () => {
    expect(hashToRoute("#/")).toEqual({ view: "cluster" });
  });

  it("instances/:slug/builder → agents-builder", () => {
    expect(hashToRoute("instances/my-team/builder")).toEqual({
      view: "agents-builder",
      slug: "my-team",
    });
  });

  it("#/instances/:slug/settings → instance-settings", () => {
    expect(hashToRoute("#/instances/prod/settings")).toEqual({
      view: "instance-settings",
      slug: "prod",
    });
  });

  it("instances/:slug/pilot → pilot", () => {
    expect(hashToRoute("instances/dev/pilot")).toEqual({ view: "pilot", slug: "dev" });
  });

  it("instances/:slug/costs → costs", () => {
    expect(hashToRoute("instances/dev/costs")).toEqual({ view: "costs", slug: "dev" });
  });

  it("instances/:slug/activity → activity", () => {
    expect(hashToRoute("instances/dev/activity")).toEqual({ view: "activity", slug: "dev" });
  });

  it("instances/:slug/memory → memory", () => {
    expect(hashToRoute("instances/dev/memory")).toEqual({ view: "memory", slug: "dev" });
  });

  it("instances/:slug/heartbeat → heartbeat", () => {
    expect(hashToRoute("instances/dev/heartbeat")).toEqual({ view: "heartbeat", slug: "dev" });
  });

  it("instances/:slug/session-logs → session-logs", () => {
    expect(hashToRoute("instances/dev/session-logs")).toEqual({
      view: "session-logs",
      slug: "dev",
    });
  });

  it("blueprints → blueprints", () => {
    expect(hashToRoute("blueprints")).toEqual({ view: "blueprints" });
  });

  it("blueprints/:id/builder → blueprint-builder", () => {
    expect(hashToRoute("blueprints/42/builder")).toEqual({
      view: "blueprint-builder",
      blueprintId: 42,
    });
  });

  it("agent-templates → agent-templates", () => {
    expect(hashToRoute("agent-templates")).toEqual({ view: "agent-templates" });
  });

  it("agent-templates/:id → agent-template-detail", () => {
    expect(hashToRoute("agent-templates/tpl-abc")).toEqual({
      view: "agent-template-detail",
      templateId: "tpl-abc",
    });
  });

  it("profile → profile", () => {
    expect(hashToRoute("profile")).toEqual({ view: "profile" });
  });

  it("unknown path → cluster (fallback)", () => {
    expect(hashToRoute("some/unknown/path")).toEqual({ view: "cluster" });
  });

  it("slug with numbers and hyphens is accepted", () => {
    expect(hashToRoute("instances/team-01/pilot")).toEqual({ view: "pilot", slug: "team-01" });
  });
});

// ---------------------------------------------------------------------------
// Round-trip: routeToHash → hashToRoute
// ---------------------------------------------------------------------------

describe("round-trip routeToHash ↔ hashToRoute", () => {
  const routes: Route[] = [
    { view: "cluster" },
    { view: "agents-builder", slug: "my-team" },
    { view: "instance-settings", slug: "prod" },
    { view: "pilot", slug: "dev" },
    { view: "costs", slug: "dev" },
    { view: "activity", slug: "dev" },
    { view: "memory", slug: "dev" },
    { view: "heartbeat", slug: "dev" },
    { view: "session-logs", slug: "dev" },
    { view: "blueprints" },
    { view: "blueprint-builder", blueprintId: 7 },
    { view: "agent-templates" },
    { view: "agent-template-detail", templateId: "abc-123" },
    { view: "profile" },
  ];

  for (const route of routes) {
    it(`round-trip: ${route.view}`, () => {
      const hash = routeToHash(route);
      const parsed = hashToRoute(hash);
      // initialSection is optional on instance-settings, hashToRoute won't include it
      expect(parsed).toEqual(route);
    });
  }
});
