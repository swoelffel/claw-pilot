/**
 * dashboard/__tests__/request-id.test.ts
 *
 * Unit tests for the request ID middleware.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requestIdMiddleware } from "../request-id.js";

function createApp(): Hono {
  const app = new Hono();
  app.use("*", requestIdMiddleware());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/test", (c) => c.json({ id: (c as any).get("requestId") }));
  return app;
}

describe("requestIdMiddleware", () => {
  it("sets X-Request-Id response header", async () => {
    const app = createApp();
    const res = await app.request("/test");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("generates an ID of 12 characters", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const id = res.headers.get("X-Request-Id")!;
    expect(id).toHaveLength(12);
  });

  it("exposes the ID via context variable", async () => {
    const app = createApp();
    const res = await app.request("/test");
    const body = (await res.json()) as { id: string };
    const headerId = res.headers.get("X-Request-Id");
    expect(body.id).toBe(headerId);
  });

  it("generates unique IDs per request", async () => {
    const app = createApp();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/test");
      ids.add(res.headers.get("X-Request-Id")!);
    }
    expect(ids.size).toBe(10);
  });

  it("does not interfere with route execution", async () => {
    const app = createApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});
