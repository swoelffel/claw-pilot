// src/dashboard/__tests__/notification-routes.test.ts
//
// Integration tests for the notification inbox API routes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { TokenCache } from "../token-cache.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerNotificationRoutes } from "../routes/notifications.js";
import {
  insertNotification,
  countUnread,
} from "../../core/repositories/notification-repository.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-notif-token-64chars-hex-0123456789abcdef0123456789abcdef00";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function json(res: Response): Promise<Json> {
  return res.json();
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

let app: Hono;
let db: ReturnType<typeof initDatabase>;
let tmpDir: string;

function seedNotification(opts?: {
  severity?: "info" | "warning" | "error" | "success";
  title?: string;
}): void {
  insertNotification(db, {
    instanceSlug: "demo",
    eventType: "task.status_changed",
    severity: opts?.severity ?? "info",
    title: opts?.title ?? "Test notification",
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-notif-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const tokenCache = new TokenCache(conn);

  app = new Hono();

  // Auth middleware
  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    // Synthetic admin user required by permission() middleware which reads c.get("user").
    // The bare test harness has no server-level auth middleware, so we inject it here.
    c.set("user", { id: "test", username: "admin", role: "admin", source: "session" });
    await next();
  });

  const deps = {
    registry,
    conn,
    health: {} as RouteDeps["health"],
    lifecycle: {} as RouteDeps["lifecycle"],
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    } as unknown as RouteDeps["monitor"],
    selfUpdateChecker: {} as RouteDeps["selfUpdateChecker"],
    selfUpdater: {} as RouteDeps["selfUpdater"],
    tokenCache,
    xdgRuntimeDir: tmpDir,
    sessionStore: new SessionStore(db),
    startedAt: Date.now(),
    db,
    modelDiscovery: {} as RouteDeps["modelDiscovery"],
  } satisfies RouteDeps;

  registerNotificationRoutes(app, deps);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

describe("GET /api/notifications", () => {
  it("returns empty list when no notifications", async () => {
    const res = await app.request("/api/notifications", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.notifications).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });

  it("returns notifications in descending order", async () => {
    seedNotification({ title: "First" });
    seedNotification({ title: "Second" });
    seedNotification({ title: "Third" });

    const res = await app.request("/api/notifications", { headers: authHeaders() });
    const body = await json(res);
    expect(body.notifications).toHaveLength(3);
    expect(body.notifications[0].title).toBe("Third");
    expect(body.notifications[2].title).toBe("First");
  });

  it("supports pagination via cursor and limit", async () => {
    for (let i = 0; i < 5; i++) seedNotification({ title: `N${i}` });

    const res1 = await app.request("/api/notifications?limit=2", { headers: authHeaders() });
    const body1 = await json(res1);
    expect(body1.notifications).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const res2 = await app.request(`/api/notifications?limit=2&cursor=${body1.nextCursor}`, {
      headers: authHeaders(),
    });
    const body2 = await json(res2);
    expect(body2.notifications).toHaveLength(2);
  });

  it("filters unread only", async () => {
    seedNotification({ title: "Unread" });
    seedNotification({ title: "Read" });
    // Mark the second as read via direct DB
    const all = await app.request("/api/notifications", { headers: authHeaders() });
    const allBody = await json(all);
    await app.request(`/api/notifications/${allBody.notifications[0].id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
    });

    const res = await app.request("/api/notifications?unread_only=true", {
      headers: authHeaders(),
    });
    const body = await json(res);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].is_read).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------

describe("GET /api/notifications/unread-count", () => {
  it("returns 0 when no notifications", async () => {
    const res = await app.request("/api/notifications/unread-count", { headers: authHeaders() });
    const body = await json(res);
    expect(body.count).toBe(0);
  });

  it("returns correct unread count", async () => {
    seedNotification();
    seedNotification();
    seedNotification();

    const res = await app.request("/api/notifications/unread-count", { headers: authHeaders() });
    const body = await json(res);
    expect(body.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/:id/read
// ---------------------------------------------------------------------------

describe("PATCH /api/notifications/:id/read", () => {
  it("marks a notification as read", async () => {
    seedNotification();
    const list = await json(await app.request("/api/notifications", { headers: authHeaders() }));
    const id = list.notifications[0].id;

    const res = await app.request(`/api/notifications/${id}/read`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    expect(countUnread(db)).toBe(0);
  });

  it("returns 400 for invalid id", async () => {
    const res = await app.request("/api/notifications/abc/read", {
      method: "PATCH",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-all-read
// ---------------------------------------------------------------------------

describe("POST /api/notifications/mark-all-read", () => {
  it("marks all notifications as read", async () => {
    seedNotification();
    seedNotification();
    seedNotification();
    expect(countUnread(db)).toBe(3);

    const res = await app.request("/api/notifications/mark-all-read", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    expect(countUnread(db)).toBe(0);
  });
});
