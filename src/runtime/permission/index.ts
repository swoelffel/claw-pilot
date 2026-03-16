/**
 * runtime/permission/index.ts
 *
 * Permission engine for claw-runtime.
 * Inspired by OpenCode's permission/next.ts.
 *
 * Design:
 * - Rules are evaluated in order, last-match-wins
 * - Default action when no rule matches: "ask"
 * - Supports per-instance, per-agent, and per-session rulesets
 * - Approval persistence: "once" (session) or "always" (instance)
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  PermissionRule,
  PermissionRuleset,
  PermissionAction,
  PermissionResult,
  InstanceSlug,
  SessionId,
} from "../types.js";
import { wildcardMatch } from "./wildcard.js";

export { wildcardMatch };
export type { PermissionRule, PermissionRuleset, PermissionAction, PermissionResult };

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a ruleset for a given (permission, pattern) pair.
 * Rules are evaluated in order — the LAST matching rule wins.
 * Returns "ask" if no rule matches (safe default).
 */
export function evaluateRuleset(
  ruleset: PermissionRuleset,
  permission: string,
  pattern: string,
): PermissionResult {
  let matched: PermissionRule | undefined;

  for (const rule of ruleset) {
    if (wildcardMatch(rule.permission, permission) && wildcardMatch(rule.pattern, pattern)) {
      matched = rule;
      // Don't break — last match wins
    }
  }

  if (!matched) {
    return { action: "ask" };
  }

  return { action: matched.action, matchedRule: matched };
}

// ---------------------------------------------------------------------------
// Approval persistence (in-memory, per instance)
// ---------------------------------------------------------------------------

interface ApprovalKey {
  instanceSlug: InstanceSlug;
  sessionId: SessionId | undefined;
  permission: string;
  pattern: string;
}

function approvalKeyString(key: ApprovalKey): string {
  return `${key.instanceSlug}::${key.sessionId ?? "global"}::${key.permission}::${key.pattern}`;
}

/** Instance-level persistent approvals (survive session changes) */
const _instanceApprovals = new Map<string, PermissionAction>();

/** Session-level approvals (cleared when session ends) */
const _sessionApprovals = new Map<string, PermissionAction>();

/**
 * Record a user approval decision.
 * @param persist - "always" = instance-level, "once" = session-level
 * @param db - Optional DB for persistence (only used when persist="always")
 * @param instanceSlug - Optional instance slug for DB persistence
 */
