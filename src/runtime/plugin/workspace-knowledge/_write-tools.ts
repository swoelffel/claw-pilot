// src/runtime/plugin/workspace-knowledge/_write-tools.ts
//
// Implementation of `ws_write_file` and `ws_delete_file` — the two tools
// gated by the `own` scope (and above) of WS-WRITE-001.
//
// All gating logic lives here:
//   1. workspace-relative path validation
//   2. core + custom protected-path refusal
//   3. allowed-path whitelist enforcement (when configured)
//   4. content size cap (1 MB)
//   5. atomic per-period byte quota CAS
//   6. disk write + `agent_files` upsert
//   7. audit event emission for every attempt (ok or blocked)

import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { Tool } from "../../tool/tool.js";
import { logger } from "../../../lib/logger.js";
import {
  validateWorkspaceRelativePath,
  InvalidWorkspacePathError,
} from "../../../lib/workspace-path.js";
import { emitAudit } from "../../../core/audit/index.js";
import type { InstanceSlug } from "../../types.js";
import {
  resolveAgentScope,
  isProtectedPath,
  checkAllowedPath,
  maybeResetQuota,
  tryConsumeQuota,
  type AgentWritePermissions,
} from "./_scope.js";

const MAX_BYTES = 1_048_576; // 1 MB

type BlockReason =
  | "protected_path"
  | "outside_allowed"
  | "too_large"
  | "quota"
  | "scope_disabled"
  | "invalid_path";

interface AuditPayload {
  agentId: string;
  instanceSlug: string;
  path: string;
  bytesWritten: number;
  outcome: "ok" | "blocked";
  reason?: BlockReason;
}

function audit(p: AuditPayload): void {
  emitAudit({
    kind: "agent.workspace_write",
    agentId: p.agentId,
    instanceSlug: p.instanceSlug,
    path: p.path,
    bytesWritten: p.bytesWritten,
    outcome: p.outcome,
    ...(p.reason !== undefined ? { reason: p.reason } : {}),
  });
}

function block(
  agentId: string,
  instanceSlug: string,
  relPath: string,
  reason: BlockReason,
  message: string,
  title: string,
): { title: string; output: string; truncated: boolean } {
  audit({
    agentId,
    instanceSlug,
    path: relPath,
    bytesWritten: 0,
    outcome: "blocked",
    reason,
  });
  return { title, output: message, truncated: false };
}

interface WriteContext {
  perms: AgentWritePermissions;
  workspacePath: string;
}

function resolveWriteContext(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
): WriteContext | null {
  const perms = resolveAgentScope(db, instanceSlug, agentId);
  if (!perms) return null;
  const row = db.prepare(`SELECT workspace_path FROM agents WHERE id = ?`).get(perms.agentDbId) as
    | { workspace_path: string }
    | undefined;
  if (!row) return null;
  return { perms, workspacePath: row.workspace_path };
}

