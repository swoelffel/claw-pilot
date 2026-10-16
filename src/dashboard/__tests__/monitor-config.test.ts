import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { WebSocket } from "ws";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import type { HealthChecker } from "../../core/health.js";
import { createDefaultRuntimeConfig } from "../../runtime/config/index.js";
import { Monitor } from "../monitor.js";

let stateDir: string;
vi.mock("../../lib/platform.js", async (original) => ({
  ...(await original<typeof import("../../lib/platform.js")>()),
  getRuntimeStateDir: () => stateDir,
}));

describe("monitor database configuration", () => {
  let db: ReturnType<typeof initDatabase>;
  let registry: Registry;
  let monitor: Monitor;
  let broadcasts: Array<{ payload: { instances: Array<{ heartbeatAgents: number }> } }>;

  beforeEach(() => {
    vi.useFakeTimers();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-config-"));
    db = initDatabase(":memory:");
    registry = new Registry(db);
    const server = registry.upsertLocalServer("test", stateDir);
    const instance = registry.createInstance({
      serverId: server.id,
      slug: "monitor-test",
      port: 18790,
      stateDir,
      configPath: path.join(stateDir, "runtime.json"),
      systemdUnit: "test",
    });
    registry.upsertAgent(instance.id, {
      agentId: "pilot",
      name: "Pilot",
      model: "anthropic/test",
      isDefault: true,
      workspacePath: stateDir,
    });
    const config = createDefaultRuntimeConfig({});
    config.agents[0]!.heartbeat = { every: "30m" };
    registry.saveRuntimeConfig("monitor-test", config);
    broadcasts = [];
    const health = {
      checkAll: async () => [{ slug: "monitor-test", port: 18790, state: "running" }],
    } as unknown as HealthChecker;
    monitor = new Monitor(health, 100, db);
    monitor.addClient({
      readyState: 1,
      on: () => {},
      send: (data: string) => broadcasts.push(JSON.parse(data)),
    } as unknown as WebSocket);
    monitor.start();
  });

  afterEach(() => {
    monitor.stop();
    db.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("reports heartbeat agents with no runtime.json snapshot", async () => {
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcasts.at(-1)?.payload.instances[0]?.heartbeatAgents).toBe(1);
    expect(fs.existsSync(path.join(stateDir, "runtime.json"))).toBe(false);
  });

  it("uses current agent configuration instead of a stale snapshot or global blob", async () => {
    fs.writeFileSync(
      path.join(stateDir, "runtime.json"),
      JSON.stringify(createDefaultRuntimeConfig({})),
    );
    // Agent rows, rather than the legacy agents[] in the global blob, own heartbeat settings.
    db.prepare(
      "UPDATE agents SET config_json = json_set(config_json, '$.heartbeat.every', '5m')",
    ).run();
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcasts.at(-1)?.payload.instances[0]?.heartbeatAgents).toBe(1);
    db.prepare("UPDATE agents SET config_json = json_remove(config_json, '$.heartbeat')").run();
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcasts.at(-1)?.payload.instances[0]?.heartbeatAgents).toBe(0);
  });

  it("returns zero when no database configuration is available", async () => {
    db.prepare("UPDATE instances SET runtime_config_json = NULL").run();
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcasts.at(-1)?.payload.instances[0]?.heartbeatAgents).toBe(0);
  });
});
