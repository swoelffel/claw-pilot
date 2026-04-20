// Smoke test for workspace-knowledge plugin (ws_list_files + ws_search_files
// + ws_write_shared_file + ws_delete_shared_file).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../../../../db/schema.js";
import { createWorkspaceKnowledgeTools } from "../tools.js";
import type Database from "better-sqlite3";
import type { Tool } from "../../../tool/tool.js";

const INSTANCE_SLUG = "test-instance";
const AGENT_ID = "pilot";

function makeCtx(): Tool.Context {
  return { agentId: AGENT_ID } as Tool.Context;
}

async function execTool(
  tools: Tool.Info[],
  id: string,
  args: Record<string, unknown>,
): Promise<Tool.Result> {
  const tool = tools.find((t) => t.id === id);
  if (!tool) throw new Error(`tool ${id} not found`);
  const def = await tool.init();
  return def.execute(args, makeCtx());
}

describe("workspace-knowledge plugin", () => {
  let db: Database.Database;
  let agentDbId: number;

  beforeAll(() => {
    db = initDatabase(":memory:");

    // Seed local server, instance and agent
    const serverRes = db
      .prepare("INSERT INTO servers (hostname, openclaw_home) VALUES (?, ?)")
      .run("localhost", "/tmp/test");
    const serverId = serverRes.lastInsertRowid as number;

    const instanceRes = db
      .prepare(
        `INSERT INTO instances (server_id, slug, port, state, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        serverId,
        INSTANCE_SLUG,
        19001,
        "stopped",
        "/tmp/config",
        "/tmp/state",
        "claw-test.service",
      );
    const instanceId = instanceRes.lastInsertRowid as number;

    const agentRes = db
      .prepare(
        `INSERT INTO agents (instance_id, agent_id, name, model, is_default, workspace_path)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(instanceId, AGENT_ID, "Pilot", "claude-opus-4", 1, "/tmp/workspace");
    agentDbId = agentRes.lastInsertRowid as number;

    // Seed workspace files: mix of excluded (SOUL, memory/) and visible ones
    const upsert = db.prepare(
      `INSERT INTO agent_files (agent_id, filename, content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    upsert.run(agentDbId, "SOUL.md", "# Soul\nidentity", "h1", "2026-01-01T00:00:00Z");
    upsert.run(agentDbId, "AGENTS.md", "# Agents\nprotocol", "h2", "2026-01-01T00:00:00Z");
    upsert.run(
      agentDbId,
      "memory/facts.md",
      "- memory fact about llama",
      "h3",
      "2026-01-01T00:00:00Z",
    );
    upsert.run(
      agentDbId,
      "notes.md",
      "# Brainstorming ClawPort\nIdeas for future evolution.\nLlama mention here.",
      "h4",
      "2026-01-02T00:00:00Z",
    );
    upsert.run(
      agentDbId,
      "projects/refactor.md",
      "# Plan: refactor tools\nSplit large modules.",
      "h5",
      "2026-01-02T00:00:00Z",
    );
    upsert.run(
      agentDbId,
      "drafts/email.md",
      "description: Draft partnership email\n\nHello,\nThe llama approach ...",
      "h6",
      "2026-01-02T00:00:00Z",
    );
  });

  afterAll(() => {
    db.close();
  });

  it("creates the four ws_* tools", () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    expect(tools).toHaveLength(4);
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      "ws_delete_shared_file",
      "ws_list_files",
      "ws_search_files",
      "ws_write_shared_file",
    ]);
  });

  it("ws_list_files excludes identity files and memory/* and includes user files", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_list_files", {});
    expect(result.output).not.toContain("SOUL.md");
    expect(result.output).not.toContain("AGENTS.md");
    expect(result.output).not.toContain("memory/facts.md");
    expect(result.output).toContain("notes.md");
    expect(result.output).toContain("projects/refactor.md");
    expect(result.output).toContain("drafts/email.md");
  });

  it("ws_list_files extracts H1 title", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_list_files", {});
    expect(result.output).toContain('"Brainstorming ClawPort"');
    expect(result.output).toContain('"Plan: refactor tools"');
  });

  it("ws_list_files extracts frontmatter description as title", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_list_files", {});
    expect(result.output).toContain('"Draft partnership email"');
  });

  it("ws_list_files scopes to subdirectory via dir arg", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_list_files", { dir: "projects" });
    expect(result.output).toContain("projects/refactor.md");
    expect(result.output).not.toContain("notes.md");
    expect(result.output).not.toContain("drafts/email.md");
  });

  it("ws_list_files returns message when agent not found in registry", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const tool = tools.find((t) => t.id === "ws_list_files")!;
    const def = await tool.init();
    const result = await def.execute({}, { agentId: "nonexistent-agent" } as Tool.Context);
    expect(result.output).toContain("Error");
  });

  it("ws_search_files finds matches across user files only", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_search_files", { query: "llama" });
    // Should match notes.md and drafts/email.md (both mention llama),
    // but NOT memory/facts.md (excluded).
    expect(result.output).toContain("notes.md");
    expect(result.output).toContain("drafts/email.md");
    expect(result.output).not.toContain("memory/facts.md");
    // Highlighted excerpt must contain the match markers
    expect(result.output).toMatch(/>>>llama<<</i);
  });

  it("ws_search_files returns no-matches message on miss", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    const result = await execTool(tools, "ws_search_files", { query: "zzzNotPresent" });
    expect(result.output).toContain("No matches");
  });

  it("ws_search_files returns readable error on invalid FTS5 syntax", async () => {
    const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
    // Unbalanced quote triggers SQLite FTS5 syntax error
    const result = await execTool(tools, "ws_search_files", { query: '"unbalanced' });
    expect(result.output.toLowerCase()).toContain("search failed");
  });

  // ---------------------------------------------------------------------------
  // Instance shared workspace (v38) — ws_* tools expose files from
  // `instance_shared_files` under the `@shared/` prefix alongside the agent
  // workspace.
  // ---------------------------------------------------------------------------
  describe("shared workspace (v38)", () => {
    beforeAll(() => {
      const instanceRow = db
        .prepare("SELECT id FROM instances WHERE slug = ?")
        .get(INSTANCE_SLUG) as { id: number };
      const upsert = db.prepare(
        `INSERT INTO instance_shared_files (instance_id, filename, content, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      upsert.run(
        instanceRow.id,
        "README.md",
        "# Instance guide\nTeam-wide reference with llama mention.",
        "sh1",
        "2026-04-20T00:00:00Z",
      );
      upsert.run(
        instanceRow.id,
        "docs/onboarding.md",
        "# Onboarding\nWelcome aboard.",
        "sh2",
        "2026-04-20T00:00:00Z",
      );
    });

    it("ws_list_files includes shared files under @shared/ prefix", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
      const result = await execTool(tools, "ws_list_files", {});
      expect(result.output).toContain("@shared/README.md");
      expect(result.output).toContain("@shared/docs/onboarding.md");
      expect(result.output).toContain("Your workspace");
      expect(result.output).toContain("Shared workspace");
    });

    it("ws_list_files scopes to shared with @shared/ prefix in dir", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
      const result = await execTool(tools, "ws_list_files", { dir: "@shared" });
      expect(result.output).toContain("@shared/README.md");
      expect(result.output).not.toContain("notes.md");
    });

    it("ws_search_files finds matches in the shared workspace", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG);
      const result = await execTool(tools, "ws_search_files", { query: "llama" });
      // Matches from both scopes should appear, shared ones prefixed with @shared/
      expect(result.output).toContain("@shared/README.md");
      expect(result.output).toContain("notes.md");
    });
  });

  // ---------------------------------------------------------------------------
  // ws_write_shared_file / ws_delete_shared_file
  // ---------------------------------------------------------------------------
  describe("write/delete shared (v38)", () => {
    let tmpWorkDir: string;

    beforeAll(() => {
      tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-shared-test-"));
    });

    afterAll(() => {
      fs.rmSync(tmpWorkDir, { recursive: true, force: true });
    });

    it("ws_write_shared_file writes to disk AND DB, then listing shows it", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG, tmpWorkDir);
      const write = await execTool(tools, "ws_write_shared_file", {
        path: "notes/handoff.md",
        content: "# Handoff\nSharing results with teammates.",
      });
      expect(write.output).toContain("Wrote @shared/notes/handoff.md");

      // Disk
      const abs = path.join(tmpWorkDir, "workspaces", "shared", "notes", "handoff.md");
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.readFileSync(abs, "utf-8")).toContain("Handoff");

      // DB — visible via ws_list_files under @shared/ prefix
      const list = await execTool(tools, "ws_list_files", {});
      expect(list.output).toContain("@shared/notes/handoff.md");
    });

    it("ws_write_shared_file rejects an invalid path", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG, tmpWorkDir);
      const r = await execTool(tools, "ws_write_shared_file", {
        path: "../escape.md",
        content: "x",
      });
      expect(r.title).toBe("shared write error");
    });

    it("ws_delete_shared_file removes from disk AND DB", async () => {
      const tools = createWorkspaceKnowledgeTools(db, INSTANCE_SLUG, tmpWorkDir);
      await execTool(tools, "ws_write_shared_file", {
        path: "to-delete.md",
        content: "bye",
      });
      const abs = path.join(tmpWorkDir, "workspaces", "shared", "to-delete.md");
      expect(fs.existsSync(abs)).toBe(true);

      const del = await execTool(tools, "ws_delete_shared_file", { path: "to-delete.md" });
      expect(del.output).toContain("Deleted @shared/to-delete.md");
      expect(fs.existsSync(abs)).toBe(false);

      const list = await execTool(tools, "ws_list_files", {});
      expect(list.output).not.toContain("@shared/to-delete.md");
    });
  });
});
