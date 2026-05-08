// src/runtime/plugin/workspace-knowledge/__tests__/_scope.test.ts
//
// Unit coverage for the WS-WRITE-001 scope helpers.
//
// Focus areas:
//   - core protected paths are always blocked (no override possible)
//   - admin custom globs extend, never replace, the core list
//   - allowed-path whitelist semantics (null = open, [] = open, list = match)
//   - glob bypass attempts (S?UL.md, capitalization, dotfiles)
//   - quota CAS atomicity, window reset, unlimited mode

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../../db/schema.js";
import { CORE_PROTECTED_GLOBS } from "../_protected-paths.js";
import {
  isProtectedPath,
  matchesAnyGlob,
  checkAllowedPath,
  resolveAgentScope,
  maybeResetQuota,
  tryConsumeQuota,
} from "../_scope.js";

const INSTANCE_SLUG = "test-scope";
const AGENT_ID = "alpha";

function seedAgent(db: Database.Database): number {
  const serverRes = db
    .prepare("INSERT INTO servers (hostname, openclaw_home) VALUES (?, ?)")
    .run("localhost", "/tmp/x");
  const serverId = serverRes.lastInsertRowid as number;
  const insRes = db
    .prepare(
      `INSERT INTO instances (server_id, slug, port, state, config_path, state_dir, systemd_unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(serverId, INSTANCE_SLUG, 19500, "stopped", "/tmp/c", "/tmp/s", "x.service");
  const instanceId = insRes.lastInsertRowid as number;
  const ag = db
    .prepare(
      `INSERT INTO agents (instance_id, agent_id, name, model, is_default, workspace_path)
         VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(instanceId, AGENT_ID, "Alpha", "claude-x", "/tmp/ws");
  return ag.lastInsertRowid as number;
}

describe("CORE_PROTECTED_GLOBS contains the identity files", () => {
  it("includes SOUL.md, IDENTITY.md, AGENTS.md", () => {
    expect(CORE_PROTECTED_GLOBS).toContain("SOUL.md");
    expect(CORE_PROTECTED_GLOBS).toContain("IDENTITY.md");
    expect(CORE_PROTECTED_GLOBS).toContain("AGENTS.md");
  });
});

describe("isProtectedPath", () => {
  it("blocks every core protected path even with empty custom list", () => {
    expect(isProtectedPath("SOUL.md", [])).toBe(true);
    expect(isProtectedPath("IDENTITY.md", [])).toBe(true);
    expect(isProtectedPath("AGENTS.md", [])).toBe(true);
  });

  it("does NOT match similar-but-different filenames", () => {
    // Exact-glob expectations: 'soul.md' (lowercase) is NOT protected because
    // the CORE list uses uppercase and our matcher is case-sensitive by design.
    expect(isProtectedPath("soul.md", [])).toBe(false);
    expect(isProtectedPath("notes/SOUL.md", [])).toBe(false); // path-scoped
  });

  it("rejects glob bypass attempts via single-char wildcard", () => {
    // Attacker tries to upload a custom glob that "looks safe" but the file
    // they target is the core SOUL.md. Custom globs cannot weaken the core
    // list — the core check fires first.
    expect(isProtectedPath("SOUL.md", ["S?UL.md"])).toBe(true);
  });

  it("layers custom globs on top of the core list", () => {
    expect(isProtectedPath("secrets/api-keys.json", ["secrets/**"])).toBe(true);
    expect(isProtectedPath("secrets/api-keys.json", [])).toBe(false);
  });

  it("supports nested glob patterns", () => {
    expect(isProtectedPath("a/b/c/x.md", ["a/**/x.md"])).toBe(true);
    expect(isProtectedPath("a/b/c/y.md", ["a/**/x.md"])).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("returns false on an empty glob list", () => {
    expect(matchesAnyGlob("anything.md", [])).toBe(false);
  });

  it("matches first-hit semantics", () => {
    expect(matchesAnyGlob("foo.md", ["bar.md", "*.md"])).toBe(true);
  });
});

describe("checkAllowedPath", () => {
  it("returns true when whitelist is null (no whitelist)", () => {
    expect(checkAllowedPath("anywhere.md", null)).toBe(true);
  });

  it("returns true when whitelist is empty (admin cleared)", () => {
    expect(checkAllowedPath("anywhere.md", [])).toBe(true);
  });

  it("enforces matches when whitelist is non-empty", () => {
    expect(checkAllowedPath("notes/x.md", ["notes/**"])).toBe(true);
    expect(checkAllowedPath("drafts/x.md", ["notes/**"])).toBe(false);
  });
});

describe("resolveAgentScope", () => {
  let db: Database.Database;
  let agentDbId: number;

  beforeEach(() => {
    db = initDatabase(":memory:");
    agentDbId = seedAgent(db);
  });

  it("returns scope=none for a freshly migrated agent", () => {
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID);
    expect(perms).not.toBeNull();
    expect(perms!.scope).toBe("none");
    expect(perms!.protectedPaths).toEqual([]);
    expect(perms!.allowedPaths).toBeNull();
    expect(perms!.writeQuotaMb).toBeNull();
  });

  it("returns null for an unknown agent", () => {
    expect(resolveAgentScope(db, INSTANCE_SLUG, "unknown")).toBeNull();
  });

  it("parses the scope and the JSON glob lists", () => {
    db.prepare(
      `UPDATE agents SET fs_write_scope = 'own',
                          protected_paths_json = ?,
                          allowed_paths_json = ?
                    WHERE id = ?`,
    ).run(JSON.stringify(["secrets/**"]), JSON.stringify(["notes/**"]), agentDbId);

    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(perms.scope).toBe("own");
    expect(perms.protectedPaths).toEqual(["secrets/**"]);
    expect(perms.allowedPaths).toEqual(["notes/**"]);
  });

  it("treats malformed JSON as empty (no crash)", () => {
    db.prepare("UPDATE agents SET protected_paths_json = ? WHERE id = ?").run(
      "not-json",
      agentDbId,
    );
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(perms.protectedPaths).toEqual([]);
  });
});

describe("quota CAS", () => {
  let db: Database.Database;
  let agentDbId: number;

  beforeEach(() => {
    db = initDatabase(":memory:");
    agentDbId = seedAgent(db);
    db.prepare(
      `UPDATE agents SET fs_write_scope = 'own',
                          write_quota_mb = 1,
                          quota_reset_period = 'daily'
                    WHERE id = ?`,
    ).run(agentDbId);
  });

  it("tryConsumeQuota succeeds while under cap and refuses past it", () => {
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(tryConsumeQuota(db, perms, 500_000)).toBe(true);

    const fresh = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(fresh.bytesWrittenPeriod).toBe(500_000);

    // 600_000 + 500_000 = 1_100_000 > 1 MB cap → refused
    expect(tryConsumeQuota(db, fresh, 600_000)).toBe(false);

    const after = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(after.bytesWrittenPeriod).toBe(500_000);
  });

  it("tryConsumeQuota always succeeds when writeQuotaMb is null", () => {
    db.prepare("UPDATE agents SET write_quota_mb = NULL WHERE id = ?").run(agentDbId);
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(tryConsumeQuota(db, perms, 10 * 1024 * 1024)).toBe(true);
  });

  it("maybeResetQuota wipes the counter when the daily window has elapsed", () => {
    db.prepare(
      `UPDATE agents SET bytes_written_period = 999_999,
                          quota_period_started_at = '2020-01-01T00:00:00Z'
                    WHERE id = ?`,
    ).run(agentDbId);
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    const newCounter = maybeResetQuota(db, perms);
    expect(newCounter).toBe(0);

    const after = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(after.bytesWrittenPeriod).toBe(0);
  });

  it("maybeResetQuota leaves the counter alone when the window is still open", () => {
    const recentIso = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      `UPDATE agents SET bytes_written_period = 123,
                          quota_period_started_at = ?
                    WHERE id = ?`,
    ).run(recentIso, agentDbId);
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(maybeResetQuota(db, perms)).toBe(123);
  });

  it("maybeResetQuota is a no-op when quotaResetPeriod is 'never'", () => {
    db.prepare(
      `UPDATE agents SET bytes_written_period = 7,
                          quota_period_started_at = '2020-01-01T00:00:00Z',
                          quota_reset_period = 'never'
                    WHERE id = ?`,
    ).run(agentDbId);
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(maybeResetQuota(db, perms)).toBe(7);
  });

  it("CAS is atomic under simulated parallel calls (no overshoot)", () => {
    // We simulate by reading perms once and calling tryConsumeQuota repeatedly
    // with stale knowledge. Even though every call uses the same `perms`
    // snapshot, the SQL-side CAS ensures we never exceed the cap.
    const perms = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    const cap = 1024 * 1024;
    const chunk = 200_000;

    let successes = 0;
    for (let i = 0; i < 10; i++) {
      if (tryConsumeQuota(db, perms, chunk)) successes++;
    }

    const after = resolveAgentScope(db, INSTANCE_SLUG, AGENT_ID)!;
    expect(after.bytesWrittenPeriod).toBeLessThanOrEqual(cap);
    expect(after.bytesWrittenPeriod).toBe(successes * chunk);
  });
});
