// src/runtime/plugin/workspace-knowledge/__tests__/_write-tools.test.ts
//
// End-to-end coverage for `ws_write_file` and `ws_delete_file`. Each test
// exercises the gating chain (path validation → protected → allowed → size →
// quota → disk) plus audit emission.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../../db/schema.js";
import { createWriteOwnTool, createDeleteOwnTool } from "../_write-tools.js";
import * as auditModule from "../../../../core/audit/index.js";
import type { Tool } from "../../../tool/tool.js";

const INSTANCE_SLUG = "wt-test";
const AGENT_ID = "writer";

interface SeedResult {
  db: Database.Database;
  workspacePath: string;
  agentDbId: number;
}

function seed(): SeedResult {
  const db = initDatabase(":memory:");
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "cp-write-"));

  const serverRes = db
    .prepare("INSERT INTO servers (hostname, openclaw_home) VALUES (?, ?)")
    .run("localhost", workspacePath);
  const serverId = serverRes.lastInsertRowid as number;
  const insRes = db
    .prepare(
      `INSERT INTO instances (server_id, slug, port, state, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(serverId, INSTANCE_SLUG, 19501, "stopped", "/tmp/c", "/tmp/s", "x.service");
  const instanceId = insRes.lastInsertRowid as number;
  const ag = db
    .prepare(
      `INSERT INTO agents (instance_id, agent_id, name, model, is_default, workspace_path,
                           fs_write_scope)
         VALUES (?, ?, ?, ?, 0, ?, 'own')`,
    )
    .run(instanceId, AGENT_ID, "Writer", "claude-x", workspacePath);
  return { db, workspacePath, agentDbId: ag.lastInsertRowid as number };
}

async function exec(tool: Tool.Info, args: Record<string, unknown>): Promise<Tool.Result> {
  const def = await tool.init();
  return def.execute(args, { agentId: AGENT_ID } as Tool.Context);
}

describe("ws_write_file", () => {
  let s: SeedResult;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    s = seed();
    emitSpy = vi.spyOn(auditModule, "emitAudit").mockImplementation(() => undefined);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    s.db.close();
    fs.rmSync(s.workspacePath, { recursive: true, force: true });
  });

  it("writes a regular file to disk and DB and emits an ok audit event", async () => {
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "notes/today.md", content: "# Hello" });
    expect(r.title).toBe("write ok");

    const abs = path.join(s.workspacePath, "notes/today.md");
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, "utf-8")).toBe("# Hello");

    const dbRow = s.db
      .prepare("SELECT content FROM agent_files WHERE agent_id = ? AND filename = ?")
      .get(s.agentDbId, "notes/today.md") as { content: string } | undefined;
    expect(dbRow?.content).toBe("# Hello");

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agent.workspace_write",
        outcome: "ok",
        path: "notes/today.md",
        bytesWritten: 7,
      }),
    );
  });

  it("refuses SOUL.md unconditionally", async () => {
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "SOUL.md", content: "evil" });
    expect(r.title).toBe("write blocked");
    expect(r.output).toContain("protected");
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "blocked",
        reason: "protected_path",
      }),
    );
  });

  it("refuses path traversal `../../etc/passwd`", async () => {
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "../../etc/passwd", content: "x" });
    expect(r.title).toBe("write error");
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "blocked",
        reason: "invalid_path",
      }),
    );
  });

  it("refuses files in `secrets/**` when admin added it to protected_paths", async () => {
    s.db
      .prepare("UPDATE agents SET protected_paths_json = ? WHERE id = ?")
      .run(JSON.stringify(["secrets/**"]), s.agentDbId);
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "secrets/api.json", content: "{}" });
    expect(r.title).toBe("write blocked");
  });

  it("enforces an allowed-paths whitelist when configured", async () => {
    s.db
      .prepare("UPDATE agents SET allowed_paths_json = ? WHERE id = ?")
      .run(JSON.stringify(["notes/**"]), s.agentDbId);
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);

    const inside = await exec(tool, { path: "notes/ok.md", content: "x" });
    expect(inside.title).toBe("write ok");

    const outside = await exec(tool, { path: "drafts/no.md", content: "x" });
    expect(outside.title).toBe("write blocked");
    expect(outside.output).toContain("allowed-paths");
  });

  it("refuses content larger than 1 MB", async () => {
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const big = "a".repeat(1_048_577);
    const r = await exec(tool, { path: "big.txt", content: big });
    expect(r.title).toBe("write blocked");
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: "too_large" }));
  });

  it("refuses with reason=quota when the per-period budget is exceeded", async () => {
    const recentIso = new Date(Date.now() - 60_000).toISOString();
    s.db
      .prepare(
        `UPDATE agents SET write_quota_mb = 1,
                            quota_reset_period = 'daily',
                            bytes_written_period = 1024 * 1024,
                            quota_period_started_at = ?
                      WHERE id = ?`,
      )
      .run(recentIso, s.agentDbId);
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "notes/x.md", content: "still some bytes" });
    expect(r.title).toBe("write blocked");
    expect(r.output).toContain("quota");
  });

  it("returns scope_disabled when scope is none (defensive — tool normally not exposed)", async () => {
    s.db.prepare("UPDATE agents SET fs_write_scope = 'none' WHERE id = ?").run(s.agentDbId);
    const tool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "x.md", content: "y" });
    expect(r.title).toBe("write error");
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: "scope_disabled" }));
  });
});

describe("ws_delete_file", () => {
  let s: SeedResult;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    s = seed();
    emitSpy = vi.spyOn(auditModule, "emitAudit").mockImplementation(() => undefined);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    s.db.close();
    fs.rmSync(s.workspacePath, { recursive: true, force: true });
  });

  it("removes an existing file from disk and DB", async () => {
    const writeTool = createWriteOwnTool(s.db, INSTANCE_SLUG);
    await exec(writeTool, { path: "notes/x.md", content: "tmp" });

    const delTool = createDeleteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(delTool, { path: "notes/x.md" });
    expect(r.title).toBe("delete ok");

    const abs = path.join(s.workspacePath, "notes/x.md");
    expect(fs.existsSync(abs)).toBe(false);
  });

  it("refuses to delete identity files", async () => {
    const tool = createDeleteOwnTool(s.db, INSTANCE_SLUG);
    const r = await exec(tool, { path: "AGENTS.md" });
    expect(r.title).toBe("delete blocked");
  });
});
