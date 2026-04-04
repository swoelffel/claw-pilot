/**
 * runtime/agent/__tests__/defaults.test.ts
 *
 * Unit tests for built-in agent definitions.
 * Pure data assertions — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULESET,
  BUILD_AGENT,
  PLAN_AGENT,
  EXPLORE_AGENT,
  GENERAL_AGENT,
  COMPACTION_AGENT,
  TITLE_AGENT,
  SUMMARY_AGENT,
  BUILTIN_AGENTS,
} from "../defaults.js";

// ---------------------------------------------------------------------------
// DEFAULT_RULESET
// ---------------------------------------------------------------------------

describe("DEFAULT_RULESET", () => {
  it("has 4 rules", () => {
    expect(DEFAULT_RULESET).toHaveLength(4);
  });

  it("allows all permissions by default", () => {
    expect(DEFAULT_RULESET[0]).toEqual({ permission: "*", pattern: "**", action: "allow" });
  });

  it("asks for .env file reads", () => {
    const envRules = DEFAULT_RULESET.filter((r) => r.action === "ask");
    expect(envRules).toHaveLength(2);
    expect(envRules.map((r) => r.pattern)).toEqual(["*.env", "*.env.*"]);
  });

  it("allows .env.example reads", () => {
    expect(DEFAULT_RULESET[3]).toEqual({
      permission: "read",
      pattern: "*.env.example",
      action: "allow",
    });
  });
});

// ---------------------------------------------------------------------------
// Individual agents
// ---------------------------------------------------------------------------

describe("BUILD_AGENT", () => {
  it("has correct identity fields", () => {
    expect(BUILD_AGENT.name).toBe("build");
    expect(BUILD_AGENT.mode).toBe("subagent");
    expect(BUILD_AGENT.kind).toBe("subagent");
    expect(BUILD_AGENT.category).toBe("tool");
    expect(BUILD_AGENT.archetype).toBe("generator");
  });

  it("is native and hidden", () => {
    expect(BUILD_AGENT.native).toBe(true);
    expect(BUILD_AGENT.hidden).toBe(true);
  });

  it("has a non-empty prompt", () => {
    expect(BUILD_AGENT.prompt).toBeDefined();
    expect(BUILD_AGENT.prompt!.length).toBeGreaterThan(0);
  });

  it("includes question permission", () => {
    const questionRule = BUILD_AGENT.permission!.find((r) => r.permission === "question");
    expect(questionRule).toBeDefined();
    expect(questionRule!.action).toBe("allow");
  });
});

describe("PLAN_AGENT", () => {
  it("has correct identity fields", () => {
    expect(PLAN_AGENT.name).toBe("plan");
    expect(PLAN_AGENT.category).toBe("tool");
    expect(PLAN_AGENT.archetype).toBe("planner");
  });

  it("is native and hidden", () => {
    expect(PLAN_AGENT.native).toBe(true);
    expect(PLAN_AGENT.hidden).toBe(true);
  });

  it("uses PLAN_AGENT_RULESET (not DEFAULT_RULESET)", () => {
    // Plan agent should NOT have the wildcard "*" allow rule from DEFAULT_RULESET
    // It uses a read-only ruleset
    expect(PLAN_AGENT.permission).toBeDefined();
    expect(PLAN_AGENT.permission).not.toEqual(DEFAULT_RULESET);
  });
});

describe("EXPLORE_AGENT", () => {
  it("has correct identity fields", () => {
    expect(EXPLORE_AGENT.name).toBe("explore");
    expect(EXPLORE_AGENT.category).toBe("tool");
    expect(EXPLORE_AGENT.archetype).toBe("analyst");
  });

  it("is native but NOT hidden", () => {
    expect(EXPLORE_AGENT.native).toBe(true);
    expect(EXPLORE_AGENT.hidden).toBeUndefined();
  });

  it("has a description mentioning thoroughness levels", () => {
    expect(EXPLORE_AGENT.description).toContain("quick");
    expect(EXPLORE_AGENT.description).toContain("very thorough");
  });
});

describe("GENERAL_AGENT", () => {
  it("has correct identity fields", () => {
    expect(GENERAL_AGENT.name).toBe("general");
    expect(GENERAL_AGENT.category).toBe("tool");
    expect(GENERAL_AGENT.archetype).toBeNull();
  });

  it("denies todo permissions", () => {
    const denyRules = GENERAL_AGENT.permission!.filter((r) => r.action === "deny");
    expect(denyRules).toHaveLength(2);
    expect(denyRules.map((r) => r.permission).sort()).toEqual(["todoread", "todowrite"]);
  });
});

describe("COMPACTION_AGENT", () => {
  it("has correct identity and category", () => {
    expect(COMPACTION_AGENT.name).toBe("compaction");
    expect(COMPACTION_AGENT.category).toBe("system");
    expect(COMPACTION_AGENT.archetype).toBeNull();
  });

  it("is native and hidden", () => {
    expect(COMPACTION_AGENT.native).toBe(true);
    expect(COMPACTION_AGENT.hidden).toBe(true);
  });
});

describe("TITLE_AGENT", () => {
  it("has correct identity and category", () => {
    expect(TITLE_AGENT.name).toBe("title");
    expect(TITLE_AGENT.category).toBe("system");
  });

  it("has a custom temperature", () => {
    expect(TITLE_AGENT.temperature).toBe(0.5);
  });

  it("is native and hidden", () => {
    expect(TITLE_AGENT.native).toBe(true);
    expect(TITLE_AGENT.hidden).toBe(true);
  });
});

describe("SUMMARY_AGENT", () => {
  it("has correct identity and category", () => {
    expect(SUMMARY_AGENT.name).toBe("summary");
    expect(SUMMARY_AGENT.category).toBe("system");
  });

  it("is native and hidden", () => {
    expect(SUMMARY_AGENT.native).toBe(true);
    expect(SUMMARY_AGENT.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUILTIN_AGENTS array
// ---------------------------------------------------------------------------

describe("BUILTIN_AGENTS", () => {
  it("contains exactly 7 agents", () => {
    expect(BUILTIN_AGENTS).toHaveLength(7);
  });

  it("is in the expected order", () => {
    expect(BUILTIN_AGENTS.map((a) => a.name)).toEqual([
      "build",
      "plan",
      "explore",
      "general",
      "compaction",
      "title",
      "summary",
    ]);
  });

  it("all agents are native", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agent.native).toBe(true);
    }
  });

  it("all agents are subagents", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agent.mode).toBe("subagent");
      expect(agent.kind).toBe("subagent");
    }
  });

  it("system agents are all hidden", () => {
    const systemAgents = BUILTIN_AGENTS.filter((a) => a.category === "system");
    expect(systemAgents).toHaveLength(3);
    for (const agent of systemAgents) {
      expect(agent.hidden).toBe(true);
    }
  });
});
