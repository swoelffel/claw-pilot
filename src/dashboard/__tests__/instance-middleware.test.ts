// src/dashboard/__tests__/instance-middleware.test.ts
//
// Unit tests for the instance middleware that resolves :slug param
// to a registered instance and makes it available via getInstanceContext.

import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { instanceMiddleware, getInstanceContext } from "../routes/_instance-middleware.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Typed JSON parse helper — avoids `body is of type unknown` TS errors in tests. */
async function json(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock registry
// ---------------------------------------------------------------------------

const mockGetInstance = vi.fn();
const mockRegistry = { getInstance: mockGetInstance } as any;

const FAKE_INSTANCE = {
  slug: "my-team",
  port: 18789,
  state: "running",
  configPath: "/opt/claw-pilot/instances/my-team",
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: Hono;

beforeEach(() => {
  app = new Hono();
  // Apply middleware to slug-scoped routes
  app.use("/api/instances/:slug/*", instanceMiddleware(mockRegistry));
  // Test route that reads the context
  app.get("/api/instances/:slug/test", (c) => {
    const { instance, slug } = getInstanceContext(c);
    return c.json({ slug, port: instance.port });
  });
  // Route without :slug param — middleware should skip
  app.get("/api/instances", (c) => c.json({ list: true }));
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("instanceMiddleware", () => {
  it("returns instance data when instance exists", async () => {
    mockGetInstance.mockReturnValue(FAKE_INSTANCE);
    const res = await app.request("/api/instances/my-team/test");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ slug: "my-team", port: 18789 });
  });

  it("returns 404 when instance not found", async () => {
    mockGetInstance.mockReturnValue(undefined);
    const res = await app.request("/api/instances/ghost/test");
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("NOT_FOUND");
  });

  it("sets slug on context correctly", async () => {
    mockGetInstance.mockReturnValue(FAKE_INSTANCE);
    const res = await app.request("/api/instances/my-team/test");
    expect((await json(res)).slug).toBe("my-team");
  });

  it("calls registry.getInstance with the slug param", async () => {
    mockGetInstance.mockReturnValue(FAKE_INSTANCE);
    await app.request("/api/instances/my-team/test");
    expect(mockGetInstance).toHaveBeenCalledWith("my-team");
  });

  it("calls next() allowing the route handler to execute", async () => {
    mockGetInstance.mockReturnValue(FAKE_INSTANCE);
    const res = await app.request("/api/instances/my-team/test");
    // If next() was NOT called, the route handler would never produce a 200 JSON body
    expect(res.status).toBe(200);
    expect((await json(res)).port).toBe(18789);
  });

  it("does not call registry when slug is 'discover'", async () => {
    // The middleware skips the "discover" slug as a special case
    app.get("/api/instances/discover/scan", (c) => c.json({ scanned: true }));
    const res = await app.request("/api/instances/discover/scan");
    expect(res.status).toBe(200);
    expect(mockGetInstance).not.toHaveBeenCalled();
  });

  it("passes through different slugs independently", async () => {
    const instanceA = { ...FAKE_INSTANCE, slug: "alpha", port: 18790 };
    const instanceB = { ...FAKE_INSTANCE, slug: "beta", port: 18791 };
    mockGetInstance.mockImplementation((slug: string) => {
      if (slug === "alpha") return instanceA;
      if (slug === "beta") return instanceB;
      return undefined;
    });

    const resA = await app.request("/api/instances/alpha/test");
    expect(await json(resA)).toEqual({ slug: "alpha", port: 18790 });

    const resB = await app.request("/api/instances/beta/test");
    expect(await json(resB)).toEqual({ slug: "beta", port: 18791 });
  });

  it("returns 404 JSON with error message", async () => {
    mockGetInstance.mockReturnValue(undefined);
    const res = await app.request("/api/instances/nope/test");
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toBe("Not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  it("handles slugs with hyphens and numbers", async () => {
    const inst = { ...FAKE_INSTANCE, slug: "team-42-prod", port: 18800 };
    mockGetInstance.mockReturnValue(inst);
    const res = await app.request("/api/instances/team-42-prod/test");
    expect(res.status).toBe(200);
    expect((await json(res)).slug).toBe("team-42-prod");
  });

  it("does not interfere with routes outside the middleware scope", async () => {
    const res = await app.request("/api/instances");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ list: true });
    // Registry should NOT have been called for a non-slug route
    expect(mockGetInstance).not.toHaveBeenCalled();
  });
});
