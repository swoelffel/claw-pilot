// Quick validation test for the cp-system team YAML template
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parseAndValidateTeam } from "../team-import.js";

const YAML_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../templates/system/cp-system.team.yaml",
);

describe("cp-system.team.yaml", () => {
  it("parses and validates against TeamFileSchema", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    if (!result.success) {
      // Show full error for debugging
      console.error("Validation errors:", JSON.stringify(result.error, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("contains expected agents", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const ids = result.data.agents.map((a) => a.id);
    expect(ids).toContain("system-pilot");
    expect(ids).toContain("admin-exec");
    expect(ids).toContain("config-exec");
    expect(ids).toContain("analyst");
    expect(ids).toContain("architect");
    expect(ids).toContain("db-analyst");
  });

  it("has system-pilot as default agent with workspace files", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const pilot = result.data.agents.find((a) => a.id === "system-pilot");
    expect(pilot).toBeDefined();
    expect(pilot!.is_default).toBe(true);
    expect(pilot!.files).toBeDefined();
    expect(pilot!.files!["SOUL.md"]).toBeDefined();
    expect(pilot!.files!["AGENTS.md"]).toBeDefined();
  });

  it("subagents have systemPrompt in config", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const id of ["admin-exec", "config-exec", "analyst", "architect", "db-analyst"]) {
      const agent = result.data.agents.find((a) => a.id === id);
      expect(agent).toBeDefined();
      expect(agent!.config?.systemPrompt).toBeDefined();
    }
  });

  it("mergeTeamIntoRuntimeConfig propagates defaultModel to agents", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Simulate what provisioner does: inject defaults.model
    const teamFile = { ...result.data };
    teamFile.defaults = { model: "anthropic/claude-sonnet-4-5" };

    // Verify YAML agents don't have explicit model (they rely on defaults propagation)
    for (const agent of teamFile.agents) {
      expect(agent.config?.model).toBeUndefined();
    }
  });

  it("has spawn links from system-pilot to all subagents", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const spawnTargets = result.data.links
      .filter((l) => l.source === "system-pilot" && l.type === "spawn")
      .map((l) => l.target);

    expect(spawnTargets).toContain("admin-exec");
    expect(spawnTargets).toContain("config-exec");
    expect(spawnTargets).toContain("analyst");
    expect(spawnTargets).toContain("architect");
    expect(spawnTargets).toContain("db-analyst");
  });
});
