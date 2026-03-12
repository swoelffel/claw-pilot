import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateRuleset,
  checkPermission,
  recordApproval,
  lookupApproval,
  clearSessionApprovals,
  clearInstanceApprovals,
  EXPLORE_AGENT_RULESET,
  PLAN_AGENT_RULESET,
  INTERNAL_AGENT_RULESET,
} from "../permission/index.js";
import { wildcardMatch } from "../permission/wildcard.js";

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