function upsertAgentFileRow(
  db: Database.Database,
  agentDbId: number,
  filename: string,
  content: string,
): void {
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  db.prepare(
    `INSERT OR REPLACE INTO agent_files (agent_id, filename, content, content_hash, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(agentDbId, filename, content, hash);
}

// ---------------------------------------------------------------------------
// ws_write_file
// ---------------------------------------------------------------------------

export function createWriteOwnTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_write_file", {
    description:
      "Create or overwrite a file in your own agent workspace. " +
      "Path must be workspace-relative (e.g. 'notes/today.md'). " +
      "Identity files (SOUL.md, IDENTITY.md, AGENTS.md) and any glob in your " +
      "agent's protected-paths list are refused. If an allowed-paths whitelist " +
      "is configured, the path must match at least one of its globs. " +
      "Allowed extensions: .md, .txt, .json, .yaml, .yml, .csv, .log. " +
      "Maximum 1 MB per file. A per-agent byte quota may further restrict writes.",
    parameters: z.object({
      path: z.string().min(1).describe("Workspace-relative path"),
      content: z.string().describe("Full file content (UTF-8). Max 1 MB."),
    }),
    async execute(args, ctx) {
      const agentId = ctx.agentId;

      // 1. Path validation
      let relPath: string;
      try {
        relPath = validateWorkspaceRelativePath(args.path);
      } catch (err) {
        const message =
          err instanceof InvalidWorkspacePathError
            ? `Invalid path: ${err.reason}`
            : `Invalid path: ${err instanceof Error ? err.message : String(err)}`;
        return block(agentId, instanceSlug, args.path, "invalid_path", message, "write error");
      }

      // 2. Resolve scope + workspace path
      const writeCtx = resolveWriteContext(db, instanceSlug, agentId);
      if (!writeCtx) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "scope_disabled",
          "Agent not found in registry.",
          "write error",
        );
      }

      // Defensive: tool should not be exposed when scope is `none`, but a
      // stale reference in a long-running session could still call it.
      if (writeCtx.perms.scope === "none") {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "scope_disabled",
          "This agent's write scope is disabled. Ask the operator to grant 'own' scope.",
          "write error",
        );
      }

      // 3. Protected paths
      if (isProtectedPath(relPath, writeCtx.perms.protectedPaths)) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "protected_path",
          `Refused: "${relPath}" is a protected path and cannot be modified.`,
          "write blocked",
        );
      }

      // 4. Allowed-path whitelist
      if (!checkAllowedPath(relPath, writeCtx.perms.allowedPaths)) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "outside_allowed",
          `Refused: "${relPath}" is outside the configured allowed-paths whitelist.`,
          "write blocked",
        );
      }

      // 5. Size cap
      const bytes = Buffer.byteLength(args.content, "utf8");
      if (bytes > MAX_BYTES) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "too_large",
          `Refused: content is ${bytes} bytes; the per-file limit is ${MAX_BYTES} bytes (1 MB).`,
          "write blocked",
        );
      }

      // 6. Quota CAS (after a possible period reset)
      maybeResetQuota(db, writeCtx.perms);
      if (!tryConsumeQuota(db, writeCtx.perms, bytes)) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "quota",
          `Refused: per-period write quota exceeded.`,
          "write blocked",
        );
      }

      // 7. Disk write + DB upsert
      const filePath = path.join(writeCtx.workspacePath, relPath);
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, "utf8");
      } catch (err) {
        logger.warn("[ws_write_file] disk write failed", { error: String(err), filePath });
        return {
          title: "write error",
          output: `Disk write failed: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }
      try {
        upsertAgentFileRow(db, writeCtx.perms.agentDbId, relPath, args.content);
      } catch (err) {
        logger.warn("[ws_write_file] DB upsert failed", { error: String(err) });
        return {
          title: "write error",
          output: `DB upsert failed: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }

      audit({
        agentId,
        instanceSlug,
        path: relPath,
        bytesWritten: bytes,
        outcome: "ok",
      });
      return {
        title: "write ok",
        output: `Wrote ${relPath} (${bytes} bytes).`,
        truncated: false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// ws_delete_file
// ---------------------------------------------------------------------------

export function createDeleteOwnTool(db: Database.Database, instanceSlug: InstanceSlug): Tool.Info {
  return Tool.define("ws_delete_file", {
    description:
      "Delete a file from your own agent workspace. Identity files " +
      "(SOUL.md, IDENTITY.md, AGENTS.md) and any glob in your protected-paths " +
      "list are refused. The allowed-paths whitelist also applies.",
    parameters: z.object({
      path: z.string().min(1).describe("Workspace-relative path"),
    }),
    async execute(args, ctx) {
      const agentId = ctx.agentId;

      let relPath: string;
      try {
        relPath = validateWorkspaceRelativePath(args.path);
      } catch (err) {
        const message =
          err instanceof InvalidWorkspacePathError
            ? `Invalid path: ${err.reason}`
            : `Invalid path: ${err instanceof Error ? err.message : String(err)}`;
        return block(agentId, instanceSlug, args.path, "invalid_path", message, "delete error");
      }

      const writeCtx = resolveWriteContext(db, instanceSlug, agentId);
      if (!writeCtx) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "scope_disabled",
          "Agent not found in registry.",
          "delete error",
        );
      }
      if (writeCtx.perms.scope === "none") {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "scope_disabled",
          "This agent's write scope is disabled.",
          "delete error",
        );
      }
      if (isProtectedPath(relPath, writeCtx.perms.protectedPaths)) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "protected_path",
          `Refused: "${relPath}" is a protected path and cannot be deleted.`,
          "delete blocked",
        );
      }
      if (!checkAllowedPath(relPath, writeCtx.perms.allowedPaths)) {
        return block(
          agentId,
          instanceSlug,
          relPath,
          "outside_allowed",
          `Refused: "${relPath}" is outside the configured allowed-paths whitelist.`,
          "delete blocked",
        );
      }

      const filePath = path.join(writeCtx.workspacePath, relPath);
      try {
        await fs.rm(filePath, { force: true });
      } catch (err) {
        logger.debug("[ws_delete_file] disk remove failed (non-fatal)", {
          error: String(err),
          filePath,
        });
      }

      const res = db
        .prepare(`DELETE FROM agent_files WHERE agent_id = ? AND filename = ?`)
        .run(writeCtx.perms.agentDbId, relPath);

      audit({
        agentId,
        instanceSlug,
        path: relPath,
        bytesWritten: 0,
        outcome: "ok",
      });
      return {
        title: "delete ok",
        output:
          res.changes > 0 ? `Deleted ${relPath}.` : `${relPath} did not exist (nothing to delete).`,
        truncated: false,
      };
    },
  });
}
