import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  registerPermissionChecker,
  resetPermissionChecker,
  type AuthenticatedUser,
} from "../../middleware/permission.js";
import { registerPermissionDiagnosticsRoutes } from "../permission-diagnostics.js";

const USER: AuthenticatedUser = {
  id: "sso:00u123",
  username: "alice@example.com",
  role: "operator",
  source: "session",
};

function app(): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", USER);
    await next();
  });
  registerPermissionDiagnosticsRoutes(app);
  return app;
}

describe("effective permission inspector", () => {
  beforeEach(resetPermissionChecker);

  it("returns principal, target, matched grant, and denial reason", async () => {
    registerPermissionChecker({
      async check(ctx) {
        if (ctx.action === "auth.permission.inspect") return { allow: true };
        return {
          allow: false,
          reason: "team boundary",
          matchedGrant: {
            id: "grant-7",
            role: "operator",
            effect: "deny",
            action: "agent.delete",
            resource: "agent:a-9",
          },
        };
      },
    });

    const res = await app().request("/api/auth/permissions/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "agent.delete", resource: { kind: "agent", id: "a-9" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      principal: USER,
      action: "agent.delete",
      resource: { kind: "agent", id: "a-9" },
      allowed: false,
      matchedGrant: {
        id: "grant-7",
        role: "operator",
        effect: "deny",
        action: "agent.delete",
        resource: "agent:a-9",
      },
      denialReason: "team boundary",
    });
  });

  it("protects the inspector itself", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "diagnostics restricted" };
      },
    });
    const res = await app().request("/api/auth/permissions/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "agent.read", resource: { kind: "agent" } }),
    });
    expect(res.status).toBe(403);
  });
});
