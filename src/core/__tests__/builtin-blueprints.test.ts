// src/core/__tests__/builtin-blueprints.test.ts
import { describe, it, expect } from "vitest";
import { listBuiltinBlueprints, loadBuiltinBlueprint } from "../builtin-blueprints.js";

describe("listBuiltinBlueprints", () => {
  it("returns at least the 3 shipped blueprints", async () => {
    const blueprints = await listBuiltinBlueprints();
    expect(blueprints.length).toBeGreaterThanOrEqual(3);

    const slugs = blueprints.map((b) => b.slug);
    expect(slugs).toContain("dev-harness");
    expect(slugs).toContain("design-studio");
    expect(slugs).toContain("team-architect");
  });

  it("each blueprint has valid structure", async () => {
    const blueprints = await listBuiltinBlueprints();
    for (const bp of blueprints) {
      expect(bp.slug).toBeTruthy();
      expect(bp.name).toBeTruthy();
      expect(bp.description).toBeTruthy();
      expect(bp.agentCount).toBeGreaterThanOrEqual(2);
      expect(bp.agentNames.length).toBe(bp.agentCount);
      expect(bp.teamFile).toBeDefined();
      expect(bp.teamFile.version).toBe("1");
      expect(bp.teamFile.agents.length).toBe(bp.agentCount);
    }
  });

  it("dev-harness has 3 agents with correct archetypes", async () => {
    const blueprints = await listBuiltinBlueprints();
    const devHarness = blueprints.find((b) => b.slug === "dev-harness")!;
    expect(devHarness.agentCount).toBe(3);
    expect(devHarness.agentNames).toEqual(["Planner", "Developer", "QA"]);

    const archetypes = devHarness.teamFile.agents.map((a) => a.config?.archetype);
    expect(archetypes).toEqual(["planner", "generator", "evaluator"]);
  });

  it("dev-harness has 4 a2a links forming the feedback loop", async () => {
    const blueprints = await listBuiltinBlueprints();
    const devHarness = blueprints.find((b) => b.slug === "dev-harness")!;
    expect(devHarness.teamFile.links).toHaveLength(4);
    expect(devHarness.teamFile.links.every((l) => l.type === "a2a")).toBe(true);

    const linkPairs = devHarness.teamFile.links.map((l) => `${l.source}→${l.target}`);
    expect(linkPairs).toContain("planner→developer");
    expect(linkPairs).toContain("developer→qa");
    expect(linkPairs).toContain("qa→developer");
    expect(linkPairs).toContain("qa→planner");
  });

  it("each blueprint has exactly one default agent", async () => {
    const blueprints = await listBuiltinBlueprints();
    for (const bp of blueprints) {
      const defaults = bp.teamFile.agents.filter((a) => a.is_default);
      expect(defaults).toHaveLength(1);
    }
  });

  it("all agents have SOUL.md workspace files", async () => {
    const blueprints = await listBuiltinBlueprints();
    for (const bp of blueprints) {
      for (const agent of bp.teamFile.agents) {
        expect(agent.files).toBeDefined();
        expect(agent.files!["SOUL.md"]).toBeTruthy();
      }
    }
  });
});

describe("loadBuiltinBlueprint", () => {
  it("loads a known blueprint by slug", async () => {
    const bp = await loadBuiltinBlueprint("design-studio");
    expect(bp).toBeDefined();
    expect(bp!.name).toBe("Design Studio");
    expect(bp!.agentCount).toBe(2);
  });

  it("returns undefined for unknown slug", async () => {
    const bp = await loadBuiltinBlueprint("nonexistent");
    expect(bp).toBeUndefined();
  });
});