export function recordApproval(
  key: ApprovalKey,
  action: PermissionAction,
  persist: "always" | "once",
  db?: Database.Database,
  instanceSlug?: InstanceSlug,
): void {
  const k = approvalKeyString(key);
  if (persist === "always") {
    _instanceApprovals.set(k, action);
    // Persist to DB when db is provided
    if (db && instanceSlug) {
      const scope = key.sessionId ? `session:${key.sessionId}` : "instance";
      // Use DELETE + INSERT in a transaction to emulate upsert
      // (rt_permissions has no UNIQUE constraint on (instance_slug, scope, permission, pattern))
      db.transaction(() => {
        db.prepare(
          `DELETE FROM rt_permissions
           WHERE instance_slug = ? AND scope = ? AND permission = ? AND pattern = ?`,
        ).run(instanceSlug, scope, key.permission, key.pattern);
        db.prepare(
          `INSERT INTO rt_permissions (id, instance_slug, scope, permission, pattern, action, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        ).run(nanoid(), instanceSlug, scope, key.permission, key.pattern, action);
      })();
    }
  } else {
    _sessionApprovals.set(k, action);
  }
}

/**
 * Look up a previously recorded approval.
 * Instance-level takes precedence over session-level.
 * Falls back to DB when db is provided and memory cache misses.
 */
export function lookupApproval(
  key: ApprovalKey,
  db?: Database.Database,
  instanceSlug?: InstanceSlug,
): PermissionAction | undefined {
  const k = approvalKeyString(key);
  // Check memory cache first
  const memResult = _instanceApprovals.get(k) ?? _sessionApprovals.get(k);
  if (memResult !== undefined) return memResult;

  // DB fallback when db is provided
  if (db && instanceSlug) {
    const row = db
      .prepare(
        `SELECT action FROM rt_permissions
         WHERE instance_slug = ? AND permission = ? AND pattern = ?
         LIMIT 1`,
      )
      .get(instanceSlug, key.permission, key.pattern) as { action: string } | undefined;

    if (row) {
      const action = row.action as PermissionAction;
      // Repopulate memory cache
      _instanceApprovals.set(k, action);
      return action;
    }
  }

  return undefined;
}

/**
 * Clear all session-level approvals for a given session.
 * Call this when a session ends.
 */
export function clearSessionApprovals(slug: InstanceSlug, sessionId: SessionId): void {
  const prefix = `${slug}::${sessionId}::`;
  for (const key of _sessionApprovals.keys()) {
    if (key.startsWith(prefix)) {
      _sessionApprovals.delete(key);
    }
  }
}

/**
 * Clear all approvals for an instance (called on instance destroy).
 * When db is provided, also deletes rows from rt_permissions.
 */
export function clearInstanceApprovals(slug: InstanceSlug, db?: Database.Database): void {
  const prefix = `${slug}::`;
  for (const key of _instanceApprovals.keys()) {
    if (key.startsWith(prefix)) _instanceApprovals.delete(key);
  }
  for (const key of _sessionApprovals.keys()) {
    if (key.startsWith(prefix)) _sessionApprovals.delete(key);
  }
  // Delete from DB when provided
  if (db) {
    db.prepare(`DELETE FROM rt_permissions WHERE instance_slug = ?`).run(slug);
  }
}

/**
 * Load all instance-level approvals from DB into memory cache.
 * Call this at runtime startup to restore persisted approvals.
 */
export function loadInstanceApprovals(db: Database.Database, instanceSlug: InstanceSlug): void {
  const rows = db
    .prepare(`SELECT permission, pattern, action FROM rt_permissions WHERE instance_slug = ?`)
    .all(instanceSlug) as Array<{ permission: string; pattern: string; action: string }>;

  for (const row of rows) {
    const key: ApprovalKey = {
      instanceSlug,
      sessionId: undefined,
      permission: row.permission,
      pattern: row.pattern,
    };
    _instanceApprovals.set(approvalKeyString(key), row.action as PermissionAction);
  }
}

// ---------------------------------------------------------------------------
// High-level permission check
// ---------------------------------------------------------------------------

export interface PermissionCheckOptions {
  instanceSlug: InstanceSlug;
  sessionId?: SessionId | undefined;
  /** Agent-level ruleset (applied first) */
  agentRuleset?: PermissionRuleset | undefined;
  /** Session-level ruleset override (applied on top of agent ruleset) */
  sessionRuleset?: PermissionRuleset | undefined;
}

/**
 * Full permission check with approval persistence lookup.
 *
 * Resolution order:
 * 1. Check recorded approvals (instance > session)
 * 2. Evaluate session ruleset (if provided)
 * 3. Evaluate agent ruleset (if provided)
 * 4. Default: "ask"
 */
export function checkPermission(
  permission: string,
  pattern: string,
  options: PermissionCheckOptions,
): PermissionResult {
  const { instanceSlug, sessionId, agentRuleset, sessionRuleset } = options;

  // 1. Check recorded approvals
  const recorded = lookupApproval({ instanceSlug, sessionId, permission, pattern });
  if (recorded) {
    return { action: recorded };
  }

  // 2. Session ruleset (highest priority)
  if (sessionRuleset && sessionRuleset.length > 0) {
    const result = evaluateRuleset(sessionRuleset, permission, pattern);
    if (result.action !== "ask" || result.matchedRule) {
      return result;
    }
  }

  // 3. Agent ruleset
  if (agentRuleset && agentRuleset.length > 0) {
    return evaluateRuleset(agentRuleset, permission, pattern);
  }

  // 4. Default
  return { action: "ask" };
}

// ---------------------------------------------------------------------------
// Built-in rulesets for standard agent types
// ---------------------------------------------------------------------------

/** Ruleset for the "explore" agent — read-only */
export const EXPLORE_AGENT_RULESET: PermissionRuleset = [
  { permission: "read", pattern: "**", action: "allow" },
  { permission: "glob", pattern: "**", action: "allow" },
  { permission: "grep", pattern: "**", action: "allow" },
  { permission: "bash", pattern: "**", action: "ask" },
  { permission: "write", pattern: "**", action: "deny" },
  { permission: "edit", pattern: "**", action: "deny" },
  { permission: "task", pattern: "**", action: "deny" },
];

/** Ruleset for the "plan" agent — no file edits */
export const PLAN_AGENT_RULESET: PermissionRuleset = [
  { permission: "read", pattern: "**", action: "allow" },
  { permission: "glob", pattern: "**", action: "allow" },
  { permission: "grep", pattern: "**", action: "allow" },
  { permission: "write", pattern: "**", action: "deny" },
  { permission: "edit", pattern: "**", action: "deny" },
  { permission: "bash", pattern: "**", action: "ask" },
];

/** @public Ruleset for sub-agents spawned via the task tool */
export const SUBAGENT_RULESET: PermissionRuleset = [
  { permission: "task", pattern: "**", action: "deny" }, // No nested spawning by default
];

/** Ruleset for internal agents (compaction, title, summary) — no tools */
export const INTERNAL_AGENT_RULESET: PermissionRuleset = [
  { permission: "*", pattern: "**", action: "deny" },
];
