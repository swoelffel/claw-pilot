import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  evaluateRuleset,
  checkPermission,
  recordApproval,
  lookupApproval,
  clearSessionApprovals,
  clearInstanceApprovals,
  loadInstanceApprovals,
  EXPLORE_AGENT_RULESET,
  PLAN_AGENT_RULESET,
  INTERNAL_AGENT_RULESET,
} from "../permission/index.js";
import { wildcardMatch } from "../permission/wildcard.js";
import { initDatabase } from "../../db/schema.js";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Wildcard matching
// ---------------------------------------------------------------------------

describe("wildcardMatch", () => {
  it("exact match", () => {
    expect(wildcardMatch("bash", "bash")).toBe(true);
    expect(wildcardMatch("bash", "read")).toBe(false);
  });

  it("* matches any non-slash segment", () => {
    expect(wildcardMatch("*.ts", "foo.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "foo.js")).toBe(false);
    expect(wildcardMatch("*.ts", "src/foo.ts")).toBe(false); // * doesn't cross /
  });

  it("** matches across slashes", () => {
    expect(wildcardMatch("src/**", "src/a/b/c.ts")).toBe(true);
    expect(wildcardMatch("**", "anything/at/all")).toBe(true);
    expect(wildcardMatch("**/*.ts", "src/foo.ts")).toBe(true);
  });

  it("* universal wildcard", () => {
    expect(wildcardMatch("*", "anything")).toBe(true);
  });

  it("? matches single non-slash char", () => {
    expect(wildcardMatch("foo?", "foob")).toBe(true);
    expect(wildcardMatch("foo?", "foo")).toBe(false);
    expect(wildcardMatch("foo?", "foo/b")).toBe(false);
  });

  it("case insensitive", () => {
    expect(wildcardMatch("*.TS", "foo.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ruleset evaluation
// ---------------------------------------------------------------------------

describe("evaluateRuleset", () => {
  it("returns ask when no rules match", () => {
    const result = evaluateRuleset([], "read", "foo.ts");
    expect(result.action).toBe("ask");
    expect(result.matchedRule).toBeUndefined();
  });

  it("last-match-wins: later rule overrides earlier", () => {
    const ruleset = [
      { permission: "read", pattern: "**", action: "allow" as const },
      { permission: "read", pattern: "*.env", action: "deny" as const },
    ];
    // .env file → deny (last match)
    expect(evaluateRuleset(ruleset, "read", ".env").action).toBe("deny");
    // other file → allow (first match, no later override)
    expect(evaluateRuleset(ruleset, "read", "foo.ts").action).toBe("allow");
  });

  it("returns the matched rule", () => {
    const rule = { permission: "bash", pattern: "**", action: "ask" as const };
    const result = evaluateRuleset([rule], "bash", "ls -la");
    expect(result.matchedRule).toEqual(rule);
  });

  it("permission wildcard matches all permissions", () => {
    const ruleset = [{ permission: "*", pattern: "**", action: "deny" as const }];
    expect(evaluateRuleset(ruleset, "read", "foo").action).toBe("deny");
    expect(evaluateRuleset(ruleset, "write", "bar").action).toBe("deny");
    expect(evaluateRuleset(ruleset, "bash", "cmd").action).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Built-in rulesets
// ---------------------------------------------------------------------------

describe("EXPLORE_AGENT_RULESET", () => {
  it("allows read operations", () => {
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "read", "src/foo.ts").action).toBe("allow");
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "glob", "**/*.ts").action).toBe("allow");
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "grep", "pattern").action).toBe("allow");
  });

  it("denies write operations", () => {
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "write", "foo.ts").action).toBe("deny");
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "edit", "foo.ts").action).toBe("deny");
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "task", "general").action).toBe("deny");
  });

  it("asks for bash", () => {
    expect(evaluateRuleset(EXPLORE_AGENT_RULESET, "bash", "ls").action).toBe("ask");
  });
});

describe("PLAN_AGENT_RULESET", () => {
  it("denies write and edit", () => {
    expect(evaluateRuleset(PLAN_AGENT_RULESET, "write", "foo.ts").action).toBe("deny");
    expect(evaluateRuleset(PLAN_AGENT_RULESET, "edit", "foo.ts").action).toBe("deny");
  });

  it("allows read", () => {
    expect(evaluateRuleset(PLAN_AGENT_RULESET, "read", "foo.ts").action).toBe("allow");
  });
});

