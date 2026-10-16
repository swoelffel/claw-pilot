import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../../db/schema.js";
import { createDefaultRuntimeConfig } from "../../runtime/config/index.js";
import { Registry } from "../registry.js";
import { Lifecycle } from "../lifecycle.js";
import { MockConnection } from "./mock-connection.js";

const daemon = vi.hoisted(() => ({ stateDir: "", running: false }));
vi.mock("../../lib/platform.js", async (original) => ({
  ...(await original<typeof import("../../lib/platform.js")>()),
  getRuntimeStateDir: () => daemon.stateDir,
  getRuntimePid: () => (daemon.running ? 12345 : null),
  isRuntimeRunning: () => daemon.running,
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: () => {
    daemon.running = true;
    return { unref: () => {}, once: () => {} };
  },
}));

describe("lifecycle database configuration", () => {
  let db: ReturnType<typeof initDatabase>;
  let registry: Registry;
  let lifecycle: Lifecycle;

  beforeEach(() => {
    daemon.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-config-"));
    daemon.running = false;
    db = initDatabase(":memory:");
    registry = new Registry(db);
    const server = registry.upsertLocalServer("test", daemon.stateDir);
    registry.createInstance({
      serverId: server.id,
      slug: "startup-test",
      port: 18790,
      stateDir: daemon.stateDir,
      configPath: path.join(daemon.stateDir, "runtime.json"),
      systemdUnit: "test",
    });
    lifecycle = new Lifecycle(new MockConnection(), registry, "/run/user/1000");
  });

  afterEach(() => {
    db.close();
    fs.rmSync(daemon.stateDir, { recursive: true, force: true });
  });

  it.each(["missing", "invalid"])(
    "starts with DB configuration and a %s snapshot",
    async (snapshot) => {
      registry.saveRuntimeConfig("startup-test", createDefaultRuntimeConfig({}));
      const snapshotPath = path.join(daemon.stateDir, "runtime.json");
      if (snapshot === "invalid") fs.writeFileSync(snapshotPath, "invalid json");

      await lifecycle.start("startup-test");

      expect(registry.getInstance("startup-test")?.state).toBe("running");
      if (snapshot === "missing") expect(fs.existsSync(snapshotPath)).toBe(false);
      else expect(fs.readFileSync(snapshotPath, "utf8")).toBe("invalid json");
    },
  );

  it("preserves default snapshot bootstrap for an instance without DB configuration", async () => {
    await lifecycle.start("startup-test");
    expect(registry.getInstance("startup-test")?.state).toBe("running");
    expect(
      JSON.parse(fs.readFileSync(path.join(daemon.stateDir, "runtime.json"), "utf8")),
    ).toMatchObject({ version: 1 });
  });
});
