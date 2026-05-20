/**
 * ui/src/services/__tests__/router.test.ts
 *
 * Unit tests for the path ↔ route converters. Pure functions, no mocks.
 */

import { describe, it, expect } from "vitest";
import { routeToPath, pathToRoute } from "../router.js";
import type { Route } from "../router.js";

// ---------------------------------------------------------------------------
// routeToPath
// ---------------------------------------------------------------------------

describe("routeToPath", () => {
  it("home → /", () => {
    expect(routeToPath({ view: "home" })).toBe("/");
  });

  it("cluster → /instances", () => {
    expect(routeToPath({ view: "cluster" })).toBe("/instances");
  });

  it("agents-builder → /instances/:slug/builder", () => {
    expect(routeToPath({ view: "agents-builder", slug: "my-team" })).toBe(
      "/instances/my-team/builder",
    );
  });

  it("instance-settings → /instances/:slug/settings", () => {
    expect(routeToPath({ view: "instance-settings", slug: "prod" })).toBe(
      "/instances/prod/settings",
    );
  });

  it("pilot → /instances/:slug/pilot", () => {
    expect(routeToPath({ view: "pilot", slug: "dev" })).toBe("/instances/dev/pilot");
  });

  it("costs → /instances/:slug/costs", () => {
    expect(routeToPath({ view: "costs", slug: "dev" })).toBe("/instances/dev/costs");
  });

  it("activity → /instances/:slug/activity", () => {
    expect(routeToPath({ view: "activity", slug: "dev" })).toBe("/instances/dev/activity");
  });

  it("memory → /instances/:slug/memory", () => {
    expect(routeToPath({ view: "memory", slug: "dev" })).toBe("/instances/dev/memory");
  });

  it("heartbeat → /instances/:slug/heartbeat", () => {
    expect(routeToPath({ view: "heartbeat", slug: "dev" })).toBe("/instances/dev/heartbeat");
  });

  it("session-logs → /instances/:slug/session-logs", () => {
    expect(routeToPath({ view: "session-logs", slug: "dev" })).toBe("/instances/dev/session-logs");
  });

  it("blueprints → /blueprints", () => {
    expect(routeToPath({ view: "blueprints" })).toBe("/blueprints");
  });

  it("blueprint-builder → /blueprints/:id/builder", () => {
    expect(routeToPath({ view: "blueprint-builder", blueprintId: 42 })).toBe(
      "/blueprints/42/builder",
    );
  });

  it("agent-templates → /agent-templates", () => {
    expect(routeToPath({ view: "agent-templates" })).toBe("/agent-templates");
  });

  it("agent-template-detail → /agent-templates/:id", () => {
    expect(routeToPath({ view: "agent-template-detail", templateId: "tpl-abc" })).toBe(
      "/agent-templates/tpl-abc",
    );
  });

  it("profile → /profile", () => {
    expect(routeToPath({ view: "profile" })).toBe("/profile");
  });

  it("flow-sessions → /instances/:slug/flows/:flowId/sessions", () => {
    expect(routeToPath({ view: "flow-sessions", slug: "dev", flowId: 5 })).toBe(
      "/instances/dev/flows/5/sessions",
    );
  });

  it("triggers → /instances/:slug/triggers", () => {
    expect(routeToPath({ view: "triggers", slug: "dev" })).toBe("/instances/dev/triggers");
  });

  it("skills → /instances/:slug/skills", () => {
    expect(routeToPath({ view: "skills", slug: "dev" })).toBe("/instances/dev/skills");
  });

  it("skill-detail → /instances/:slug/skills/:id", () => {
    expect(routeToPath({ view: "skill-detail", slug: "dev", skillId: "abc-123" })).toBe(
      "/instances/dev/skills/abc-123",
    );
  });

  it("extension with empty subPath → /ext/:id", () => {
    expect(routeToPath({ view: "extension", id: "admin", subPath: "" })).toBe("/ext/admin");
  });

  it("extension with subPath → /ext/:id/:subPath", () => {
    expect(routeToPath({ view: "extension", id: "admin", subPath: "users/42" })).toBe(
      "/ext/admin/users/42",
    );
  });
});

// ---------------------------------------------------------------------------
// pathToRoute
// ---------------------------------------------------------------------------

