// src/core/__tests__/runtime-config-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../registry.js";
import { createDefaultRuntimeConfig } from "../../runtime/config/index.js";
import type { RuntimeConfig } from "../../runtime/config/index.js";

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
let registry: Registry;

/** Provision a minimal instance + server so we have a valid slug to work with */
function provisionInstance(slug: string): void {
  registry.upsertLocalServer("localhost", tmpDir);
  const server = registry.getLocalServer()!;
  registry.createInstance({
    serverId: server.id,
    slug,
    port: 18789,
    configPath: path.join(tmpDir, slug, "runtime.json"),
    stateDir: path.join(tmpDir, slug),
    systemdUnit: `claw-runtime@${slug}.service`,
  });
}

/** Provision an agent row for an instance */
function provisionAgent(slug: string, agentId: string, name: string): void {
  const inst = registry.getInstance(slug)!;
  registry.upsertAgent(inst.id, {
    agentId,
    name,
    model: "anthropic/claude-sonnet-4-5",
    workspacePath: path.join(tmpDir, slug, "agents", agentId),
    isDefault: false,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-rtconfig-test-"));
  db = initDatabase(path.join(tmpDir, "registry.db"));
  registry = new Registry(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("RuntimeConfigRepository", () => {
  const slug = "test-instance";

  describe("getRuntimeConfig", () => {
    it("returns null when no config is stored", () => {
      provisionInstance(slug);
      expect(registry.getRuntimeConfig(slug)).toBeNull();
    });

    it("returns null for non-existent slug", () => {
      expect(registry.getRuntimeConfig("ghost")).toBeNull();
    });

    it("returns parsed config after saveRuntimeConfig", () => {
      provisionInstance(slug);
      const config = createDefaultRuntimeConfig({});
      registry.saveRuntimeConfig(slug, config);

      const loaded = registry.getRuntimeConfig(slug);
      expect(loaded).not.toBeNull();
      expect(loaded!.defaultModel).toBe(config.defaultModel);
      expect(loaded!.agents).toHaveLength(config.agents.length);
      expect(loaded!.agents[0]!.id).toBe(config.agents[0]!.id);
    });
  });

  describe("saveRuntimeConfig", () => {
    it("stores config as JSON in the instances row", () => {
      provisionInstance(slug);
      const config = createDefaultRuntimeConfig({});
      registry.saveRuntimeConfig(slug, config);

      const row = db
        .prepare("SELECT runtime_config_json FROM instances WHERE slug = ?")
        .get(slug) as { runtime_config_json: string };
      expect(row.runtime_config_json).toBeTruthy();
      const parsed = JSON.parse(row.runtime_config_json) as RuntimeConfig;
      expect(parsed.defaultModel).toBe(config.defaultModel);
    });

    it("syncs agents.config_json for matching agents", () => {
      provisionInstance(slug);
      const config = createDefaultRuntimeConfig({});
      const firstAgent = config.agents[0]!;
      // Create the agent row first
      provisionAgent(slug, firstAgent.id, firstAgent.name);

      registry.saveRuntimeConfig(slug, config);

      const inst = registry.getInstance(slug)!;
      const agentRow = registry.getAgentByAgentId(inst.id, firstAgent.id);
      expect(agentRow).toBeTruthy();
      expect(agentRow!.config_json).toBeTruthy();
      const agentConfig = JSON.parse(agentRow!.config_json!) as Record<string, unknown>;
      expect(agentConfig.id).toBe(firstAgent.id);
      expect(agentConfig.name).toBe(firstAgent.name);
    });
  });

  describe("patchRuntimeConfig", () => {
    it("applies a transform atomically and returns the result", () => {
      provisionInstance(slug);
      const config = createDefaultRuntimeConfig({});
      registry.saveRuntimeConfig(slug, config);

      const patched = registry.patchRuntimeConfig(slug, (c) => ({
        ...c,
        defaultModel: "openai/gpt-4o",
      }));

      expect(patched.defaultModel).toBe("openai/gpt-4o");

      // Verify persisted
      const loaded = registry.getRuntimeConfig(slug);
      expect(loaded!.defaultModel).toBe("openai/gpt-4o");
    });

    it("throws when no config exists in DB", () => {
      provisionInstance(slug);
      expect(() => registry.patchRuntimeConfig(slug, (c) => c)).toThrow(/No runtime config found/);
    });

    it("updates agents.config_json when agent configs change", () => {
      provisionInstance(slug);
      const config = createDefaultRuntimeConfig({});
      const firstAgent = config.agents[0]!;
      provisionAgent(slug, firstAgent.id, firstAgent.name);
      registry.saveRuntimeConfig(slug, config);

      registry.patchRuntimeConfig(slug, (c) => ({
        ...c,
        agents: c.agents.map((a) => ({
          ...a,
          name: "Renamed Agent",
        })),
      }));

      const inst = registry.getInstance(slug)!;
      const agentRow = registry.getAgentByAgentId(inst.id, firstAgent.id);
      expect(agentRow!.name).toBe("Renamed Agent");
      const agentConfig = JSON.parse(agentRow!.config_json!) as Record<string, unknown>;
      expect(agentConfig.name).toBe("Renamed Agent");
    });
  });
});
