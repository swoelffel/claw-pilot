// src/dashboard/__tests__/auth-context.test.ts
//
// Integration tests: verify that the auth middleware publishes AuthenticatedUser
// on the Hono context via c.set("user", ...) for all three auth paths:
//   1. Session cookie path → DB user row, source="session"
//   2. Bearer token path   → synthetic admin, source="bearer"
//   3. Query-token SSE path → same synthetic admin, source="bearer"

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Hono } from "hono";

// --- Mocks: same pattern as server-app.test.ts ---

const mockMonitorStop = vi.fn();
const mockModelDiscoveryStop = vi.fn();

vi.mock("../../core/health.js", () => {
  return {
    HealthChecker: class MockHealthChecker {
      check = vi.fn().mockResolvedValue([]);
      checkAll = vi.fn().mockResolvedValue([]);
    },
  };
});
vi.mock("../../core/lifecycle.js", () => {
  return {
    Lifecycle: class MockLifecycle {
      start = vi.fn();
      stop = vi.fn();
      restart = vi.fn();
    },
  };
});
vi.mock("../monitor.js", () => {
  return {
    Monitor: class MockMonitor {
      start = vi.fn();
      stop = mockMonitorStop;
      addClient = vi.fn();
      setTransitioning = vi.fn();
      clearTransitioning = vi.fn();
      broadcastNotification = vi.fn();
      static setNotificationBroadcaster = vi.fn();
      static notifyNewNotification = vi.fn();
    },
  };
});
vi.mock("../../core/self-update-checker.js", () => {
  return {
    SelfUpdateChecker: class MockSelfUpdateChecker {},
  };
});
vi.mock("../../core/self-updater.js", () => {
  return {
    SelfUpdater: class MockSelfUpdater {},
  };
});
vi.mock("../../core/model-discovery/service.js", () => {
  return {
    ModelDiscoveryService: class MockModelDiscoveryService {
      start = vi.fn();
      stop = mockModelDiscoveryStop;
      getProviders = () => [];
      getModelCatalog = () => [];
      findModel = () => undefined;
      invalidateProvider = () => {};
    },
  };
});

vi.mock("../../lib/xdg.js", () => ({
  resolveXdgRuntimeDir: vi.fn().mockResolvedValue("/run/user/1000"),
}));

vi.mock("../routes/instances.js", () => ({ registerInstanceRoutes: vi.fn() }));
vi.mock("../routes/blueprints.js", () => ({ registerBlueprintRoutes: vi.fn() }));
vi.mock("../routes/teams.js", () => ({ registerTeamRoutes: vi.fn() }));
vi.mock("../routes/system.js", () => ({ registerSystemRoutes: vi.fn() }));
vi.mock("../routes/agent-blueprints.js", () => ({ registerAgentBlueprintRoutes: vi.fn() }));
vi.mock("../routes/profile.js", () => ({ registerProfileRoutes: vi.fn() }));
vi.mock("../routes/named-keys.js", () => ({ registerNamedKeyRoutes: vi.fn() }));
vi.mock("../routes/notifications.js", () => ({ registerNotificationRoutes: vi.fn() }));
vi.mock("../../core/repositories/notification-repository.js", () => ({
  pruneNotifications: vi.fn(() => 0),
}));

// Mock registerSearchRoutes to inject the probe route — registered BEFORE the SPA fallback
// wildcard, AFTER the auth middleware, so c.get("user") is populated.
vi.mock("../routes/search.js", () => ({
  registerSearchRoutes: vi.fn((app: Hono) => {
    app.get("/api/_probe", (c) => {
      const user = c.get("user") ?? null;
      return c.json({ user });
    });
  }),
}));

// NOTE: auth routes are NOT mocked — we need real login to get a session cookie.

// Import permission module to pull in Hono ContextVariableMap augmentation
// (AuthenticatedUser → c.get("user") typed without cast).
import "../middleware/permission.js";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { SessionStore } from "../session-store.js";
import { hashPassword } from "../../core/auth.js";
import { constants } from "../../lib/constants.js";
import { buildDashboardApp } from "../server.js";
import type { DashboardOptions } from "../server.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-server-token-64chars-hex-0123456789abcdef0123456789abcdef01";
const TEST_PASSWORD = "TestPassword123!";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
  return res.json();
}

/** Extract Set-Cookie header value for a named cookie. */
function getCookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let db: ReturnType<typeof initDatabase>;
let tmpDir: string;
let options: DashboardOptions;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-auth-ctx-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const sessionStore = new SessionStore(db);

  // Seed admin user with known password (same pattern as auth-routes.test.ts)
  const hash = await hashPassword(TEST_PASSWORD);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    constants.ADMIN_USERNAME,
    hash,
  );

  options = {
    port: 0,
    token: TEST_TOKEN,
    registry,
    conn,
    sessionStore,
    db,
  };

  mockMonitorStop.mockClear();
  mockModelDiscoveryStop.mockClear();
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth middleware — AuthenticatedUser on context", () => {
  it("session cookie path: publishes DB user row with source='session'", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      // 1. Login to get a session cookie
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: constants.ADMIN_USERNAME, password: TEST_PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const sid = getCookieValue(loginRes, constants.SESSION_COOKIE_NAME);
      expect(sid).toBeTruthy();

      // 2. Hit the probe with the session cookie
      const probeRes = await app.request("/api/_probe", {
        headers: { Cookie: `${constants.SESSION_COOKIE_NAME}=${sid}` },
      });
      expect(probeRes.status).toBe(200);
      const body = await json(probeRes);

      expect(body.user).not.toBeNull();
      expect(typeof body.user.id).toBe("string");
      expect(body.user.id.length).toBeGreaterThan(0);
      expect(body.user.username).toBe(constants.ADMIN_USERNAME);
      expect(body.user.role).toBe("admin");
      expect(body.user.source).toBe("session");
    } finally {
      cleanup();
    }
  });

  it("bearer token path: publishes synthetic admin identity with source='bearer'", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const probeRes = await app.request("/api/_probe", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(probeRes.status).toBe(200);
      const body = await json(probeRes);

      expect(body.user).toEqual({
        id: "bearer",
        username: "bearer",
        role: "admin",
        source: "bearer",
      });
    } finally {
      cleanup();
    }
  });

  it("query-token SSE path: publishes synthetic admin identity with source='bearer'", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const probeRes = await app.request(`/api/_probe?token=${TEST_TOKEN}`);
      expect(probeRes.status).toBe(200);
      const body = await json(probeRes);

      expect(body.user).toEqual({
        id: "bearer",
        username: "bearer",
        role: "admin",
        source: "bearer",
      });
    } finally {
      cleanup();
    }
  });
});
