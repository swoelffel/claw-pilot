// src/dashboard/__tests__/profile-routes.test.ts
//
// Integration tests for the profile API routes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { SessionStore } from "../session-store.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { registerProfileRoutes } from "../routes/profile.js";

// ---------------------------------------------------------------------------
// Mock markAllDirty
// ---------------------------------------------------------------------------

vi.mock("../../runtime/session/system-prompt-dirty.js", () => ({
  markAllDirty: vi.fn(),
}));

import { markAllDirty } from "../../runtime/session/system-prompt-dirty.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-dashboard-token-64chars-hex-0123456789abcdef0123456789abcdef";

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
let registry: Registry;
let sessionStore: SessionStore;
let tmpDir: string;

/**
 * Insert a user directly into the users table and return its id.
 */
function seedUser(username = "admin", role = "admin", passwordHash = "hashed"): number {
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, passwordHash, role);
  return Number(info.lastInsertRowid);
}

/**
 * Create a session for a user and return the session id (cookie value).
 */
function seedSession(userId: number): string {
  return sessionStore.create(userId);
}

beforeEach(() => {
  vi.clearAllMocks();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-profile-routes-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  sessionStore = new SessionStore(db);

  app = new Hono();

  const expectedBearer = `Bearer ${TEST_TOKEN}`;
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expectedBearer) {
      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    }
    await next();
  });

  const deps: RouteDeps = {
    registry,
    db,
    startedAt: Date.now(),
    conn: {} as unknown as RouteDeps["conn"],
    health: {} as unknown as RouteDeps["health"],
    lifecycle: {} as unknown as RouteDeps["lifecycle"],
    monitor: {
      setTransitioning: () => {},
      clearTransitioning: () => {},
    } as unknown as RouteDeps["monitor"],
    selfUpdateChecker: {} as unknown as RouteDeps["selfUpdateChecker"],
    selfUpdater: {} as unknown as RouteDeps["selfUpdater"],
    tokenCache: {} as unknown as RouteDeps["tokenCache"],
    xdgRuntimeDir: "/run/user/1000",
    sessionStore,
  };

  registerProfileRoutes(app, deps);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests — GET /api/profile
// ---------------------------------------------------------------------------

describe("GET /api/profile", () => {
  it("returns null when no profile exists", async () => {
    const res = await app.request(
      new Request("http://localhost/api/profile", { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.profile).toBeNull();
    expect(data.message).toBe("No profile configured yet");
  });

  it("returns profile data when admin profile exists (no session cookie)", async () => {
    const userId = seedUser("admin", "admin");
    registry.upsertUserProfile(userId, { display_name: "Alice", language: "en" });

    const res = await app.request(
      new Request("http://localhost/api/profile", { headers: authHeaders() }),
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.profile).not.toBeNull();
    expect(data.profile.displayName).toBe("Alice");
    expect(data.profile.language).toBe("en");
    expect(data.profile.userId).toBe(userId);
  });

  it("returns profile for the session user when cookie is present", async () => {
    const userId = seedUser("operator1", "operator");
    registry.upsertUserProfile(userId, { display_name: "Bob" });
    const sid = seedSession(userId);

    const res = await app.request(
      new Request("http://localhost/api/profile", {
        headers: {
          ...authHeaders(),
          Cookie: `__cp_sid=${sid}`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.profile.displayName).toBe("Bob");
    expect(data.profile.userId).toBe(userId);
  });

  it("parses ui_preferences JSON blob", async () => {
    const userId = seedUser();
    const prefs = { theme: "dark", sidebarOpen: true };
    registry.upsertUserProfile(userId, { ui_preferences: JSON.stringify(prefs) });

    const res = await app.request(
      new Request("http://localhost/api/profile", { headers: authHeaders() }),
    );
    const data = await json(res);
    expect(data.profile.uiPreferences).toEqual(prefs);
  });

  it("handles malformed ui_preferences gracefully", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, { ui_preferences: "{bad-json" });

    const res = await app.request(
      new Request("http://localhost/api/profile", { headers: authHeaders() }),
    );
    const data = await json(res);
    expect(data.profile.uiPreferences).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — PATCH /api/profile
// ---------------------------------------------------------------------------

describe("PATCH /api/profile", () => {
  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: "not-json{{{",
      }),
    );
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("INVALID_BODY");
  });

  it("returns 400 when schema validation fails (invalid enum value)", async () => {
    seedUser();
    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ communicationStyle: "invalid-style" }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("updates displayName successfully", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {});

    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Charlie" }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    expect(data.profile.userId).toBe(userId);

    // Verify persisted
    const profile = registry.getUserProfile(userId);
    expect(profile?.display_name).toBe("Charlie");
  });

  it("updates language", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {});

    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ language: "de" }),
      }),
    );
    expect(res.status).toBe(200);

    const profile = registry.getUserProfile(userId);
    expect(profile?.language).toBe("de");
  });

  it("updates multiple fields at once", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {});

    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "Dana",
          language: "es",
          timezone: "Europe/Madrid",
          communicationStyle: "detailed",
        }),
      }),
    );
    expect(res.status).toBe(200);

    const profile = registry.getUserProfile(userId);
    expect(profile?.display_name).toBe("Dana");
    expect(profile?.language).toBe("es");
    expect(profile?.timezone).toBe("Europe/Madrid");
    expect(profile?.communication_style).toBe("detailed");
  });

  it("returns 404 when no user exists to update", async () => {
    // No users seeded, no session cookie → no targetUserId
    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Ghost" }),
      }),
    );
    expect(res.status).toBe(404);
    const data = await json(res);
    expect(data.code).toBe("NO_USER");
  });

  it("calls markAllDirty after successful update", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {});

    await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Trigger" }),
      }),
    );

    expect(markAllDirty).toHaveBeenCalledWith("profile");
    expect(markAllDirty).toHaveBeenCalledTimes(1);
  });

  it("handles uiPreferences as JSON object", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {});

    const prefs = { theme: "light", fontSize: 14 };
    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ uiPreferences: prefs }),
      }),
    );
    expect(res.status).toBe(200);

    const profile = registry.getUserProfile(userId);
    expect(JSON.parse(profile!.ui_preferences!)).toEqual(prefs);
  });

  it("sets uiPreferences to null when value is null", async () => {
    const userId = seedUser();
    registry.upsertUserProfile(userId, {
      ui_preferences: JSON.stringify({ theme: "dark" }),
    });

    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ uiPreferences: null }),
      }),
    );
    expect(res.status).toBe(200);

    const profile = registry.getUserProfile(userId);
    expect(profile!.ui_preferences).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — Auth
// ---------------------------------------------------------------------------

describe("Auth", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.request(new Request("http://localhost/api/profile"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token on PATCH", async () => {
    const res = await app.request(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer wrong-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName: "Hacker" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
