// src/core/__tests__/provisioner.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { Provisioner } from "../provisioner.js";
import { MockConnection } from "./mock-connection.js";
import { InstanceAlreadyExistsError } from "../../lib/errors.js";
import type { WizardAnswers } from "../config-generator.js";
import type { PortAllocator } from "../port-allocator.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Allow tests to control the service manager
let _mockServiceManager: "systemd" | "launchd" | null = null;

vi.mock("../../lib/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platform.js")>();
  return {
    ...actual,
    getServiceManager: () => _mockServiceManager ?? actual.getServiceManager(),
    SERVICE_MANAGER: "systemd" as const,
    getHomeDir: () => "/tmp/openclaw-test-home",
    getRuntimeStateDir: (slug: string) => `/tmp/openclaw-test-home/.runtime-${slug}`,
    getSystemdDir: () => "/tmp/systemd-test",
  };
});

vi.mock("../../lib/xdg.js", () => ({
  resolveXdgRuntimeDir: async () => "/run/user/1000",
}));

vi.mock("../secrets.js", () => ({
  generateGatewayToken: () => "aabbccdd".repeat(6),
}));

// Mock ensureRuntimeConfig to avoid real filesystem operations
vi.mock("../../runtime/engine/config-loader.js", () => ({
  ensureRuntimeConfig: () => {},
}));

// Mock Lifecycle to avoid real daemon spawn
vi.mock("../lifecycle.js", () => ({
  Lifecycle: class {
    async daemonReload() {}
    async enable(_slug: string) {}
    async start(_slug: string) {}
    async stop(_slug: string) {}
    async restart(_slug: string) {}
  },
}));

// ---------------------------------------------------------------------------
// Minimal WizardAnswers for happy path
// ---------------------------------------------------------------------------

const BASE_ANSWERS: WizardAnswers = {
  slug: "test-inst",
  displayName: "Test Instance",
  port: 18790,
  agents: [{ id: "main", name: "Main", isDefault: true }],
  defaultModel: "claude-3-5-sonnet-20241022",
  provider: "anthropic",
  apiKey: "sk-test-key",
  telegram: { enabled: false },
  mem0: { enabled: false },
};

// ---------------------------------------------------------------------------
// Mock PortAllocator
// ---------------------------------------------------------------------------

let _mockVerifyPort = true;

class MockPortAllocator {
  async verifyPort(_serverId: number, _port: number): Promise<boolean> {
    return _mockVerifyPort;
  }
  reserveSidecarPorts(_serverId: number, _port: number, _slug: string): void {
    // no-op
  }
  releaseSidecarPorts(_serverId: number, _port: number): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let registry: Registry;
let db: ReturnType<typeof initDatabase>;
let conn: MockConnection;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-prov-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  registry = new Registry(db);
  conn = new MockConnection();
  _mockServiceManager = "systemd";
  _mockVerifyPort = true;
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  _mockServiceManager = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvisioner() {
  const server = registry.upsertLocalServer("test-host", "/tmp/openclaw-test-home");
  const portAllocator = new MockPortAllocator() as unknown as PortAllocator;
  return { provisioner: new Provisioner(conn, registry, portAllocator), serverId: server.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Provisioner.provision()", () => {
  it("happy path — returns correct ProvisionResult", async () => {
    const { provisioner, serverId } = makeProvisioner();

    const result = await provisioner.provision(BASE_ANSWERS, serverId);

    expect(result.slug).toBe("test-inst");
    expect(result.port).toBe(18790);
    expect(result.gatewayToken).toBe("aabbccdd".repeat(6));
    expect(result.agentCount).toBe(1);
    expect(result.stateDir).toContain("test-inst");
  });

  it("happy path — state dir is created in MockConnection", async () => {
    const { provisioner, serverId } = makeProvisioner();

    const result = await provisioner.provision(BASE_ANSWERS, serverId);

    // The state dir should have been mkdir'd
    expect(conn.dirs.has(result.stateDir)).toBe(true);
  });

  it("happy path — .env is written with gateway token and API key", async () => {
    const { provisioner, serverId } = makeProvisioner();

    const result = await provisioner.provision(BASE_ANSWERS, serverId);

    const envPath = path.join(result.stateDir, ".env");

    expect(conn.files.has(envPath)).toBe(true);

    // Verify .env contains the gateway token
    const envContent = conn.files.get(envPath)!;
    expect(envContent).toContain(`OPENCLAW_GW_AUTH_TOKEN=${"aabbccdd".repeat(6)}`);
    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-test-key");
  });

  it("happy path — instance is registered in registry", async () => {
    const { provisioner, serverId } = makeProvisioner();

    await provisioner.provision(BASE_ANSWERS, serverId);

    const instance = registry.getInstance("test-inst");
    expect(instance).toBeDefined();
    expect(instance!.port).toBe(18790);
    expect(instance!.slug).toBe("test-inst");
  });

  it("happy path — agent is registered in registry", async () => {
    const { provisioner, serverId } = makeProvisioner();

    await provisioner.provision(BASE_ANSWERS, serverId);

    const agents = registry.listAgents("test-inst");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.agent_id).toBe("main");
  });

  it("duplicate slug — throws InstanceAlreadyExistsError", async () => {
    const { provisioner, serverId } = makeProvisioner();

    // First provision succeeds
    await provisioner.provision(BASE_ANSWERS, serverId);

    // Second provision with same slug should fail
    await expect(provisioner.provision(BASE_ANSWERS, serverId)).rejects.toThrow(
      InstanceAlreadyExistsError,
    );
  });

  it("port conflict — throws ClawPilotError with code PORT_CONFLICT", async () => {
    _mockVerifyPort = false;
    const { provisioner, serverId } = makeProvisioner();

    await expect(provisioner.provision(BASE_ANSWERS, serverId)).rejects.toThrow(
      expect.objectContaining({ code: "PORT_CONFLICT" }),
    );
  });

  it("rollback on failure — state dir is removed when writeFile throws after mkdir", async () => {
    const { provisioner, serverId } = makeProvisioner();

    // The state dir that will be created
    const stateDir = path.join("/tmp/openclaw-test-home", ".runtime-test-inst");

    // Make writeFile throw on the first call (writing .env)
    let writeCount = 0;
    const spy = vi.spyOn(conn, "writeFile").mockImplementation(async (filePath, content, _mode) => {
      writeCount++;
      if (writeCount === 1) {
        throw new Error("Simulated write failure");
      }
      // Simulate the original implementation for subsequent calls
      conn.files.set(filePath, content);
    });

    await expect(provisioner.provision(BASE_ANSWERS, serverId)).rejects.toThrow(
      "Simulated write failure",
    );

    spy.mockRestore();

    // After rollback, the state dir should not be in dirs (it was removed)
    // Note: MockConnection.remove() deletes from dirs
    expect(conn.dirs.has(stateDir)).toBe(false);
  });

  it("rollback on failure — instance is NOT in registry after failed provision", async () => {
    const { provisioner, serverId } = makeProvisioner();

    // Make writeFile always throw
    vi.spyOn(conn, "writeFile").mockRejectedValue(new Error("Simulated write failure"));

    await expect(provisioner.provision(BASE_ANSWERS, serverId)).rejects.toThrow();

    // Instance should not be in registry
    expect(registry.getInstance("test-inst")).toBeUndefined();
  });
});
