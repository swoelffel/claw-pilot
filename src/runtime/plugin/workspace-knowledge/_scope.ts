// src/runtime/plugin/workspace-knowledge/_scope.ts
//
// Helpers used by `ws_write_file` / `ws_delete_file` to resolve the agent's
// write scope, evaluate path globs (protected + allowed lists), and enforce
// the optional bytes-per-period quota.
//
// All helpers are pure (no I/O) except `resolveAgentScope` and the quota
// helpers, which run a single SQL statement each. The quota check is
// implemented as an atomic SQL compare-and-swap so concurrent writes cannot
// race past the limit.

import type Database from "better-sqlite3";
import picomatch from "picomatch";
import { logger } from "../../../lib/logger.js";
import { CORE_PROTECTED_GLOBS } from "./_protected-paths.js";

/** Linear scope ladder — each level grants strictly more capabilities. */
export type WriteScope = "none" | "own" | "own_shared" | "system";

const VALID_SCOPES: ReadonlySet<WriteScope> = new Set(["none", "own", "own_shared", "system"]);

/** Quota reset cadence. `null` means no quota configured. */
export type QuotaResetPeriod = "daily" | "weekly" | "never";

/** Fully-resolved permission profile for a single agent. */
export interface AgentWritePermissions {
  /** Internal `agents.id`. Required for quota CAS and audit correlation. */
  agentDbId: number;
  scope: WriteScope;
  /** Custom globs layered on top of CORE_PROTECTED_GLOBS. Never empty when stored. */
  protectedPaths: string[];
  /** Whitelist globs — when present, paths MUST match at least one. */
  allowedPaths: string[] | null;
  /** Per-period byte budget. `null` means unlimited. */
  writeQuotaMb: number | null;
  quotaResetPeriod: QuotaResetPeriod | null;
  bytesWrittenPeriod: number;
  quotaPeriodStartedAt: string | null;
}

interface AgentRow {
  id: number;
  fs_write_scope: string;
  protected_paths_json: string | null;
  allowed_paths_json: string | null;
  write_quota_mb: number | null;
  quota_reset_period: string | null;
  bytes_written_period: number;
  quota_period_started_at: string | null;
}

/**
 * Resolve `(instanceSlug, agentId)` to the agent's full write-permission
 * profile. Returns `null` when the agent does not exist in the registry.
 */
export function resolveAgentScope(
  db: Database.Database,
  instanceSlug: string,
  agentId: string,
): AgentWritePermissions | null {
  const row = db
    .prepare(
      `SELECT a.id, a.fs_write_scope, a.protected_paths_json, a.allowed_paths_json,
              a.write_quota_mb, a.quota_reset_period, a.bytes_written_period,
              a.quota_period_started_at
         FROM agents a
         JOIN instances i ON i.id = a.instance_id
        WHERE i.slug = ? AND a.agent_id = ?`,
    )
    .get(instanceSlug, agentId) as AgentRow | undefined;
  if (!row) return null;

  const scope: WriteScope = VALID_SCOPES.has(row.fs_write_scope as WriteScope)
    ? (row.fs_write_scope as WriteScope)
    : "none";

  return {
    agentDbId: row.id,
    scope,
    protectedPaths: parseGlobList(row.protected_paths_json),
    allowedPaths: parseGlobListOrNull(row.allowed_paths_json),
    writeQuotaMb: row.write_quota_mb,
    quotaResetPeriod: VALID_PERIODS.has(row.quota_reset_period as QuotaResetPeriod)
      ? (row.quota_reset_period as QuotaResetPeriod)
      : null,
    bytesWrittenPeriod: row.bytes_written_period,
    quotaPeriodStartedAt: row.quota_period_started_at,
  };
}

const VALID_PERIODS: ReadonlySet<QuotaResetPeriod> = new Set(["daily", "weekly", "never"]);