describe("INTERNAL_AGENT_RULESET", () => {
  it("denies everything", () => {
    expect(evaluateRuleset(INTERNAL_AGENT_RULESET, "read", "foo").action).toBe("deny");
    expect(evaluateRuleset(INTERNAL_AGENT_RULESET, "bash", "cmd").action).toBe("deny");
    expect(evaluateRuleset(INTERNAL_AGENT_RULESET, "task", "agent").action).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Approval persistence
// ---------------------------------------------------------------------------

describe("approval persistence", () => {
  const slug = "approval-test-instance";
  const sessionId = "sess-approval-1";

  beforeEach(() => {
    clearInstanceApprovals(slug);
  });

  it("lookupApproval returns undefined when no approval recorded", () => {
    expect(
      lookupApproval({
        instanceSlug: slug,
        sessionId: undefined,
        permission: "bash",
        pattern: "ls",
      }),
    ).toBeUndefined();
  });

  it("records and retrieves a session-level approval", () => {
    recordApproval(
      { instanceSlug: slug, sessionId, permission: "bash", pattern: "ls" },
      "allow",
      "once",
    );
    expect(
      lookupApproval({ instanceSlug: slug, sessionId, permission: "bash", pattern: "ls" }),
    ).toBe("allow");
  });

  it("records and retrieves an instance-level approval", () => {
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "write", pattern: "*.ts" },
      "allow",
      "always",
    );
    expect(
      lookupApproval({
        instanceSlug: slug,
        sessionId: undefined,
        permission: "write",
        pattern: "*.ts",
      }),
    ).toBe("allow");
  });

  it("clearSessionApprovals removes only session-level approvals", () => {
    recordApproval(
      { instanceSlug: slug, sessionId, permission: "bash", pattern: "ls" },
      "allow",
      "once",
    );
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "read", pattern: "**" },
      "allow",
      "always",
    );

    clearSessionApprovals(slug, sessionId);

    expect(
      lookupApproval({ instanceSlug: slug, sessionId, permission: "bash", pattern: "ls" }),
    ).toBeUndefined();
    // Instance-level approval survives
    expect(
      lookupApproval({
        instanceSlug: slug,
        sessionId: undefined,
        permission: "read",
        pattern: "**",
      }),
    ).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// checkPermission (high-level)
// ---------------------------------------------------------------------------

describe("checkPermission", () => {
  const slug = "check-perm-instance";

  beforeEach(() => {
    clearInstanceApprovals(slug);
  });

  it("uses recorded approval first", () => {
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "bash", pattern: "ls" },
      "allow",
      "always",
    );
    const result = checkPermission("bash", "ls", {
      instanceSlug: slug,
      agentRuleset: [{ permission: "bash", pattern: "**", action: "deny" }],
    });
    expect(result.action).toBe("allow"); // recorded approval wins
  });

  it("falls through to agent ruleset when no approval", () => {
    const result = checkPermission("write", "foo.ts", {
      instanceSlug: slug,
      agentRuleset: EXPLORE_AGENT_RULESET,
    });
    expect(result.action).toBe("deny");
  });

  it("session ruleset overrides agent ruleset", () => {
    const result = checkPermission("write", "foo.ts", {
      instanceSlug: slug,
      agentRuleset: EXPLORE_AGENT_RULESET,
      sessionRuleset: [{ permission: "write", pattern: "foo.ts", action: "allow" }],
    });
    expect(result.action).toBe("allow");
  });

  it("defaults to ask when no rules match", () => {
    const result = checkPermission("unknown_perm", "anything", {
      instanceSlug: slug,
    });
    expect(result.action).toBe("ask");
  });
});

// ---------------------------------------------------------------------------
// DB persistence (Phase 0)
// ---------------------------------------------------------------------------

// Helper: seed a minimal instance row so rt_permissions FK is satisfied
// Port is derived from slug hash to avoid UNIQUE conflicts when seeding multiple slugs
let _seedPortCounter = 29001;
function seedInstanceForPermissions(db: Database.Database, slug: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  const port = _seedPortCounter++;
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, port, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

describe("recordApproval — DB persistence", () => {
  let db: Database.Database;
  const slug = "db-persist-test";

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstanceForPermissions(db, slug);
    clearInstanceApprovals(slug);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a row in rt_permissions for persist='always' when db provided", () => {
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "bash", pattern: "ls" },
      "allow",
      "always",
      db,
      slug,
    );

    const rows = db
      .prepare("SELECT * FROM rt_permissions WHERE instance_slug = ?")
      .all(slug) as Array<{ permission: string; pattern: string; action: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.permission).toBe("bash");
    expect(rows[0]!.pattern).toBe("ls");
    expect(rows[0]!.action).toBe("allow");
  });

  it("does not insert a row for persist='once'", () => {
    recordApproval(
      { instanceSlug: slug, sessionId: "sess-1", permission: "write", pattern: "*.ts" },
      "allow",
      "once",
      db,
      slug,
    );

    const rows = db.prepare("SELECT * FROM rt_permissions WHERE instance_slug = ?").all(slug);

    expect(rows).toHaveLength(0);
  });

  it("uses INSERT OR REPLACE to avoid duplicates", () => {
    const key = { instanceSlug: slug, sessionId: undefined, permission: "read", pattern: "**" };

    // Insert twice with same key
    recordApproval(key, "allow", "always", db, slug);
    recordApproval(key, "deny", "always", db, slug);

    const rows = db
      .prepare("SELECT * FROM rt_permissions WHERE instance_slug = ?")
      .all(slug) as Array<{ action: string }>;

    // Should have only one row (last write wins)
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("deny");
  });
});

