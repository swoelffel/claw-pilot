/**
 * core/__tests__/blueprint-repository.test.ts
 *
 * Unit tests for BlueprintRepository (team blueprints).
 * Uses tmpDir + initDatabase for real SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { BlueprintRepository } from "../repositories/blueprint-repository.js";

let tmpDir: string;
let db: Database.Database;
let repo: BlueprintRepository;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-bp-repo-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  repo = new BlueprintRepository(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Blueprints CRUD
// ---------------------------------------------------------------------------

describe("BlueprintRepository", () => {
  describe("createBlueprint / getBlueprint", () => {
    it("creates a blueprint and returns the record", () => {
      const bp = repo.createBlueprint({ name: "Team Alpha" });
      expect(bp.id).toBeGreaterThan(0);
      expect(bp.name).toBe("Team Alpha");
      expect(bp.created_at).toBeTruthy();
      expect(bp.updated_at).toBeTruthy();
    });

    it("accepts optional fields", () => {
      const bp = repo.createBlueprint({
        name: "Team",
        description: "A team",
        icon: "users",
        tags: "dev",
        color: "#ff0000",
      });
      expect(bp.description).toBe("A team");
      expect(bp.icon).toBe("users");
      expect(bp.tags).toBe("dev");
      expect(bp.color).toBe("#ff0000");
    });

    it("getBlueprint returns undefined for nonexistent ID", () => {
      expect(repo.getBlueprint(99999)).toBeUndefined();
    });
  });

  describe("listBlueprints", () => {
    it("returns empty array initially", () => {
      expect(repo.listBlueprints()).toEqual([]);
    });

    it("returns blueprints sorted by name ASC with agent_count", () => {
      const bp1 = repo.createBlueprint({ name: "Zeta Team" });
      repo.createBlueprint({ name: "Alpha Team" });
      repo.createBlueprintAgent(bp1.id, { agentId: "a1", name: "Agent 1" });

      const list = repo.listBlueprints();
      expect(list).toHaveLength(2);
      expect(list[0]!.name).toBe("Alpha Team");
      expect(list[1]!.name).toBe("Zeta Team");
      expect((list[1] as any).agent_count).toBe(1);
    });
  });

  describe("updateBlueprint", () => {
    it("updates specified fields", () => {
      const bp = repo.createBlueprint({ name: "Original", description: "desc" });
      const updated = repo.updateBlueprint(bp.id, { name: "Renamed" });
      expect(updated!.name).toBe("Renamed");
      expect(updated!.description).toBe("desc"); // unchanged
    });

    it("returns existing record when no fields provided", () => {
      const bp = repo.createBlueprint({ name: "NoChange" });
      const result = repo.updateBlueprint(bp.id, {});
      expect(result!.name).toBe("NoChange");
    });

    it("can set fields to null", () => {
      const bp = repo.createBlueprint({ name: "X", icon: "star" });
      const updated = repo.updateBlueprint(bp.id, { icon: null });
      expect(updated!.icon).toBeNull();
    });
  });

  describe("deleteBlueprint", () => {
    it("removes the blueprint", () => {
      const bp = repo.createBlueprint({ name: "ToDelete" });
      repo.deleteBlueprint(bp.id);
      expect(repo.getBlueprint(bp.id)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Blueprint Agents
  // ---------------------------------------------------------------------------

  describe("blueprint agents", () => {
    it("creates and lists agents sorted by is_default DESC, agent_id ASC", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "beta", name: "Beta" });
      repo.createBlueprintAgent(bp.id, { agentId: "alpha", name: "Alpha", isDefault: true });

      const agents = repo.listBlueprintAgents(bp.id);
      expect(agents).toHaveLength(2);
      expect(agents[0]!.agent_id).toBe("alpha"); // default first
      expect(agents[1]!.agent_id).toBe("beta");
    });

    it("getBlueprintAgent returns a specific agent", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "Agent One" });
      const agent = repo.getBlueprintAgent(bp.id, "a1");
      expect(agent).toBeDefined();
      expect(agent!.name).toBe("Agent One");
      expect(agent!.workspace_path).toContain("blueprint://");
    });

    it("getBlueprintAgent returns undefined for missing agent", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      expect(repo.getBlueprintAgent(bp.id, "nope")).toBeUndefined();
    });

    it("deleteBlueprintAgent removes the agent", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "Agent" });
      repo.deleteBlueprintAgent(bp.id, "a1");
      expect(repo.getBlueprintAgent(bp.id, "a1")).toBeUndefined();
    });

    it("updateBlueprintAgentPosition sets x/y", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      const agent = repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "Agent" });
      repo.updateBlueprintAgentPosition(agent.id, 100, 200);
      const updated = repo.getBlueprintAgent(bp.id, "a1");
      expect(updated!.position_x).toBe(100);
      expect(updated!.position_y).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Blueprint Links
  // ---------------------------------------------------------------------------

  describe("blueprint links", () => {
    it("replaceBlueprintLinks sets links in a transaction", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "A1" });
      repo.createBlueprintAgent(bp.id, { agentId: "a2", name: "A2" });

      repo.replaceBlueprintLinks(bp.id, [
        { sourceAgentId: "a1", targetAgentId: "a2", linkType: "spawn" },
      ]);

      const links = repo.listBlueprintLinks(bp.id);
      expect(links).toHaveLength(1);
      expect(links[0]!.source_agent_id).toBe("a1");
      expect(links[0]!.target_agent_id).toBe("a2");
      expect(links[0]!.link_type).toBe("spawn");
    });

    it("replaceBlueprintLinks replaces existing links", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "A1" });
      repo.createBlueprintAgent(bp.id, { agentId: "a2", name: "A2" });

      repo.replaceBlueprintLinks(bp.id, [
        { sourceAgentId: "a1", targetAgentId: "a2", linkType: "spawn" },
      ]);
      repo.replaceBlueprintLinks(bp.id, [
        { sourceAgentId: "a2", targetAgentId: "a1", linkType: "a2a" },
      ]);

      const links = repo.listBlueprintLinks(bp.id);
      expect(links).toHaveLength(1);
      expect(links[0]!.link_type).toBe("a2a");
    });

    it("listBlueprintLinks returns empty for no links", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      expect(repo.listBlueprintLinks(bp.id)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Builder Data
  // ---------------------------------------------------------------------------

  describe("getBlueprintBuilderData", () => {
    it("returns composite data for existing blueprint", () => {
      const bp = repo.createBlueprint({ name: "Team" });
      repo.createBlueprintAgent(bp.id, { agentId: "a1", name: "A1" });
      repo.replaceBlueprintLinks(bp.id, [
        { sourceAgentId: "a1", targetAgentId: "a1", linkType: "a2a" },
      ]);

      const data = repo.getBlueprintBuilderData(bp.id);
      expect(data).toBeDefined();
      expect(data!.blueprint.name).toBe("Team");
      expect(data!.agents).toHaveLength(1);
      expect(data!.links).toHaveLength(1);
    });

    it("returns undefined for nonexistent blueprint", () => {
      expect(repo.getBlueprintBuilderData(99999)).toBeUndefined();
    });
  });
});
