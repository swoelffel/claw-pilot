/**
 * core/__tests__/agent-repository.test.ts
 *
 * Unit tests for AgentRepository.
 * Uses tmpDir + initDatabase for real SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import { AgentRepository } from "../repositories/agent-repository.js";

let tmpDir: string;
let db: Database.Database;
let repo: AgentRepository;
let instanceId: number;
const SLUG = "test-inst";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-agent-repo-"));
  db = initDatabase(path.join(tmpDir, "test.db"));

  // Seed server + instance
  db.prepare(
    "INSERT INTO servers (id, hostname, openclaw_home) VALUES (1, 'test', '/opt/test')",
  ).run();
  const result = db
    .prepare(
      `INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
       VALUES (1, ?, 18789, '/tmp/rt.json', '/tmp/state', 'claw-test.service')`,
    )
    .run(SLUG);
  instanceId = result.lastInsertRowid as number;

  repo = new AgentRepository(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Agents CRUD
// ---------------------------------------------------------------------------

describe("AgentRepository", () => {
  describe("createAgent / listAgents", () => {
    it("creates an agent and lists it", () => {
      repo.createAgent(instanceId, {
        agentId: "agent-1",
        name: "Agent One",
        workspacePath: "/tmp/ws/agent-1",
      });
      const agents = repo.listAgents(SLUG);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.agent_id).toBe("agent-1");
      expect(agents[0]!.name).toBe("Agent One");
    });

    it("listAgents sorts by is_default DESC, agent_id ASC", () => {
      repo.createAgent(instanceId, {
        agentId: "beta",
        name: "Beta",
        workspacePath: "/tmp/ws/beta",
      });
      repo.createAgent(instanceId, {
        agentId: "alpha",
        name: "Alpha",
        workspacePath: "/tmp/ws/alpha",
        isDefault: true,
      });
      const agents = repo.listAgents(SLUG);
      expect(agents[0]!.agent_id).toBe("alpha"); // default first
      expect(agents[1]!.agent_id).toBe("beta");
    });

    it("createAgent with INSERT OR IGNORE does not fail on duplicate", () => {
      repo.createAgent(instanceId, {
        agentId: "a1",
        name: "First",
        workspacePath: "/tmp/ws/a1",
      });
      // Second insert is ignored
      repo.createAgent(instanceId, {
        agentId: "a1",
        name: "Second",
        workspacePath: "/tmp/ws/a1",
      });
      const agents = repo.listAgents(SLUG);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.name).toBe("First"); // original preserved
    });
  });

  describe("upsertAgent", () => {
    it("creates a new agent", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "New",
        workspacePath: "/tmp/ws/a1",
      });
      expect(agent.agent_id).toBe("a1");
      expect(agent.name).toBe("New");
    });

    it("updates an existing agent on conflict", () => {
      repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "V1",
        workspacePath: "/tmp/ws/a1",
      });
      const updated = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "V2",
        workspacePath: "/tmp/ws/a1-new",
      });
      expect(updated.name).toBe("V2");
      expect(updated.workspace_path).toBe("/tmp/ws/a1-new");
    });

    it("preserves position on upsert when not provided", () => {
      const a = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
        position_x: 50,
        position_y: 100,
      });
      expect(a.position_x).toBe(50);

      // Upsert without position — should COALESCE to existing
      const b = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A Updated",
        workspacePath: "/ws",
      });
      expect(b.position_x).toBe(50);
      expect(b.position_y).toBe(100);
    });
  });

  describe("getAgentByAgentId", () => {
    it("returns the agent", () => {
      repo.createAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      const agent = repo.getAgentByAgentId(instanceId, "a1");
      expect(agent).toBeDefined();
      expect(agent!.name).toBe("A");
    });

    it("returns undefined for nonexistent", () => {
      expect(repo.getAgentByAgentId(instanceId, "nope")).toBeUndefined();
    });
  });

  describe("deleteAgents", () => {
    it("deletes all agents for an instance", () => {
      repo.createAgent(instanceId, { agentId: "a1", name: "A1", workspacePath: "/ws" });
      repo.createAgent(instanceId, { agentId: "a2", name: "A2", workspacePath: "/ws" });
      repo.deleteAgents(instanceId);
      expect(repo.listAgents(SLUG)).toEqual([]);
    });
  });

  describe("deleteAgentById", () => {
    it("deletes a specific agent by DB ID", () => {
      repo.createAgent(instanceId, { agentId: "a1", name: "A1", workspacePath: "/ws" });
      repo.createAgent(instanceId, { agentId: "a2", name: "A2", workspacePath: "/ws" });
      const agent = repo.getAgentByAgentId(instanceId, "a1")!;
      repo.deleteAgentById(agent.id);
      expect(repo.getAgentByAgentId(instanceId, "a1")).toBeUndefined();
      expect(repo.listAgents(SLUG)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Update methods
  // ---------------------------------------------------------------------------

  describe("updateAgentConfig", () => {
    it("updates config_json", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentConfig(agent.id, '{"model":"gpt-4o"}');
      const updated = repo.getAgentByAgentId(instanceId, "a1")!;
      expect(updated.config_json).toBe('{"model":"gpt-4o"}');
    });
  });

  describe("updateAgentMeta", () => {
    it("updates role and tags", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentMeta(agent.id, { role: "developer", tags: "dev,test" });
      const updated = repo.getAgentByAgentId(instanceId, "a1")!;
      expect(updated.role).toBe("developer");
      expect(updated.tags).toBe("dev,test");
    });

    it("serializes skills array to JSON", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentMeta(agent.id, { skills: ["coding", "planning"] });
      const updated = repo.getAgentByAgentId(instanceId, "a1")!;
      expect(updated.skills).toBe('["coding","planning"]');
    });

    it("does nothing when no fields provided", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentMeta(agent.id, {});
      // Should not throw
      expect(repo.getAgentByAgentId(instanceId, "a1")).toBeDefined();
    });
  });

  describe("updateAgentPosition", () => {
    it("sets x/y coordinates", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentPosition(agent.id, 150, 300);
      const updated = repo.getAgentByAgentId(instanceId, "a1")!;
      expect(updated.position_x).toBe(150);
      expect(updated.position_y).toBe(300);
    });
  });

  describe("updateAgentSync", () => {
    it("sets config_hash and synced_at", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.updateAgentSync(agent.id, { configHash: "abc123", syncedAt: "2026-04-04T12:00:00Z" });
      const updated = repo.getAgentByAgentId(instanceId, "a1")!;
      expect(updated.config_hash).toBe("abc123");
      expect(updated.synced_at).toBe("2026-04-04T12:00:00Z");
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Files
  // ---------------------------------------------------------------------------

  describe("agent files", () => {
    it("upserts and lists files", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.upsertAgentFile(agent.id, {
        filename: "SOUL.md",
        content: "soul content",
        contentHash: "h1",
      });
      repo.upsertAgentFile(agent.id, {
        filename: "IDENTITY.md",
        content: "identity",
        contentHash: "h2",
      });

      const files = repo.listAgentFiles(agent.id);
      expect(files).toHaveLength(2);
    });

    it("getAgentFileContent returns the file", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.upsertAgentFile(agent.id, {
        filename: "README.md",
        content: "hello",
        contentHash: "h1",
      });
      const file = repo.getAgentFileContent(agent.id, "README.md");
      expect(file).toBeDefined();
      expect(file!.content).toBe("hello");
    });

    it("getAgentFileContent returns undefined for missing file", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      expect(repo.getAgentFileContent(agent.id, "nope.md")).toBeUndefined();
    });

    it("upsert replaces existing file (INSERT OR REPLACE)", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.upsertAgentFile(agent.id, { filename: "X.md", content: "v1", contentHash: "h1" });
      repo.upsertAgentFile(agent.id, { filename: "X.md", content: "v2", contentHash: "h2" });
      const file = repo.getAgentFileContent(agent.id, "X.md")!;
      expect(file.content).toBe("v2");
      expect(file.content_hash).toBe("h2");
    });

    it("deleteAgentFile removes a single file", () => {
      const agent = repo.upsertAgent(instanceId, {
        agentId: "a1",
        name: "A",
        workspacePath: "/ws",
      });
      repo.upsertAgentFile(agent.id, { filename: "A.md", content: "a", contentHash: "h1" });
      repo.upsertAgentFile(agent.id, { filename: "B.md", content: "b", contentHash: "h2" });
      repo.deleteAgentFile(agent.id, "A.md");
      expect(repo.listAgentFiles(agent.id)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Links
  // ---------------------------------------------------------------------------

  describe("agent links", () => {
    it("replaceAgentLinks sets links in a transaction", () => {
      repo.createAgent(instanceId, { agentId: "a1", name: "A1", workspacePath: "/ws" });
      repo.createAgent(instanceId, { agentId: "a2", name: "A2", workspacePath: "/ws" });

      repo.replaceAgentLinks(instanceId, [
        { sourceAgentId: "a1", targetAgentId: "a2", linkType: "spawn" },
      ]);

      const links = repo.listAgentLinks(instanceId);
      expect(links).toHaveLength(1);
      expect(links[0]!.source_agent_id).toBe("a1");
      expect(links[0]!.link_type).toBe("spawn");
    });

    it("replaceAgentLinks replaces all existing links", () => {
      repo.replaceAgentLinks(instanceId, [
        { sourceAgentId: "a1", targetAgentId: "a2", linkType: "spawn" },
      ]);
      repo.replaceAgentLinks(instanceId, [
        { sourceAgentId: "a2", targetAgentId: "a1", linkType: "a2a" },
      ]);

      const links = repo.listAgentLinks(instanceId);
      expect(links).toHaveLength(1);
      expect(links[0]!.link_type).toBe("a2a");
    });

    it("listAgentLinks returns empty when no links", () => {
      expect(repo.listAgentLinks(instanceId)).toEqual([]);
    });
  });
});