describe("lookupApproval — DB fallback", () => {
  let db: Database.Database;
  const slug = "db-lookup-test";

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstanceForPermissions(db, slug);
    clearInstanceApprovals(slug);
  });

  afterEach(() => {
    db.close();
  });

  it("returns action from DB when memory cache is empty", () => {
    // Insert directly in DB (bypassing memory cache)
    db.prepare(
      `INSERT INTO rt_permissions (id, instance_slug, scope, permission, pattern, action, created_at)
       VALUES ('test-id-1', ?, 'instance', 'bash', 'ls', 'allow', datetime('now'))`,
    ).run(slug);

    // Memory cache is empty — should fall back to DB
    const result = lookupApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "bash", pattern: "ls" },
      db,
      slug,
    );

    expect(result).toBe("allow");
  });

  it("repopulates memory cache from DB", () => {
    // Insert directly in DB
    db.prepare(
      `INSERT INTO rt_permissions (id, instance_slug, scope, permission, pattern, action, created_at)
       VALUES ('test-id-2', ?, 'instance', 'write', '*.ts', 'deny', datetime('now'))`,
    ).run(slug);

    // First lookup — from DB
    lookupApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "write", pattern: "*.ts" },
      db,
      slug,
    );

    // Second lookup — should come from memory cache (no DB needed)
    // We verify by closing the DB and checking the lookup still works via memory
    const result = lookupApproval({
      instanceSlug: slug,
      sessionId: undefined,
      permission: "write",
      pattern: "*.ts",
    });

    expect(result).toBe("deny");
  });
});

describe("clearInstanceApprovals — DB cleanup", () => {
  let db: Database.Database;
  const slug = "db-clear-test";
  const slug2 = "db-clear-test-2";

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstanceForPermissions(db, slug);
    seedInstanceForPermissions(db, slug2);
    clearInstanceApprovals(slug);
    clearInstanceApprovals(slug2);
  });

  afterEach(() => {
    db.close();
  });

  it("deletes rows from rt_permissions for the instance when db provided", () => {
    // Insert rows for slug
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "bash", pattern: "ls" },
      "allow",
      "always",
      db,
      slug,
    );
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "read", pattern: "**" },
      "allow",
      "always",
      db,
      slug,
    );

    // Verify rows exist
    const before = db
      .prepare("SELECT COUNT(*) as count FROM rt_permissions WHERE instance_slug = ?")
      .get(slug) as { count: number };
    expect(before.count).toBe(2);

    // Clear with DB
    clearInstanceApprovals(slug, db);

    // Verify rows deleted
    const after = db
      .prepare("SELECT COUNT(*) as count FROM rt_permissions WHERE instance_slug = ?")
      .get(slug) as { count: number };
    expect(after.count).toBe(0);
  });

  it("does not delete rows for other instances", () => {
    // Insert rows for both instances
    recordApproval(
      { instanceSlug: slug, sessionId: undefined, permission: "bash", pattern: "ls" },
      "allow",
      "always",
      db,
      slug,
    );
    recordApproval(
      { instanceSlug: slug2, sessionId: undefined, permission: "read", pattern: "**" },
      "allow",
      "always",
      db,
      slug2,
    );

    // Clear only slug
    clearInstanceApprovals(slug, db);

    // slug2 rows should remain
    const remaining = db
      .prepare("SELECT COUNT(*) as count FROM rt_permissions WHERE instance_slug = ?")
      .get(slug2) as { count: number };
    expect(remaining.count).toBe(1);
  });
});

describe("loadInstanceApprovals", () => {
  let db: Database.Database;
  const slug = "db-load-test";

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstanceForPermissions(db, slug);
    clearInstanceApprovals(slug);
  });

  afterEach(() => {
    db.close();
  });

  it("loads approvals from DB into memory cache", () => {
    // Insert directly in DB
    db.prepare(
      `INSERT INTO rt_permissions (id, instance_slug, scope, permission, pattern, action, created_at)
       VALUES ('load-id-1', ?, 'instance', 'bash', 'git status', 'allow', datetime('now'))`,
    ).run(slug);

    // Load into memory
    loadInstanceApprovals(db, slug);

    // Should now be in memory cache (no DB needed for lookup)
    const result = lookupApproval({
      instanceSlug: slug,
      sessionId: undefined,
      permission: "bash",
      pattern: "git status",
    });

    expect(result).toBe("allow");
  });
});
