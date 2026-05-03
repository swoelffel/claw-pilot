// src/dashboard/__tests__/server-app.test.ts
//
// Tests for buildDashboardApp() — verifies the wired Hono app structure:
// health endpoint, auth middleware, security headers, error handler, SPA fallback, cleanup.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Hono } from "hono";

// --- Mocks: constructors for internally-created dependencies ---

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

// Import ClawPilotError via vi.hoisted so it is available inside vi.mock factories.
const { ClawPilotError: HoistedClawPilotError } = await vi.hoisted(
  () => import("../../lib/errors.js"),
);

// Mock route registrations — registerInstanceRoutes injects test routes
// so they are registered BEFORE the SPA wildcard catch-all.
vi.mock("../routes/instances.js", () => ({
  registerInstanceRoutes: vi.fn((app: Hono) => {
    app.get("/api/test-auth", (c) => c.json({ ok: true }));
    app.get("/api/test-error", () => {
      throw new HoistedClawPilotError("test error message", "TEST_ERROR");
    });
    app.get("/api/test-crash", () => {
      throw new Error("unexpected boom");
    });
  }),
}));
vi.mock("../routes/blueprints.js", () => ({ registerBlueprintRoutes: vi.fn() }));
vi.mock("../routes/teams.js", () => ({ registerTeamRoutes: vi.fn() }));
vi.mock("../routes/system.js", () => ({ registerSystemRoutes: vi.fn() }));
vi.mock("../routes/auth.js", () => ({ registerAuthRoutes: vi.fn() }));
vi.mock("../routes/agent-blueprints.js", () => ({ registerAgentBlueprintRoutes: vi.fn() }));
vi.mock("../routes/profile.js", () => ({ registerProfileRoutes: vi.fn() }));
vi.mock("../routes/named-keys.js", () => ({ registerNamedKeyRoutes: vi.fn() }));
vi.mock("../routes/notifications.js", () => ({ registerNotificationRoutes: vi.fn() }));
vi.mock("../../core/repositories/notification-repository.js", () => ({
  pruneNotifications: vi.fn(() => 0),
}));

import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { MockConnection } from "../../core/__tests__/mock-connection.js";
import { SessionStore } from "../session-store.js";
import { buildDashboardApp } from "../server.js";
import type { DashboardOptions } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-server-token-64chars-hex-0123456789abcdef0123456789abcdef01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function json(res: Response): Promise<Json> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let db: ReturnType<typeof initDatabase>;
let tmpDir: string;
let options: DashboardOptions;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-server-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const conn = new MockConnection();
  const sessionStore = new SessionStore(db);

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

describe("buildDashboardApp", () => {
  it("returns app, deps, monitor, cleanup", async () => {
    const result = await buildDashboardApp(options);
    expect(result).toHaveProperty("app");
    expect(result).toHaveProperty("deps");
    expect(result).toHaveProperty("monitor");
    expect(result).toHaveProperty("cleanup");
    expect(typeof result.cleanup).toBe("function");
    result.cleanup();
  });
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("includes version and uptime", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/health");
      const body = await json(res);
      expect(body).toHaveProperty("service", "claw-pilot");
      expect(body).toHaveProperty("version");
      expect(typeof body.uptime).toBe("number");
    } finally {
      cleanup();
    }
  });
});

describe("auth middleware", () => {
  it("valid Bearer token allows access", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/api/test-auth", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("invalid Bearer token returns 401", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/api/test-auth", {
        headers: { Authorization: "Bearer wrong-token-that-has-different-length-000000000000" },
      });
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.code).toBe("UNAUTHORIZED");
    } finally {
      cleanup();
    }
  });

  it("missing auth returns 401", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/api/test-auth");
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.code).toBe("UNAUTHORIZED");
    } finally {
      cleanup();
    }
  });
});

describe("security headers", () => {
  it("includes security headers", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      // Use an API route (goes through the use("*") middleware chain)
      const res = await app.request("/api/test-auth", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toContain("default-src");
    } finally {
      cleanup();
    }
  });
});

