// src/core/__tests__/device-manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { DeviceManager } from "../device-manager.js";
import { MockConnection } from "./mock-connection.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATE_DIR = "/home/openclaw/.openclaw-test";
const PENDING_PATH = `${STATE_DIR}/devices/pending.json`;
const PAIRED_PATH = `${STATE_DIR}/devices/paired.json`;

const PENDING_FIXTURE = JSON.stringify([
  {
    requestId: "869d51b4-5bed-4481-b7aa-6911ea59a58e",
    deviceId: "abc123",
    publicKey: "pk1",
    platform: "MacIntel",
    clientId: "openclaw-control-ui",
    clientMode: "browser",
    role: "operator",
    ts: 1700000000000,
  },
]);

const PAIRED_FIXTURE = JSON.stringify([
  {
    deviceId: "46858a15",
    publicKey: "pk2",
    platform: "MacIntel",
    clientId: "openclaw-control-ui",
    clientMode: "browser",
    role: "operator",
    scopes: ["*"],
    tokens: {
      t1: { token: "tok", createdAtMs: 1700000000000, lastUsedAtMs: 1700003600000 },
    },
    createdAtMs: 1700000000000,
    approvedAtMs: 1700000100000,
  },
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let conn: MockConnection;
let dm: DeviceManager;

beforeEach(() => {
  conn = new MockConnection();
  dm = new DeviceManager(conn);
});

// ---------------------------------------------------------------------------
// DeviceManager.list()
// ---------------------------------------------------------------------------

describe("DeviceManager.list()", () => {
  it("returns empty lists when files don't exist", async () => {
    // No files seeded in conn — both reads will throw
    const result = await dm.list(STATE_DIR);
    expect(result.pending).toEqual([]);
    expect(result.paired).toEqual([]);
  });

  it("returns parsed pending devices", async () => {
    conn.files.set(PENDING_PATH, PENDING_FIXTURE);

    const result = await dm.list(STATE_DIR);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]?.requestId).toBe("869d51b4-5bed-4481-b7aa-6911ea59a58e");
    expect(result.pending[0]?.platform).toBe("MacIntel");
    expect(result.paired).toEqual([]);
  });

  it("returns parsed paired devices", async () => {
    conn.files.set(PAIRED_PATH, PAIRED_FIXTURE);

    const result = await dm.list(STATE_DIR);
    expect(result.pending).toEqual([]);
    expect(result.paired).toHaveLength(1);
    expect(result.paired[0]?.deviceId).toBe("46858a15");
    expect(result.paired[0]?.role).toBe("operator");
  });

  it("returns both pending and paired", async () => {
    conn.files.set(PENDING_PATH, PENDING_FIXTURE);
    conn.files.set(PAIRED_PATH, PAIRED_FIXTURE);

    const result = await dm.list(STATE_DIR);
    expect(result.pending).toHaveLength(1);
    expect(result.paired).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DeviceManager.approve()
// ---------------------------------------------------------------------------

describe("DeviceManager.approve()", () => {
  it("calls openclaw devices approve with correct stateDir and requestId", async () => {
    const requestId = "869d51b4-5bed-4481-b7aa-6911ea59a58e";
    await dm.approve(STATE_DIR, requestId);

    expect(conn.commands).toHaveLength(1);
    expect(conn.commands[0]).toContain(`OPENCLAW_STATE_DIR=${STATE_DIR}`);
    expect(conn.commands[0]).toContain("openclaw devices approve");
    expect(conn.commands[0]).toContain(requestId);
  });

  it("throws on non-zero exit code", async () => {
    const requestId = "bad-request-id";
    conn.mockExec("openclaw devices approve", {
      stdout: "",
      stderr: "device not found",
      exitCode: 1,
    });

    await expect(dm.approve(STATE_DIR, requestId)).rejects.toThrow("device not found");
  });
});

// ---------------------------------------------------------------------------
// DeviceManager.revoke()
// ---------------------------------------------------------------------------

describe("DeviceManager.revoke()", () => {
  it("calls openclaw devices revoke with correct stateDir and deviceId", async () => {
    const deviceId = "46858a15";
    await dm.revoke(STATE_DIR, deviceId);

    expect(conn.commands).toHaveLength(1);
    expect(conn.commands[0]).toContain(`OPENCLAW_STATE_DIR=${STATE_DIR}`);
    expect(conn.commands[0]).toContain("openclaw devices revoke");
    expect(conn.commands[0]).toContain(deviceId);
  });

  it("throws on non-zero exit code", async () => {
    const deviceId = "bad-device-id";
    conn.mockExec("openclaw devices revoke", {
      stdout: "",
      stderr: "device not found",
      exitCode: 1,
    });

    await expect(dm.revoke(STATE_DIR, deviceId)).rejects.toThrow("device not found");
  });
});
