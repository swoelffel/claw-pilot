// src/core/__tests__/port-allocator.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { PortAllocator } from "../port-allocator.js";
import { MockConnection } from "./mock-connection.js";

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;
let allocator: PortAllocator;
let serverId: number;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-port-test-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  allocator = new PortAllocator(registry, conn);
  const server = registry.upsertLocalServer("testhost", "/opt/openclaw");
  serverId = server.id;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: make MockConnection report a port as occupied
function occupyPort(port: number): void {
  conn.mockExec(`:${port}`, { stdout: `LISTEN 0 128 0.0.0.0:${port}`, stderr: "", exitCode: 0 });
}

describe("PortAllocator — OpenClaw 2026.3.x sidecar ports", () => {
  it("allocates first port at range start when all ports are free", async () => {
    const port = await allocator.findFreePort(serverId);
    expect(port).toBe(18789);
  });

  it("allocates ports with step of 5 (not 1)", async () => {
    // Allocate first port
    const port1 = await allocator.findFreePort(serverId);
    expect(port1).toBe(18789);

    // Register it in DB (simulating what provisioner does)
    registry.allocatePort(serverId, port1, "inst1");
    allocator.reserveSidecarPorts(serverId, port1, "inst1");

    // Second allocation must skip to 18794 (18789 + 5), not 18790
    const port2 = await allocator.findFreePort(serverId);
    expect(port2).toBe(18794);
  });

  it("skips a block if P+2 is occupied on the system", async () => {
    // Occupy port 18791 (P+2 of 18789) on the system
    occupyPort(18791);

    // 18789 block is not free (P+2 occupied) — should skip to 18794
    const port = await allocator.findFreePort(serverId);
    expect(port).toBe(18794);
  });

  it("skips a block if P+4 is occupied on the system", async () => {
    // Occupy port 18793 (P+4 of 18789) on the system
    occupyPort(18793);

    // 18789 block is not free (P+4 occupied) — should skip to 18794
    const port = await allocator.findFreePort(serverId);
    expect(port).toBe(18794);
  });

  it("reserveSidecarPorts registers P+1, P+2, P+4 in DB", () => {
    registry.allocatePort(serverId, 18789, "inst1");
    allocator.reserveSidecarPorts(serverId, 18789, "inst1");

    const used = registry.getUsedPorts(serverId);
    expect(used).toContain(18789); // gateway
    expect(used).toContain(18790); // P+1 bridge
    expect(used).toContain(18791); // P+2 browser control
    expect(used).toContain(18793); // P+4 canvas host
    expect(used).not.toContain(18792); // P+3 intentionally not reserved
  });

  it("releaseSidecarPorts removes P+1, P+2, P+4 from DB", () => {
    registry.allocatePort(serverId, 18789, "inst1");
    allocator.reserveSidecarPorts(serverId, 18789, "inst1");

    // Verify they are registered
    expect(registry.getUsedPorts(serverId)).toContain(18791);

    // Release sidecars
    allocator.releaseSidecarPorts(serverId, 18789);

    const used = registry.getUsedPorts(serverId);
    expect(used).toContain(18789); // gateway still registered (released separately)
    expect(used).not.toContain(18790);
    expect(used).not.toContain(18791);
    expect(used).not.toContain(18793);
  });

  it("verifyPort returns false if P+2 is occupied on the system", async () => {
    occupyPort(18791); // P+2 of 18789
    const ok = await allocator.verifyPort(serverId, 18789);
    expect(ok).toBe(false);
  });

  it("verifyPort returns false if port is already in DB registry", async () => {
    registry.allocatePort(serverId, 18789, "existing");
    const ok = await allocator.verifyPort(serverId, 18789);
    expect(ok).toBe(false);
  });

  it("verifyPort returns true when port and all sidecars are free", async () => {
    const ok = await allocator.verifyPort(serverId, 18789);
    expect(ok).toBe(true);
  });

  it("throws PortConflictError when no free block exists in range", async () => {
    // Fill the entire range with DB entries (step 5 = 10 blocks in 18789-18838)
    for (let p = 18789; p <= 18838; p += 5) {
      registry.allocatePort(serverId, p, `inst-${p}`);
    }
    await expect(allocator.findFreePort(serverId)).rejects.toThrow();
  });
});

describe("PortAllocator — arePortsFree", () => {
  it("returns true when all ports in block are free", async () => {
    const free = await allocator.arePortsFree(18789);
    expect(free).toBe(true);
  });

  it("returns false when P+1 is occupied", async () => {
    occupyPort(18790);
    const free = await allocator.arePortsFree(18789);
    expect(free).toBe(false);
  });

  it("returns false when P+2 is occupied", async () => {
    occupyPort(18791);
    const free = await allocator.arePortsFree(18789);
    expect(free).toBe(false);
  });

  it("returns false when P+4 is occupied", async () => {
    occupyPort(18793);
    const free = await allocator.arePortsFree(18789);
    expect(free).toBe(false);
  });

  it("does NOT check P+3 (intentionally not reserved by OpenClaw)", async () => {
    occupyPort(18792); // P+3 — should not block allocation
    const free = await allocator.arePortsFree(18789);
    expect(free).toBe(true);
  });
});
