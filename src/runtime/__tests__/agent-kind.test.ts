/**
 * runtime/__tests__/agent-kind.test.ts
 *
 * Tests for PLAN-15a Phase 0 — Agent.Info.kind field and resolveEffectivePersistence():
 *   - Built-in agents annotated with correct kind (primary/subagent)
 *   - Custom agents created via initAgentRegistry() default to kind="primary"
 *   - resolveEffectivePersistence() infers persistence from kind
 *   - Config override takes priority over kind inference
 *
 * Follows the same pattern as agent.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initAgentRegistry, getAgent, resetAgentRegistry } from "../agent/index.js";
import { resolveEffectivePersistence } from "../agent/registry.js";
import { Agent } from "../agent/agent.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetAgentRegistry();
});

afterEach(() => {
  resetAgentRegistry();
});

// ---------------------------------------------------------------------------
// Suite 1 — Built-in agent kind annotations
// ---------------------------------------------------------------------------

describe("built-in agent kind annotations", () => {
  it(// build is now a hidden technical sub-agent → kind must be "subagent".
  "getAgent('build').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("build");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// plan is now a hidden technical sub-agent → kind must be "subagent".
  "getAgent('plan').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("plan");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// Positive: explore agent is spawned by task tool → kind must be "subagent".
  "getAgent('explore').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("explore");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// Positive: general agent is spawned by task tool → kind must be "subagent".
  "getAgent('general').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("general");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// compaction is an internal technical sub-agent → kind must be "subagent".
  "getAgent('compaction').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("compaction");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// title is an internal technical sub-agent → kind must be "subagent".
  "getAgent('title').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("title");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });

  it(// summary is an internal technical sub-agent → kind must be "subagent".
  "getAgent('summary').kind === 'subagent'", () => {
    // Arrange + Act
    const agent = getAgent("summary");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("subagent");
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Custom agent kind default
// ---------------------------------------------------------------------------

describe("custom agent kind default via initAgentRegistry()", () => {
  it(// Positive: a user-defined agent created via initAgentRegistry() must default
  // to kind="primary" (safe default: visible agent = primary agent).
  "custom agent created via initAgentRegistry() has kind === 'primary'", () => {
    // Arrange
    initAgentRegistry([
      {
        id: "custom-agent",
        name: "Custom Agent",
        model: "anthropic/claude-sonnet-4-5",
        systemPrompt: "You are a custom agent.",
        maxSteps: 10,
        allowSubAgents: false,
        toolProfile: "minimal",
        isDefault: false,
        permissions: [],
      },
    ]);

    // Act
    const agent = getAgent("custom-agent");

    // Assert
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("primary");
  });

  it(// Negative: a built-in agent overridden via initAgentRegistry() must preserve
  // its original kind (config override does not change kind).
  "overriding a built-in agent via initAgentRegistry() preserves its kind", () => {
    // Arrange — override build agent temperature but not kind
    initAgentRegistry([
      {
        id: "build",
        name: "build",
        model: "anthropic/claude-sonnet-4-5",
        temperature: 0.5,
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: true,
        permissions: [],
      },
    ]);

    // Act
    const agent = getAgent("build");

    // Assert — kind must still be "subagent" (build is now a technical sub-agent)
    expect(agent!.kind).toBe("subagent");
    // And the override was applied
    expect(agent!.temperature).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — resolveEffectivePersistence()
// ---------------------------------------------------------------------------

describe("resolveEffectivePersistence()", () => {
  it(// Positive: a primary agent without config override must resolve to "permanent".
  // Primary agents have long-lived sessions maintained across restarts.
  "resolveEffectivePersistence({ kind: 'primary' }) → 'permanent'", () => {
    // Arrange — use a minimal Agent.Info with kind="primary" (all built-ins are now subagents)
    const agentInfo = Agent.Info.parse({
      name: "test-primary",
      mode: "all",
      kind: "primary",
      permission: [],
      options: {},
    });
    expect(agentInfo.kind).toBe("primary");

    // Act
    const persistence = resolveEffectivePersistence(agentInfo);

    // Assert
    expect(persistence).toBe("permanent");
  });

  it(// Positive: a subagent without config override must resolve to "ephemeral".
  // Subagents are ephemeral tools — new session per task.
  "resolveEffectivePersistence({ kind: 'subagent' }) → 'ephemeral'", () => {
    // Arrange
    const agentInfo = getAgent("explore")!;
    expect(agentInfo.kind).toBe("subagent");

    // Act
    const persistence = resolveEffectivePersistence(agentInfo);

    // Assert
    expect(persistence).toBe("ephemeral");
  });

  it(// Positive: explicit config persistence="ephemeral" must override kind="primary".
  // Config always wins — allows forcing ephemeral mode on a primary agent.
  "resolveEffectivePersistence({ kind: 'primary' }, { persistence: 'ephemeral' }) → 'ephemeral'", () => {
    // Arrange — use a minimal Agent.Info with kind="primary" (all built-ins are now subagents)
    const agentInfo = Agent.Info.parse({
      name: "test-primary",
      mode: "all",
      kind: "primary",
      permission: [],
      options: {},
    });
    expect(agentInfo.kind).toBe("primary");

    const configOverride = {
      id: "test-primary",
      name: "test-primary",
      model: "anthropic/claude-sonnet-4-5",
      maxSteps: 20,
      allowSubAgents: true,
      toolProfile: "coding" as const,
      isDefault: true,
      permissions: [] as Array<{
        permission: string;
        pattern: string;
        action: "allow" | "deny" | "ask";
      }>,
      persistence: "ephemeral" as const,
    };

    // Act
    const persistence = resolveEffectivePersistence(agentInfo, configOverride);

    // Assert — config override wins over kind inference
    expect(persistence).toBe("ephemeral");
  });

  it(// Positive: explicit config persistence="permanent" must override kind="subagent".
  // Config always wins — allows forcing permanent mode on a subagent.
  "resolveEffectivePersistence({ kind: 'subagent' }, { persistence: 'permanent' }) → 'permanent'", () => {
    // Arrange
    const agentInfo = getAgent("explore")!;
    expect(agentInfo.kind).toBe("subagent");

    const configOverride = {
      id: "explore",
      name: "explore",
      model: "anthropic/claude-sonnet-4-5",
      maxSteps: 20,
      allowSubAgents: false,
      toolProfile: "minimal" as const,
      isDefault: false,
      permissions: [] as Array<{
        permission: string;
        pattern: string;
        action: "allow" | "deny" | "ask";
      }>,
      persistence: "permanent" as const,
    };

    // Act
    const persistence = resolveEffectivePersistence(agentInfo, configOverride);

    // Assert — config override wins
    expect(persistence).toBe("permanent");
  });

  it(// Negative: when config has no persistence field, kind inference applies.
  // Verifies the fallback chain: no config → use kind → "ephemeral" for subagent.
  "resolveEffectivePersistence({ kind: 'subagent' }, config without persistence) → 'ephemeral'", () => {
    // Arrange
    const agentInfo = getAgent("general")!;
    expect(agentInfo.kind).toBe("subagent");

    const configWithoutPersistence = {
      id: "general",
      name: "general",
      model: "anthropic/claude-sonnet-4-5",
      maxSteps: 20,
      allowSubAgents: false,
      toolProfile: "minimal" as const,
      isDefault: false,
      permissions: [] as Array<{
        permission: string;
        pattern: string;
        action: "allow" | "deny" | "ask";
      }>,
      // persistence intentionally absent
    };

    // Act
    const persistence = resolveEffectivePersistence(agentInfo, configWithoutPersistence);

    // Assert — falls back to kind inference → "ephemeral"
    expect(persistence).toBe("ephemeral");
  });

  it(// Negative: resolveEffectivePersistence called with a minimal Agent.Info
  // (kind defaults to "primary" per Zod schema) → "permanent".
  "resolveEffectivePersistence with minimal Agent.Info (kind defaults to primary) → 'permanent'", () => {
    // Arrange — build a minimal Agent.Info using Zod parse (kind defaults to "primary")
    const minimalAgent = Agent.Info.parse({
      name: "minimal",
      mode: "all",
      permission: [],
      options: {},
      // kind intentionally omitted — Zod default is "primary"
    });

    // Act
    const persistence = resolveEffectivePersistence(minimalAgent);

    // Assert
    expect(minimalAgent.kind).toBe("primary");
    expect(persistence).toBe("permanent");
  });
});
