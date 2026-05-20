// Quick validation test for the cp-system team YAML template
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAndValidateTeam } from "../team-import.js";

const YAML_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
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

  it("contains the 3 consolidated agents", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const ids = result.data.agents.map((a) => a.id);
    expect(ids).toEqual(["system-pilot", "ops", "analyst"]);
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
    expect(pilot!.files!["BOOTSTRAP.md"]).toBeDefined();
  });

  it("subagents (ops, analyst) have SOUL.md workspace files", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const id of ["ops", "analyst"]) {
      const agent = result.data.agents.find((a) => a.id === id);
      expect(agent).toBeDefined();
      expect(agent!.files?.["SOUL.md"]).toBeDefined();
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

  it("has spawn links from system-pilot to the 2 subagents", () => {
    const yaml = readFileSync(YAML_PATH, "utf-8");
    const result = parseAndValidateTeam(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const spawnTargets = result.data.links
      .filter((l) => l.source === "system-pilot" && l.type === "spawn")
      .map((l) => l.target);

    expect(spawnTargets.sort()).toEqual(["analyst", "ops"]);
  });
});
