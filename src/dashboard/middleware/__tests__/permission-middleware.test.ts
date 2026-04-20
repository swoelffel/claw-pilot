import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  permission,
  registerPermissionChecker,
  resetPermissionChecker,
  type AuthenticatedUser,
  type PermissionContext,
} from "../permission.js";

function mkApp(user: AuthenticatedUser | null, mw: ReturnType<typeof permission>): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.post("/agents", mw, (c) => c.json({ ok: true }));
  return app;
}

const ADMIN: AuthenticatedUser = {
  id: "u1",
  username: "admin",
  role: "admin",
  source: "session",
};

describe("permission() middleware", () => {
  beforeEach(() => {
    resetPermissionChecker();
  });

  it("calls the registered checker with the expected context and allows on { allow: true }", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = mkApp(ADMIN, permission({ action: "agent.create", resource: { kind: "agent" } }));
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      user: ADMIN,
      action: "agent.create",
      resource: { kind: "agent" },
    });
  });

  it("returns 403 PERMISSION_DENIED on { allow: false }", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "forbidden by policy" };
      },
    });
    const app = mkApp(ADMIN, permission({ action: "agent.delete", resource: { kind: "agent" } }));
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("PERMISSION_DENIED");
    expect(body.error).toBe("forbidden by policy");
  });

  it("surfaces requiresApproval in the response body", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "needs approval", requiresApproval: true };
      },
    });
    const app = mkApp(ADMIN, permission({ action: "agent.delete", resource: { kind: "agent" } }));
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { requiresApproval?: boolean };
    expect(body.requiresApproval).toBe(true);
  });

  it("resolves resource.id and resource.orgId from context lazily", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", ADMIN);
      await next();
    });
    app.delete(
      "/agents/:id",
      permission({
        action: "agent.delete",
        resource: {
          kind: "agent",
          id: (c) => c.req.param("id"),
          orgId: () => "org-42",
        },
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/agents/a42", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls[0]?.resource).toEqual({ kind: "agent", id: "a42", orgId: "org-42" });
  });

  it("passes attributes through when attributes() is provided", async () => {
    const calls: PermissionContext[] = [];
    registerPermissionChecker({
      async check(ctx) {
        calls.push(ctx);
        return { allow: true };
      },
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", ADMIN);
      await next();
    });
    app.post(
      "/x",
      permission({
        action: "agent.create",
        resource: { kind: "agent" },
        attributes: () => ({ tag: "sensitive" }),
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/x", { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls[0]?.attributes).toEqual({ tag: "sensitive" });
  });

  it("returns 401 UNAUTHENTICATED when no user is present on context", async () => {
    const app = mkApp(null, permission({ action: "agent.create", resource: { kind: "agent" } }));
    const res = await app.request("/agents", { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});