describe("pathToRoute", () => {
  it("empty string → home", () => {
    expect(pathToRoute("")).toEqual({ view: "home" });
  });

  it("/ → home", () => {
    expect(pathToRoute("/")).toEqual({ view: "home" });
  });

  it("/home (legacy) → home", () => {
    expect(pathToRoute("/home")).toEqual({ view: "home" });
  });

  it("/instances → cluster", () => {
    expect(pathToRoute("/instances")).toEqual({ view: "cluster" });
  });

  it("/instances/my-team/builder → agents-builder", () => {
    expect(pathToRoute("/instances/my-team/builder")).toEqual({
      view: "agents-builder",
      slug: "my-team",
    });
  });

  it("/instances/prod/settings → instance-settings", () => {
    expect(pathToRoute("/instances/prod/settings")).toEqual({
      view: "instance-settings",
      slug: "prod",
    });
  });

  it("/instances/dev/pilot → pilot", () => {
    expect(pathToRoute("/instances/dev/pilot")).toEqual({ view: "pilot", slug: "dev" });
  });

  it("/instances/dev/triggers → triggers", () => {
    expect(pathToRoute("/instances/dev/triggers")).toEqual({ view: "triggers", slug: "dev" });
  });

  it("/instances/dev/skills → skills", () => {
    expect(pathToRoute("/instances/dev/skills")).toEqual({ view: "skills", slug: "dev" });
  });

  it("/instances/dev/skills/abc-123 → skill-detail", () => {
    expect(pathToRoute("/instances/dev/skills/abc-123")).toEqual({
      view: "skill-detail",
      slug: "dev",
      skillId: "abc-123",
    });
  });

  it("/blueprints → blueprints", () => {
    expect(pathToRoute("/blueprints")).toEqual({ view: "blueprints" });
  });

  it("/blueprints/42/builder → blueprint-builder", () => {
    expect(pathToRoute("/blueprints/42/builder")).toEqual({
      view: "blueprint-builder",
      blueprintId: 42,
    });
  });

  it("/agent-templates → agent-templates", () => {
    expect(pathToRoute("/agent-templates")).toEqual({ view: "agent-templates" });
  });

  it("/agent-templates/tpl-abc → agent-template-detail", () => {
    expect(pathToRoute("/agent-templates/tpl-abc")).toEqual({
      view: "agent-template-detail",
      templateId: "tpl-abc",
    });
  });

  it("/profile → profile", () => {
    expect(pathToRoute("/profile")).toEqual({ view: "profile" });
  });

  it("/instances/dev/flows/5/sessions → flow-sessions", () => {
    expect(pathToRoute("/instances/dev/flows/5/sessions")).toEqual({
      view: "flow-sessions",
      slug: "dev",
      flowId: 5,
    });
  });

  it("/instances/dev/flows/runs/42 → flow-run", () => {
    expect(pathToRoute("/instances/dev/flows/runs/42")).toEqual({
      view: "flow-run",
      slug: "dev",
      runId: 42,
    });
  });

  it("/ext/admin → extension with empty subPath", () => {
    expect(pathToRoute("/ext/admin")).toEqual({ view: "extension", id: "admin", subPath: "" });
  });

  it("/ext/admin/users/123 → extension with subPath", () => {
    expect(pathToRoute("/ext/admin/users/123")).toEqual({
      view: "extension",
      id: "admin",
      subPath: "users/123",
    });
  });

  it("unknown path → home (fallback)", () => {
    expect(pathToRoute("/some/unknown/path")).toEqual({ view: "home" });
  });

  it("slug with numbers and hyphens is accepted", () => {
    expect(pathToRoute("/instances/team-01/pilot")).toEqual({ view: "pilot", slug: "team-01" });
  });
});

// ---------------------------------------------------------------------------
// Round-trip: routeToPath → pathToRoute
// ---------------------------------------------------------------------------

describe("round-trip routeToPath ↔ pathToRoute", () => {
  const routes: Route[] = [
    { view: "home" },
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
    { view: "flow-sessions", slug: "dev", flowId: 5 },
    { view: "profile" },
    { view: "triggers", slug: "dev" },
    { view: "skills", slug: "dev" },
    { view: "skill-detail", slug: "dev", skillId: "abc-123" },
    { view: "extension", id: "admin", subPath: "" },
    { view: "extension", id: "admin", subPath: "users/42" },
  ];

  for (const route of routes) {
    it(`round-trip: ${route.view}${"id" in route ? `/${route.id}${route.subPath ? `/${route.subPath}` : ""}` : ""}`, () => {
      const path = routeToPath(route);
      const parsed = pathToRoute(path);
      // initialSection is optional on instance-settings, pathToRoute won't include it
      expect(parsed).toEqual(route);
    });
  }
});
