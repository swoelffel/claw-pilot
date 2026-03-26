// src/runtime/session/__tests__/archetype-prompt.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the agent registry before importing the module under test
vi.mock("../../agent/registry.js", () => ({
  getAgent: vi.fn().mockReturnValue(undefined),
  resolveEffectivePersistence: vi.fn().mockReturnValue("ephemeral"),
}));

// Mock skill listing (not relevant to this test)
vi.mock("../../tool/built-in/skill.js", () => ({
  listAvailableSkills: vi.fn().mockReturnValue([]),
}));

import { buildSystemPrompt, type SystemPromptContext } from "../system-prompt.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers (same pattern as system-prompt.test.ts)
// ---------------------------------------------------------------------------

function makeAgentConfig(overrides: Partial<RuntimeAgentConfig> = {}): RuntimeAgentConfig {
  return {
    id: "test-agent",
    name: "Test Agent",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 20,
    allowSubAgents: true,
    toolProfile: "executor",
    isDefault: false,
    ...overrides,
  } as RuntimeAgentConfig;
}

function makeCtx(overrides?: Partial<SystemPromptContext>): SystemPromptContext {
  return {
    instanceSlug: "test",
    agentConfig: makeAgentConfig(),
    channel: "web",
    workDir: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — archetype injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects archetype block when agent has archetype set", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ archetype: "evaluator" }),
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("archetype_behavior");
    expect(result).toContain('type="evaluator"');
    expect(result).toContain("Behavioral Pattern: Evaluator");
  });

  it("does not inject archetype block when archetype is null", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ archetype: null }),
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).not.toContain("archetype_behavior");
  });

  it("does not inject archetype block when archetype is undefined", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig(),
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).not.toContain("archetype_behavior");
  });

  it("injects planner archetype with correct content", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ archetype: "planner" }),
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("Behavioral Pattern: Planner");
    expect(result).toContain("sprint contracts");
  });

  it("injects generator archetype with correct content", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ archetype: "generator" }),
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("Behavioral Pattern: Generator");
    expect(result).toContain("Self-review");
  });

  it("archetype block appears before teammates block", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ id: "pilot", archetype: "orchestrator" }),
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
    });
    const result = await buildSystemPrompt(ctx);
    const archetypePos = result.indexOf("archetype_behavior");
    const teammatesPos = result.indexOf("<teammates>");
    expect(archetypePos).toBeGreaterThan(-1);
    expect(teammatesPos).toBeGreaterThan(-1);
    expect(archetypePos).toBeLessThan(teammatesPos);
  });
});
