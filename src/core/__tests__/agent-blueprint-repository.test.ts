/**
 * core/__tests__/agent-blueprint-repository.test.ts
 *
 * Unit tests for AgentBlueprintRepository.
 * Uses tmpDir + initDatabase for real SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { AgentBlueprintRepository } from "../repositories/agent-blueprint-repository.js";

let tmpDir: string;
let db: Database.Database;
let repo: AgentBlueprintRepository;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-ab-repo-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  repo = new AgentBlueprintRepository(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CRUD — Agent Blueprints
// ---------------------------------------------------------------------------

describe("AgentBlueprintRepository", () => {
  describe("createAgentBlueprint", () => {
    it("creates a blueprint and returns the record", () => {
      const bp = repo.createAgentBlueprint({ name: "My Agent" });
      expect(bp.id).toBeTruthy();
      expect(bp.name).toBe("My Agent");
      expect(bp.category).toBe("user"); // default
      expect(bp.config_json).toBe("{}");
      expect(bp.created_at).toBeTruthy();
    });

    it("accepts optional fields", () => {
      const bp = repo.createAgentBlueprint({
        name: "Tool Agent",
        description: "A tool agent",
        category: "tool",
        configJson: '{"model":"gpt-4o"}',
        icon: "wrench",
        tags: "dev,test",
      });
      expect(bp.description).toBe("A tool agent");
      expect(bp.category).toBe("tool");
      expect(bp.config_json).toBe('{"model":"gpt-4o"}');
      expect(bp.icon).toBe("wrench");
      expect(bp.tags).toBe("dev,test");
    });
  });

  describe("getAgentBlueprint", () => {
    it("returns the blueprint by ID", () => {
      const created = repo.createAgentBlueprint({ name: "Test" });
      const found = repo.getAgentBlueprint(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Test");
    });

    it("returns undefined for nonexistent ID", () => {
      expect(repo.getAgentBlueprint("nonexistent")).toBeUndefined();
    });
  });

  describe("listAgentBlueprints", () => {
    it("returns empty array initially", () => {
      expect(repo.listAgentBlueprints()).toEqual([]);
    });

    it("returns blueprints sorted by name ASC with file_count", () => {
      const bp1 = repo.createAgentBlueprint({ name: "Zeta" });
      repo.createAgentBlueprint({ name: "Alpha" });
      repo.upsertAgentBlueprintFile(bp1.id, "README.md", "# Hello");

      const list = repo.listAgentBlueprints();
      expect(list).toHaveLength(2);
      expect(list[0]!.name).toBe("Alpha");
      expect(list[1]!.name).toBe("Zeta");
      // file_count is returned as a number
      expect((list[1] as any).file_count).toBe(1);
    });
  });

  describe("updateAgentBlueprint", () => {
    it("updates specified fields only", () => {
      const bp = repo.createAgentBlueprint({ name: "Original", description: "desc" });
      const updated = repo.updateAgentBlueprint(bp.id, { name: "Renamed" });
      expect(updated!.name).toBe("Renamed");
      expect(updated!.description).toBe("desc"); // unchanged
    });

    it("returns existing record when no fields provided", () => {
      const bp = repo.createAgentBlueprint({ name: "NoChange" });
      const result = repo.updateAgentBlueprint(bp.id, {});
      expect(result!.name).toBe("NoChange");
    });

    it("can set description to null", () => {
      const bp = repo.createAgentBlueprint({ name: "X", description: "has desc" });
      const updated = repo.updateAgentBlueprint(bp.id, { description: null });
      expect(updated!.description).toBeNull();
    });
  });

  describe("deleteAgentBlueprint", () => {
    it("removes the blueprint", () => {
      const bp = repo.createAgentBlueprint({ name: "ToDelete" });
      repo.deleteAgentBlueprint(bp.id);
      expect(repo.getAgentBlueprint(bp.id)).toBeUndefined();
    });

    it("cascades to files", () => {
      const bp = repo.createAgentBlueprint({ name: "WithFiles" });
      repo.upsertAgentBlueprintFile(bp.id, "SOUL.md", "soul content");
      repo.deleteAgentBlueprint(bp.id);
      expect(repo.listAgentBlueprintFiles(bp.id)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  describe("agent blueprint files", () => {
    it("upserts and lists files sorted by filename", () => {
      const bp = repo.createAgentBlueprint({ name: "WithFiles" });
      repo.upsertAgentBlueprintFile(bp.id, "SOUL.md", "soul");
      repo.upsertAgentBlueprintFile(bp.id, "IDENTITY.md", "identity");

      const files = repo.listAgentBlueprintFiles(bp.id);
      expect(files).toHaveLength(2);
      expect(files[0]!.filename).toBe("IDENTITY.md");
      expect(files[1]!.filename).toBe("SOUL.md");
    });

    it("getAgentBlueprintFile returns a specific file", () => {
      const bp = repo.createAgentBlueprint({ name: "Test" });
      repo.upsertAgentBlueprintFile(bp.id, "README.md", "hello");
      const file = repo.getAgentBlueprintFile(bp.id, "README.md");
      expect(file).toBeDefined();
      expect(file!.content).toBe("hello");
      expect(file!.content_hash).toBeTruthy();
    });

    it("getAgentBlueprintFile returns undefined for missing file", () => {
      const bp = repo.createAgentBlueprint({ name: "Test" });
      expect(repo.getAgentBlueprintFile(bp.id, "nope.md")).toBeUndefined();
    });

    it("upsert ON CONFLICT updates content and hash", () => {
      const bp = repo.createAgentBlueprint({ name: "Test" });
      repo.upsertAgentBlueprintFile(bp.id, "X.md", "v1");
      const v1 = repo.getAgentBlueprintFile(bp.id, "X.md")!;

      repo.upsertAgentBlueprintFile(bp.id, "X.md", "v2");
      const v2 = repo.getAgentBlueprintFile(bp.id, "X.md")!;

      expect(v2.content).toBe("v2");
      expect(v2.content_hash).not.toBe(v1.content_hash);
    });

    it("deleteAgentBlueprintFile removes a single file", () => {
      const bp = repo.createAgentBlueprint({ name: "Test" });
      repo.upsertAgentBlueprintFile(bp.id, "A.md", "a");
      repo.upsertAgentBlueprintFile(bp.id, "B.md", "b");

      repo.deleteAgentBlueprintFile(bp.id, "A.md");
      const files = repo.listAgentBlueprintFiles(bp.id);
      expect(files).toHaveLength(1);
      expect(files[0]!.filename).toBe("B.md");
    });
  });

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe("cloneAgentBlueprint", () => {
    it("deep copies metadata and files", () => {
      const source = repo.createAgentBlueprint({
        name: "Source",
        description: "desc",
        category: "tool",
        icon: "star",
        tags: "a,b",
      });
      repo.upsertAgentBlueprintFile(source.id, "SOUL.md", "soul text");
      repo.upsertAgentBlueprintFile(source.id, "IDENTITY.md", "identity text");

      const clone = repo.cloneAgentBlueprint(source.id)!;
      expect(clone).toBeDefined();
      expect(clone.id).not.toBe(source.id);
      expect(clone.name).toBe("Source (copy)");
      expect(clone.description).toBe("desc");
      expect(clone.category).toBe("tool");

      const files = repo.listAgentBlueprintFiles(clone.id);
      expect(files).toHaveLength(2);
    });

    it("uses custom name when provided", () => {
      const source = repo.createAgentBlueprint({ name: "Original" });
      const clone = repo.cloneAgentBlueprint(source.id, "Custom Name")!;
      expect(clone.name).toBe("Custom Name");
    });

    it("returns undefined for nonexistent source", () => {
      expect(repo.cloneAgentBlueprint("nonexistent")).toBeUndefined();
    });
  });
});
