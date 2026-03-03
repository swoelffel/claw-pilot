// src/core/__tests__/config-updater.test.ts
//
// Unit tests for classifyChanges() — pure function, no mocks needed.
// Verifies that each type of config patch is correctly classified as
// db-only, hot-reload, or restart-required.

import { describe, it, expect } from "vitest";
import { classifyChanges } from "../config-updater.js";
import type { ConfigPatch } from "../config-updater.js";

describe("classifyChanges", () => {
  // ---------------------------------------------------------------------------
  // DB-only changes
  // ---------------------------------------------------------------------------

  it("displayName only → dbOnly", () => {
    const patch: ConfigPatch = { general: { displayName: "New Name" } };
    const result = classifyChanges(patch);
    expect(result.dbOnly).toBe(true);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.requiresRestart).toBe(false);
    expect(result.restartReason).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Hot-reload changes (file changes, no restart)
  // ---------------------------------------------------------------------------

  it("general.defaultModel → hotReloadOnly", () => {
    const patch: ConfigPatch = { general: { defaultModel: "gpt-4o" } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
    expect(result.dbOnly).toBe(false);
  });

  it("general.toolsProfile → hotReloadOnly", () => {
    const patch: ConfigPatch = { general: { toolsProfile: "full" } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("providers.add → hotReloadOnly", () => {
    const patch: ConfigPatch = { providers: { add: [{ id: "openai", apiKey: "sk-xxx" }] } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("providers.update → hotReloadOnly", () => {
    const patch: ConfigPatch = { providers: { update: [{ id: "anthropic", apiKey: "sk-new" }] } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("providers.remove → hotReloadOnly", () => {
    const patch: ConfigPatch = { providers: { remove: ["openai"] } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("agentDefaults changes → hotReloadOnly", () => {
    const patch: ConfigPatch = {
      agentDefaults: { subagents: { maxConcurrent: 5 } },
    };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("agents list changes → hotReloadOnly", () => {
    const patch: ConfigPatch = {
      agents: [{ id: "main", name: "Renamed Main" }],
    };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("channels.telegram changes → hotReloadOnly", () => {
    const patch: ConfigPatch = {
      channels: { telegram: { enabled: true, botToken: "123:ABC" } },
    };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("gateway.reloadMode → hotReloadOnly (hot-reload field)", () => {
    const patch: ConfigPatch = { gateway: { reloadMode: "watch" } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
    expect(result.pairingWarning).toBe(false);
  });

  it("gateway.reloadDebounceMs → hotReloadOnly (hot-reload field)", () => {
    const patch: ConfigPatch = { gateway: { reloadDebounceMs: 500 } };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.requiresRestart).toBe(false);
    expect(result.pairingWarning).toBe(false);
  });

  it("gateway.port → requiresRestart + pairingWarning", () => {
    const patch: ConfigPatch = { gateway: { port: 18795 } };
    const result = classifyChanges(patch);
    expect(result.requiresRestart).toBe(true);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.restartReason).toContain("gateway.port");
    expect(result.pairingWarning).toBe(true);
  });

  it("gateway.port + reloadMode → requiresRestart + pairingWarning", () => {
    const patch: ConfigPatch = { gateway: { port: 18796, reloadMode: "watch" } };
    const result = classifyChanges(patch);
    expect(result.requiresRestart).toBe(true);
    expect(result.pairingWarning).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Restart-required changes
  // ---------------------------------------------------------------------------

  it("plugins.mem0 → requiresRestart", () => {
    const patch: ConfigPatch = {
      plugins: { mem0: { enabled: true, ollamaUrl: "http://localhost:11434" } },
    };
    const result = classifyChanges(patch);
    expect(result.requiresRestart).toBe(true);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.restartReason).toContain("plugins");
  });

  // ---------------------------------------------------------------------------
  // Combined changes
  // ---------------------------------------------------------------------------

  it("displayName + defaultModel → hotReloadOnly (not dbOnly)", () => {
    const patch: ConfigPatch = {
      general: { displayName: "New", defaultModel: "gpt-4o" },
    };
    const result = classifyChanges(patch);
    expect(result.hotReloadOnly).toBe(true);
    expect(result.dbOnly).toBe(false);
    expect(result.requiresRestart).toBe(false);
  });

  it("displayName + plugins → requiresRestart (restart wins)", () => {
    const patch: ConfigPatch = {
      general: { displayName: "New" },
      plugins: { mem0: { enabled: false } },
    };
    const result = classifyChanges(patch);
    expect(result.requiresRestart).toBe(true);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.restartReason).toContain("plugins");
  });

  it("providers + plugins → requiresRestart (restart wins over hot-reload)", () => {
    const patch: ConfigPatch = {
      providers: { add: [{ id: "openai" }] },
      plugins: { mem0: { enabled: true } },
    };
    const result = classifyChanges(patch);
    expect(result.requiresRestart).toBe(true);
    expect(result.hotReloadOnly).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("empty patch → no changes (all false)", () => {
    const patch: ConfigPatch = {};
    const result = classifyChanges(patch);
    expect(result.dbOnly).toBe(false);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.requiresRestart).toBe(false);
    expect(result.restartReason).toBeNull();
  });

  it("general with only displayName undefined → no changes", () => {
    // general object exists but has no meaningful keys
    const patch: ConfigPatch = { general: {} };
    const result = classifyChanges(patch);
    // general exists but has no keys after removing displayName → no file changes
    expect(result.dbOnly).toBe(false);
    expect(result.hotReloadOnly).toBe(false);
    expect(result.requiresRestart).toBe(false);
  });
});