describe("global error handler", () => {
  it("ClawPilotError returns structured error", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/api/test-error", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.code).toBe("TEST_ERROR");
      expect(body.error).toBe("test error message");
    } finally {
      cleanup();
    }
  });

  it("unknown error returns 500", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/api/test-crash", {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.code).toBe("INTERNAL_ERROR");
    } finally {
      cleanup();
    }
  });
});

describe("SPA fallback", () => {
  it("non-API, non-asset GET returns HTML", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/some/random/path");
      // Either serves index.html (200) or redirects to / on error (302)
      expect([200, 302]).toContain(res.status);
      const ct = res.headers.get("content-type") ?? "";
      if (res.status === 200) {
        expect(ct).toContain("text/html");
      }
    } finally {
      cleanup();
    }
  });
});

describe("cleanup", () => {
  it("cleanup function stops monitor and model discovery", async () => {
    const { cleanup } = await buildDashboardApp(options);
    cleanup();
    expect(mockMonitorStop).toHaveBeenCalled();
    expect(mockModelDiscoveryStop).toHaveBeenCalled();
  });
});

describe("server extensions", () => {
  it("invokes registered extensions during boot, after Community routes are mounted", async () => {
    const { clearServerExtensions, registerServerExtension } =
      await import("../server-extensions.js");
    clearServerExtensions();

    const observed: { hasDb: boolean; hasApp: boolean; hasTriggerScheduler: boolean }[] = [];
    registerServerExtension((deps, app) => {
      observed.push({
        hasDb: deps.db !== undefined,
        hasApp: typeof app.request === "function",
        hasTriggerScheduler: deps.triggerScheduler !== undefined,
      });
    });

    const { cleanup } = await buildDashboardApp(options);
    try {
      expect(observed).toHaveLength(1);
      expect(observed[0]).toEqual({ hasDb: true, hasApp: true, hasTriggerScheduler: true });
    } finally {
      cleanup();
      clearServerExtensions();
    }
  });

  it("propagates errors raised by an extension (boot fails fast)", async () => {
    const { clearServerExtensions, registerServerExtension } =
      await import("../server-extensions.js");
    clearServerExtensions();

    registerServerExtension(() => {
      throw new Error("scripted extension failure");
    });

    await expect(buildDashboardApp(options)).rejects.toThrow(/scripted extension failure/);
    clearServerExtensions();
  });

  it("invokes extensions sequentially in registration order", async () => {
    const { clearServerExtensions, registerServerExtension } =
      await import("../server-extensions.js");
    clearServerExtensions();

    const order: string[] = [];
    registerServerExtension(async () => {
      await Promise.resolve();
      order.push("a");
    });
    registerServerExtension(() => {
      order.push("b");
    });
    registerServerExtension(async () => {
      await Promise.resolve();
      order.push("c");
    });

    const { cleanup } = await buildDashboardApp(options);
    try {
      expect(order).toEqual(["a", "b", "c"]);
    } finally {
      cleanup();
      clearServerExtensions();
    }
  });
});

describe("static assets", () => {
  it("path traversal blocked", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      // Construct a raw Request to avoid URL normalization stripping "../"
      // The server's path.join + startsWith check should block traversal.
      const req = new Request("http://localhost/assets/../../../etc/passwd");
      const res = await app.request(req);
      // URL normalization by the browser/runtime resolves ".." before the server sees it,
      // so it becomes /etc/passwd which does not match /assets/* — falls through to SPA.
      // The key protection: path.join result must startWith(UI_DIST).
      // In any case, the response must NOT contain actual file content.
      expect(res.status).not.toBe(200);
    } finally {
      cleanup();
    }
  });

  it("valid asset returns 404 when file does not exist", async () => {
    const { app, cleanup } = await buildDashboardApp(options);
    try {
      const res = await app.request("/assets/nonexistent.js");
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});
