/**
 * runtime/__tests__/agent.test.ts
 *
 * Unit tests for the Agent registry (Phase 2).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  initAgentRegistry,
  getAgent,
  listAgents,
  defaultAgentName,
  resetAgentRegistry,
  BUILTIN_AGENTS,
} from "../agent/index.js";
import { Agent } from "../agent/agent.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetAgentRegistry();
});

// ---------------------------------------------------------------------------
// Built-in agents
// ---------------------------------------------------------------------------

describe("BUILTIN_AGENTS", () => {
  it("contains 7 built-in agents", () => {
    expect(BUILTIN_AGENTS).toHaveLength(7);
  });

  it("includes build, plan, explore, general, compaction, title, summary", () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(names).toContain("build");
    expect(names).toContain("plan");
    expect(names).toContain("explore");
    expect(names).toContain("general");
    expect(names).toContain("compaction");
    expect(names).toContain("title");
    expect(names).toContain("summary");
  });

  it("tool agents have category 'tool'", () => {
    const toolAgents = BUILTIN_AGENTS.filter((a) =>
      ["build", "plan", "explore", "general"].includes(a.name),
    );
    for (const agent of toolAgents) {
      expect(agent.category, `${agent.name} should be category "tool"`).toBe("tool");
    }
  });

  it("system agents have category 'system'", () => {
    const systemAgents = BUILTIN_AGENTS.filter((a) =>
      ["compaction", "title", "summary"].includes(a.name),
    );
    for (const agent of systemAgents) {
      expect(agent.category, `${agent.name} should be category "system"`).toBe("system");
    }
  });

  it("all agents have valid Agent.Info shape", () => {
    for (const agent of BUILTIN_AGENTS) {
      const result = Agent.Info.safeParse(agent);
      expect(result.success, `Agent "${agent.name}" failed validation`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Registry — lazy init
// ---------------------------------------------------------------------------

describe("getAgent()", () => {
  it("returns build agent without explicit init", () => {
    const agent = getAgent("build");
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("build");
    // build is now a hidden technical sub-agent
    expect(agent?.mode).toBe("subagent");
  });

  it("returns undefined for unknown agent", () => {
    expect(getAgent("nonexistent")).toBeUndefined();
  });

  it("returns explore agent with correct mode", () => {
    const agent = getAgent("explore");
    expect(agent?.mode).toBe("subagent");
  });

  it("compaction agent is hidden", () => {
    const agent = getAgent("compaction");
    expect(agent?.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registry — listAgents
// ---------------------------------------------------------------------------

describe("listAgents()", () => {
  it("returns only explore and general by default (build and plan are now hidden)", () => {
    const agents = listAgents();
    const names = agents.map((a) => a.name);
    // Visible subagents
    expect(names).toContain("explore");
    expect(names).toContain("general");
    // Hidden technical sub-agents should be excluded
    expect(names).not.toContain("build");
    expect(names).not.toContain("plan");
    expect(names).not.toContain("compaction");
    expect(names).not.toContain("title");
    expect(names).not.toContain("summary");
  });

  it("includes hidden agents when includeHidden=true", () => {
    const agents = listAgents({ includeHidden: true });
    const names = agents.map((a) => a.name);
    expect(names).toContain("build");
    expect(names).toContain("plan");
    expect(names).toContain("compaction");
    expect(names).toContain("title");
    expect(names).toContain("summary");
  });

  it("filters by mode=primary returns no built-in agents (all built-ins are now subagents)", () => {
    const agents = listAgents({ mode: "primary" });
    const names = agents.map((a) => a.name);
    // All built-ins are now mode=subagent; only user-defined agents with mode=primary/all appear
    expect(names).not.toContain("build");
    expect(names).not.toContain("plan");
  });

  it("filters by mode=subagent includes explore, general (visible) and not hidden ones", () => {
    const agents = listAgents({ mode: "subagent" });
    for (const a of agents) {
      expect(a.mode === "subagent" || a.mode === "all").toBe(true);
    }
    const names = agents.map((a) => a.name);
    expect(names).toContain("explore");
    expect(names).toContain("general");
    // build and plan are hidden subagents — excluded by default
    expect(names).not.toContain("build");
    expect(names).not.toContain("plan");
  });

  it("filters by mode=subagent with includeHidden=true includes build and plan", () => {
    const agents = listAgents({ mode: "subagent", includeHidden: true });
    const names = agents.map((a) => a.name);
    expect(names).toContain("explore");
    expect(names).toContain("general");
    expect(names).toContain("build");
    expect(names).toContain("plan");
  });
});

// ---------------------------------------------------------------------------
// Registry — defaultAgentName
// ---------------------------------------------------------------------------

describe("defaultAgentName()", () => {
  it("throws when no primary visible agent exists (all built-ins are now hidden subagents)", () => {
    // After reclassification, built-ins are all hidden/subagent.
    // Without a config-defined primary agent, defaultAgentName() must throw.
    initAgentRegistry([]);
    expect(() => defaultAgentName()).toThrow("No primary visible agent found in registry");
  });

  it("returns the isDefault agent when a config agent with isDefault=true is registered", () => {
    initAgentRegistry([
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-5",
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: true,
        permissions: [],
      },
    ]);
    expect(defaultAgentName()).toBe("main");
  });

  it("falls back to first visible non-subagent when no isDefault agent exists", () => {
    initAgentRegistry([
      {
        id: "my-agent",
        name: "My Agent",
        model: "anthropic/claude-sonnet-4-5",
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: false,
        permissions: [],
      },
    ]);
    expect(defaultAgentName()).toBe("my-agent");
  });
});

// ---------------------------------------------------------------------------
// Registry — config overrides
// ---------------------------------------------------------------------------

describe("initAgentRegistry() with config overrides", () => {
  it("overrides built-in agent temperature", () => {
    initAgentRegistry([
      {
        id: "build",
        name: "build",
        model: "anthropic/claude-sonnet-4-5",
        temperature: 0.3,
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: true,
        permissions: [],
      },
    ]);

    const agent = getAgent("build");
    expect(agent?.temperature).toBe(0.3);
  });

  it("creates a new user-defined agent", () => {
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

    const agent = getAgent("custom-agent");
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("Custom Agent");
    expect(agent?.native).toBe(false);
    expect(agent?.mode).toBe("all");
    expect(agent?.category).toBe("user");
  });

  it("merges permissions: config permissions appended after base", () => {
    initAgentRegistry([
      {
        id: "build",
        name: "build",
        model: "anthropic/claude-sonnet-4-5",
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "coding",
        isDefault: true,
        permissions: [{ permission: "bash", pattern: "**", action: "deny" }],
      },
    ]);

    const agent = getAgent("build");
    expect(agent?.permission).toBeDefined();
    // The custom deny rule should be present
    const hasDenyBash = agent?.permission.some(
      (r) => r.permission === "bash" && r.action === "deny",
    );
    expect(hasDenyBash).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent.toSummary()
// ---------------------------------------------------------------------------

describe("Agent.toSummary()", () => {
  it("returns a summary with correct fields for build (now hidden subagent)", () => {
    const agent = getAgent("build")!;
    const summary = Agent.toSummary(agent);

    expect(summary.name).toBe("build");
    expect(summary.mode).toBe("subagent");
    expect(summary.kind).toBe("subagent");
    expect(summary.category).toBe("tool");
    expect(summary.native).toBe(true);
    expect(summary.hidden).toBe(true);
    expect(typeof summary.description).toBe("string");
  });

  it("includes category in summary for system agents", () => {
    const agent = getAgent("compaction")!;
    const summary = Agent.toSummary(agent);
    expect(summary.category).toBe("system");
  });
});
