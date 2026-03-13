// src/core/__tests__/device-manager.test.ts
//
// Tests for DeviceManager which manages device pairing codes via the
// rt_pairing_codes DB table. Uses an in-memory SQLite database.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DeviceManager } from "../device-manager.js";
import { Registry } from "../registry.js";
import { initDatabase } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: ReturnType<typeof initDatabase>;
let dm: DeviceManager;

let _nextPort = 18790;
/** Seed a server + instance so FK constraints on rt_pairing_codes are satisfied. */
function seedInstance(slug: string): void {
  const registry = new Registry(db);
  const server =
    registry.getLocalServer() ?? registry.upsertLocalServer("testhost", "/opt/claw-pilot");
  registry.createInstance({
    serverId: server.id,
    slug,
    port: _nextPort++,
    configPath: `/opt/claw-pilot/.${slug}/runtime.json`,
    stateDir: `/opt/claw-pilot/.${slug}`,
    systemdUnit: `claw-runtime-${slug}`,
  });
}

beforeEach(() => {
  _nextPort = 18790;
  db = initDatabase(":memory:");
  dm = new DeviceManager(db);
  // Seed instances used by tests
  seedInstance("test-instance");
  seedInstance("instance-a");
  seedInstance("instance-b");
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// DeviceManager.list()
// ---------------------------------------------------------------------------

describe("DeviceManager.list()", () => {
  it("returns empty array when no codes exist", () => {
    const result = dm.list("test-instance");
    expect(result).toEqual([]);
  });

  it("returns created codes", () => {
    dm.create("test-instance", { channel: "web" });
    dm.create("test-instance", { channel: "web" });

    const result = dm.list("test-instance");
    expect(result).toHaveLength(2);
    expect(result[0]!.channel).toBe("web");
    expect(result[0]!.used).toBe(false);
  });

  it("does not return codes for other instances", () => {
    dm.create("instance-a");
    dm.create("instance-b");

    const result = dm.list("instance-a");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DeviceManager.create()
// ---------------------------------------------------------------------------

describe("DeviceManager.create()", () => {
  it("creates a pairing code with default channel", () => {
    const code = dm.create("test-instance");
    expect(code.code).toBeTruthy();
    expect(code.code.length).toBe(8);
    expect(code.channel).toBe("web");
    expect(code.used).toBe(false);
    expect(code.expires_at).toBeTruthy();
    expect(code.created_at).toBeTruthy();
  });

  it("creates a pairing code with custom channel", () => {
    const code = dm.create("test-instance", { channel: "telegram" });
    expect(code.channel).toBe("telegram");
  });

  it("creates a pairing code with custom TTL", () => {
    const code = dm.create("test-instance", { ttlMinutes: 60 });
    const expiresAt = new Date(code.expires_at).getTime();
    const now = Date.now();
    // Should expire roughly 60 minutes from now (allow 5s tolerance)
    expect(expiresAt - now).toBeGreaterThan(59 * 60 * 1000 - 5000);
    expect(expiresAt - now).toBeLessThan(61 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// DeviceManager.revoke()
// ---------------------------------------------------------------------------

describe("DeviceManager.revoke()", () => {
  it("revokes an existing code and returns true", () => {
    const created = dm.create("test-instance");
    const result = dm.revoke("test-instance", created.code);
    expect(result).toBe(true);

    // Code should no longer appear in list
    const list = dm.list("test-instance");
    expect(list).toHaveLength(0);
  });

  it("returns false for non-existent code", () => {
    const result = dm.revoke("test-instance", "NONEXIST");
    expect(result).toBe(false);
  });
});