function parseGlobList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
    return [];
  } catch (err) {
    logger.warn("[ws-scope] malformed glob list JSON, treating as empty", { error: String(err) });
    return [];
  }
}

function parseGlobListOrNull(json: string | null): string[] | null {
  if (!json) return null;
  return parseGlobList(json);
}

/** Pure: returns true when `relPath` matches at least one glob in `globs`. */
export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  for (const g of globs) {
    if (picomatch.isMatch(relPath, g, { dot: true, nocase: false })) return true;
  }
  return false;
}

/**
 * True when `relPath` is protected — either by a hardcoded core glob or by an
 * admin-managed custom glob. The two lists are layered: custom globs extend,
 * never replace, the core list.
 */
export function isProtectedPath(relPath: string, customGlobs: readonly string[]): boolean {
  if (matchesAnyGlob(relPath, CORE_PROTECTED_GLOBS)) return true;
  return matchesAnyGlob(relPath, customGlobs);
}

/**
 * Check that `relPath` passes the optional whitelist. When `whitelist` is
 * `null` (no whitelist configured), every path is allowed. Otherwise the path
 * must match at least one glob.
 */
export function checkAllowedPath(relPath: string, whitelist: readonly string[] | null): boolean {
  if (whitelist === null) return true;
  if (whitelist.length === 0) return true; // empty array == no whitelist (admin cleared it)
  return matchesAnyGlob(relPath, whitelist);
}

// ---------------------------------------------------------------------------
// Quota — atomic CAS with rolling-window reset
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Returns the elapsed period in ms after which the quota must reset, or null
 * when the period is `"never"` (no auto-reset).
 */
function periodWindowMs(period: QuotaResetPeriod): number | null {
  if (period === "daily") return MS_PER_DAY;
  if (period === "weekly") return MS_PER_WEEK;
  return null;
}

/**
 * Reset the quota counters when the configured period has elapsed since
 * `quota_period_started_at`. Idempotent: safe to call before every write.
 *
 * Returns the (possibly refreshed) `bytesWrittenPeriod` for the agent — the
 * caller passes it to `tryConsumeQuota` as the value the CAS must match.
 */
export function maybeResetQuota(
  db: Database.Database,
  perms: AgentWritePermissions,
  nowMs: number = Date.now(),
): number {
  if (perms.writeQuotaMb === null) return perms.bytesWrittenPeriod;
  if (perms.quotaResetPeriod === null) return perms.bytesWrittenPeriod;
  const window = periodWindowMs(perms.quotaResetPeriod);
  if (window === null) return perms.bytesWrittenPeriod; // "never"

  const startedAt = perms.quotaPeriodStartedAt ? Date.parse(perms.quotaPeriodStartedAt) : null;
  if (startedAt === null || Number.isNaN(startedAt) || nowMs - startedAt >= window) {
    db.prepare(
      `UPDATE agents
          SET bytes_written_period = 0,
              quota_period_started_at = datetime('now')
        WHERE id = ?`,
    ).run(perms.agentDbId);
    return 0;
  }
  return perms.bytesWrittenPeriod;
}

/**
 * Atomic CAS: increment `bytes_written_period` by `bytes` if and only if the
 * resulting total still fits within the configured quota. Returns true when
 * the increment succeeded, false when the quota would be exceeded.
 *
 * When `writeQuotaMb` is null, the call is a no-op success (no quota).
 */
export function tryConsumeQuota(
  db: Database.Database,
  perms: AgentWritePermissions,
  bytes: number,
): boolean {
  if (perms.writeQuotaMb === null) return true;
  const cap = perms.writeQuotaMb * 1024 * 1024;
  const res = db
    .prepare(
      `UPDATE agents
          SET bytes_written_period = bytes_written_period + ?,
              quota_period_started_at = COALESCE(quota_period_started_at, datetime('now'))
        WHERE id = ?
          AND bytes_written_period + ? <= ?`,
    )
    .run(bytes, perms.agentDbId, bytes, cap);
  return res.changes > 0;
}
