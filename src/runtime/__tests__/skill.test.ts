/**
 * runtime/__tests__/skill.test.ts
 *
 * Unit tests for the skills-v2 feature (skill.ts + buildSkillsBlock in system-prompt.ts).
 *
 * Strategy:
 * - listAvailableSkills() and SkillTool are exported — tested directly.
 * - Private helpers (parseFrontmatter, checkEligibility, buildSkillDirs, listSkillResources)
 *   are tested indirectly through the public API.
 * - Real filesystem via os.tmpdir() + fs.mkdtemp() — no mocks for local skill discovery.
 * - fetch is stubbed globally via vi.stubGlobal for remote skill tests.
 * - buildSkillsBlock is tested via buildSystemPrompt (the only caller).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { listAvailableSkills, SkillTool } from "../tool/built-in/skill.js";
import type { RuntimeAgentConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal RuntimeAgentConfig for tests */
function makeAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "agent1",
    name: "Agent One",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 20,
    allowSubAgents: false,
    toolProfile: "coding",
    isDefault: false,
    ...overrides,
  };
}

/** Create a temporary directory and return its path */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
}

/**
 * Create a skill directory with a SKILL.md file inside a parent directory.
 * Returns the path to the skill directory.
 */
async function createSkill(parentDir: string, skillName: string, content: string): Promise<string> {
  const skillDir = path.join(parentDir, skillName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
  return skillDir;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

afterEach(async () => {
  // Clean up all temporary directories created during the test
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Helper: create a tmp dir and register it for cleanup */
async function tmpDir(): Promise<string> {
  const d = await makeTmpDir();
  tmpDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// listAvailableSkills — hierarchy and deduplication
// ---------------------------------------------------------------------------

describe("listAvailableSkills — hierarchy and deduplication", () => {
  /**
   * Objective: a skill placed in workDir/skills/ must be discovered.
   * Positive test: creates a skill in workDir/skills/, expects it in the result.
   */
  it("[positive] skill in workDir/skills/ is discovered", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "my-skill", "# My Skill\nThis is my skill.\nLine 3.");

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert
    const names = skills.map((s) => s.name);
    expect(names).toContain("my-skill");
  });

  /**
   * Objective: a skill placed in workDir/.opencode/skill/ must also be discovered.
   * Positive test: creates a skill in the .opencode/skill/ subdirectory.
   */
  it("[positive] skill in workDir/.opencode/skill/ is discovered", async () => {
    // Arrange
    const workDir = await tmpDir();
    const openCodeSkillDir = path.join(workDir, ".opencode", "skill");
    await fs.mkdir(openCodeSkillDir, { recursive: true });
    await createSkill(
      openCodeSkillDir,
      "opencode-skill",
      "# OpenCode Skill\nContent here.\nLine 3.",
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert
    const names = skills.map((s) => s.name);
    expect(names).toContain("opencode-skill");
  });

  /**
   * Objective: when the same skill name exists in both workDir/.opencode/skill/ (level 3)
   * and workDir/skills/ (level 4), the workDir/skills/ version must win (last writer wins).
   * Positive test: deduplication with higher-priority directory overriding lower.
   */
  it("[positive] workDir/skills/ overrides workDir/.opencode/skill/ for same skill name", async () => {
    // Arrange
    const workDir = await tmpDir();

    // Level 3: workDir/.opencode/skill/
    const openCodeSkillDir = path.join(workDir, ".opencode", "skill");
    await fs.mkdir(openCodeSkillDir, { recursive: true });
    await createSkill(
      openCodeSkillDir,
      "shared-skill",
      "# Shared Skill\nLow priority version.\nLine 3.",
    );

    // Level 4: workDir/skills/ (higher priority)
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "shared-skill", "# Shared Skill\nHigh priority version.\nLine 3.");

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: only one entry for "shared-skill"
    const matching = skills.filter((s) => s.name === "shared-skill");
    expect(matching).toHaveLength(1);
    // The content from workDir/skills/ (high priority) must win
    expect(matching[0]!.content).toContain("High priority version.");
  });

  /**
   * Objective: a directory without SKILL.md must NOT be listed as a skill.
   * Negative test: creates a directory without SKILL.md, expects it absent from results.
   */
  it("[negative] directory without SKILL.md is not listed as a skill", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });

    // Create a directory without SKILL.md
    const notASkillDir = path.join(skillsDir, "not-a-skill");
    await fs.mkdir(notASkillDir, { recursive: true });
    await fs.writeFile(path.join(notASkillDir, "README.md"), "# Not a skill", "utf-8");

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: "not-a-skill" must not appear
    const names = skills.map((s) => s.name);
    expect(names).not.toContain("not-a-skill");
  });

  /**
   * Objective: when workDir has no skills directory at all, the result must be empty.
   * Negative test: empty workDir → empty skill list.
   */
  it("[negative] workDir with no skills directories returns empty list", async () => {
    // Arrange
    const workDir = await tmpDir();

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert
    expect(skills).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listAvailableSkills — frontmatter eligibility
// ---------------------------------------------------------------------------

describe("listAvailableSkills — frontmatter eligibility", () => {
  /**
   * Objective: a skill without any frontmatter must always be eligible.
   * Positive test: plain SKILL.md with no --- block → skill is returned.
   */
  it("[positive] skill without frontmatter is always eligible", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "no-frontmatter",
      "# No Frontmatter Skill\nThis skill has no frontmatter.\nLine 3.",
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert
    const names = skills.map((s) => s.name);
    expect(names).toContain("no-frontmatter");
  });

  /**
   * Objective: a skill with os: ["nonexistent-os-xyz"] must be excluded on the current platform.
   * Negative test: os constraint that never matches → skill filtered out.
   */
  it("[negative] skill with non-matching os constraint is excluded", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "os-restricted",
      `---
os: [nonexistent-os-xyz]
---
# OS Restricted Skill
This skill only runs on a fake OS.
Line 3.`,
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: skill excluded because current OS is not "nonexistent-os-xyz"
    const names = skills.map((s) => s.name);
    expect(names).not.toContain("os-restricted");
  });

  /**
   * Objective: a skill with requires.env: ["NONEXISTENT_VAR_XYZ_123"] must be excluded
   * when that env var is not set.
   * Negative test: missing env var → skill filtered out.
   */
  it("[negative] skill with missing required env var is excluded", async () => {
    // Arrange: ensure the env var is definitely not set
    const envVarName = "NONEXISTENT_VAR_XYZ_123_SKILL_TEST";
    delete process.env[envVarName];

    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "env-restricted",
      `---
requires:
  env: [${envVarName}]
---
# Env Restricted Skill
This skill requires a specific env var.
Line 3.`,
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: skill excluded because env var is not set
    const names = skills.map((s) => s.name);
    expect(names).not.toContain("env-restricted");
  });

  /**
   * Objective: a skill with a required env var that IS set must be included.
   * Positive test: env var present → skill is eligible.
   */
  it("[positive] skill with satisfied env var constraint is included", async () => {
    // Arrange: set the env var
    const envVarName = "SKILL_TEST_ENV_VAR_PRESENT_XYZ";
    process.env[envVarName] = "1";

    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "env-satisfied",
      `---
requires:
  env: [${envVarName}]
---
# Env Satisfied Skill
This skill requires an env var that is set.
Line 3.`,
    );

    try {
      // Act
      const skills = await listAvailableSkills(workDir);

      // Assert: skill included because env var is set
      const names = skills.map((s) => s.name);
      expect(names).toContain("env-satisfied");
    } finally {
      delete process.env[envVarName];
    }
  });

  /**
   * Objective: a skill with malformed frontmatter must still be eligible (graceful degradation).
   * Edge test: invalid YAML in frontmatter → skill is returned (not filtered out).
   */
  it("[edge] skill with malformed frontmatter is still eligible (graceful degradation)", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "malformed-frontmatter",
      `---
: this is invalid yaml :::
  broken: [unclosed
---
# Malformed Frontmatter Skill
This skill has broken frontmatter.
Line 3.`,
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: skill is still returned despite malformed frontmatter
    const names = skills.map((s) => s.name);
    expect(names).toContain("malformed-frontmatter");
  });

  /**
   * Objective: a skill with requires.bins pointing to a non-existent binary must be excluded.
   * Negative test: binary not in PATH → skill filtered out.
   */
  it("[negative] skill with non-existent required binary is excluded", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "bin-restricted",
      `---
requires:
  bins: [nonexistent-binary-xyz-skill-test-12345]
---
# Binary Restricted Skill
This skill requires a binary that does not exist.
Line 3.`,
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert: skill excluded because binary is not available
    const names = skills.map((s) => s.name);
    expect(names).not.toContain("bin-restricted");
  });

  /**
   * Objective: frontmatter description must be extracted and available on the SkillEntry.
   * Positive test: skill with description in frontmatter → description field populated.
   */
  it("[positive] frontmatter description is extracted into SkillEntry.description", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(
      skillsDir,
      "described-skill",
      `---
description: "A skill with a description"
---
# Described Skill
This skill has a description in its frontmatter.
Line 3.`,
    );

    // Act
    const skills = await listAvailableSkills(workDir);

    // Assert
    const skill = skills.find((s) => s.name === "described-skill");
    expect(skill).toBeDefined();
    expect(skill!.description).toBe("A skill with a description");
  });
});

// ---------------------------------------------------------------------------
// listAvailableSkills — permissions
// ---------------------------------------------------------------------------

describe("listAvailableSkills — permissions", () => {
  /**
   * Objective: agentConfig with no permission rules must return all skills.
   * Positive test: empty permissions array → all skills accessible.
   */
  it("[positive] agentConfig with no permission rules returns all skills", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "skill-a", "# Skill A\nContent A.\nLine 3.");
    await createSkill(skillsDir, "skill-b", "# Skill B\nContent B.\nLine 3.");

    const agentConfig = makeAgentConfig({ permissions: [] });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: both skills returned
    const names = skills.map((s) => s.name);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
  });

  /**
   * Objective: agentConfig with `skill "my-skill" → deny` must exclude that skill.
   * Negative test: deny rule for specific skill → skill absent from results.
   */
  it("[negative] agentConfig with deny rule for specific skill excludes that skill", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "allowed-skill", "# Allowed Skill\nContent.\nLine 3.");
    await createSkill(skillsDir, "denied-skill", "# Denied Skill\nContent.\nLine 3.");

    const agentConfig = makeAgentConfig({
      permissions: [{ permission: "skill", pattern: "denied-skill", action: "deny" }],
    });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: denied-skill excluded, allowed-skill present
    const names = skills.map((s) => s.name);
    expect(names).not.toContain("denied-skill");
    expect(names).toContain("allowed-skill");
  });

  /**
   * Objective: agentConfig with `skill "*" → allow` must return all skills.
   * Positive test: wildcard allow rule → all skills accessible.
   */
  it("[positive] agentConfig with wildcard allow rule returns all skills", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "skill-x", "# Skill X\nContent X.\nLine 3.");
    await createSkill(skillsDir, "skill-y", "# Skill Y\nContent Y.\nLine 3.");

    const agentConfig = makeAgentConfig({
      permissions: [{ permission: "skill", pattern: "*", action: "allow" }],
    });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: both skills returned
    const names = skills.map((s) => s.name);
    expect(names).toContain("skill-x");
    expect(names).toContain("skill-y");
  });

  /**
   * Objective: deny-all rule followed by allow for a specific skill must allow only that skill.
   * Positive test: last-match-wins — allow after deny → specific skill accessible.
   */
  it("[positive] last-match-wins: allow after deny-all allows specific skill", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "allowed-only", "# Allowed Only\nContent.\nLine 3.");
    await createSkill(skillsDir, "also-denied", "# Also Denied\nContent.\nLine 3.");

    const agentConfig = makeAgentConfig({
      permissions: [
        { permission: "skill", pattern: "*", action: "deny" },
        { permission: "skill", pattern: "allowed-only", action: "allow" },
      ],
    });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: only "allowed-only" is returned
    const names = skills.map((s) => s.name);
    expect(names).toContain("allowed-only");
    expect(names).not.toContain("also-denied");
  });
});

// ---------------------------------------------------------------------------
// SkillTool.execute() — skill loading
// ---------------------------------------------------------------------------

describe("SkillTool.execute() — skill loading", () => {
  /** Minimal Tool.Context for testing */
  function makeCtx() {
    return {
      sessionId: "s1" as import("../types.js").SessionId,
      messageId: "m1" as import("../types.js").MessageId,
      agentId: "main",
      abort: new AbortController().signal,
      metadata: vi.fn(),
    };
  }

  /**
   * Objective: when a skill is found, execute() must return output containing
   * `<skill_content name="...">`.
   * Positive test: skill exists in process.cwd()/skills/ → output has skill_content tag.
   */
  it("[positive] found skill returns output with <skill_content name='...'> tag", async () => {
    // Arrange: create a skill in a temp dir, then temporarily change cwd
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "test-skill", "# Test Skill\nThis is the skill content.\nLine 3.");

    // We need the skill to be findable via process.cwd() — use the workDir as cwd
    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act
      const result = await def.execute({ name: "test-skill" }, ctx);

      // Assert
      expect(result.output).toContain('<skill_content name="test-skill">');
      expect(result.output).toContain("This is the skill content.");
      expect(result.output).toContain("</skill_content>");
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Objective: when a skill has resource files, execute() must include <skill_files> in output.
   * Positive test: skill with extra files → output contains <skill_files> block.
   */
  it("[positive] skill with resource files includes <skill_files> in output", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    const skillDir = await createSkill(
      skillsDir,
      "skill-with-resources",
      "# Skill With Resources\nContent.\nLine 3.",
    );
    // Add a resource file
    await fs.writeFile(path.join(skillDir, "template.txt"), "Template content", "utf-8");

    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act
      const result = await def.execute({ name: "skill-with-resources" }, ctx);

      // Assert
      expect(result.output).toContain("<skill_files>");
      expect(result.output).toContain("template.txt");
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Objective: when a skill is NOT found, execute() must throw with "Skill not found: ..." message.
   * Negative test: non-existent skill name → throws with descriptive error.
   */
  it("[negative] skill not found throws with 'Skill not found: ...' message", async () => {
    // Arrange: use a temp dir with no skills
    const workDir = await tmpDir();
    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act + Assert
      await expect(def.execute({ name: "nonexistent-skill-xyz" }, ctx)).rejects.toThrow(
        "Skill not found: nonexistent-skill-xyz",
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Objective: skill name with invalid characters must be sanitized (characters removed).
   * Negative test: name with special chars → sanitized name used, not found → throws.
   */
  it("[negative] skill name with invalid characters is sanitized before lookup", async () => {
    // Arrange
    const workDir = await tmpDir();
    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act + Assert: "my../skill" → sanitized to "myskill" → not found
      await expect(def.execute({ name: "my../skill!@#" }, ctx)).rejects.toThrow(
        "Skill not found: myskill",
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Objective: a skill name that becomes empty after sanitization must throw with
   * "Invalid skill name" error.
   * Negative test: name with only special chars → empty after sanitization → specific error.
   */
  it("[negative] skill name that is empty after sanitization throws 'Invalid skill name'", async () => {
    // Arrange
    const workDir = await tmpDir();
    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act + Assert: "!@#$%" → sanitized to "" → invalid
      await expect(def.execute({ name: "!@#$%" }, ctx)).rejects.toThrow("Invalid skill name");
    } finally {
      process.chdir(originalCwd);
    }
  });

  /**
   * Objective: execute() result must include the correct title.
   * Positive test: title is "Skill: <skillName>".
   */
  it("[positive] execute() result has correct title 'Skill: <name>'", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "titled-skill", "# Titled Skill\nContent.\nLine 3.");

    const originalCwd = process.cwd();
    process.chdir(workDir);

    try {
      const def = await SkillTool.init();
      const ctx = makeCtx();

      // Act
      const result = await def.execute({ name: "titled-skill" }, ctx);

      // Assert
      expect(result.title).toBe("Skill: titled-skill");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// fetchRemoteSkills — via listAvailableSkills with skillUrls
// ---------------------------------------------------------------------------

describe("fetchRemoteSkills — via listAvailableSkills with skillUrls", () => {
  // Note: the real cache dir is ~/.cache/claw-pilot/skills/ — we mock fetch
  // to avoid actual network calls and filesystem side effects in the cache.

  /**
   * Objective: a valid remote skill index must be fetched and the skill returned.
   * Positive test: fetch returns valid index + skill content → skill in result.
   */
  it("[positive] valid remote index returns skill in list", async () => {
    // Arrange: stub fetch to return a valid index + skill content
    const skillContent = "# Remote Skill\nThis is a remote skill.\nLine 3.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://example.com/skills/index.json") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              skills: [
                {
                  name: "remote-skill",
                  description: "A remote skill",
                  url: "https://example.com/skills/remote-skill/SKILL.md",
                },
              ],
            }),
          });
        }
        if (url === "https://example.com/skills/remote-skill/SKILL.md") {
          return Promise.resolve({
            ok: true,
            text: async () => skillContent,
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    const workDir = await tmpDir();
    const agentConfig = makeAgentConfig({
      skillUrls: ["https://example.com/skills/index.json"],
    });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: remote skill is in the list
    const names = skills.map((s) => s.name);
    expect(names).toContain("remote-skill");
  });

  /**
   * Objective: an inaccessible URL must be silently ignored, returning an empty list.
   * Negative test: fetch rejects → no skills returned, no error thrown.
   */
  it("[negative] inaccessible URL is silently ignored, returns empty list", async () => {
    // Arrange: stub fetch to reject
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const workDir = await tmpDir();
    const agentConfig = makeAgentConfig({
      skillUrls: ["https://unreachable.example.com/skills/index.json"],
    });

    // Act: must not throw
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: empty list (remote skill not available)
    expect(skills).toHaveLength(0);
  });

  /**
   * Objective: an index with invalid JSON must be silently ignored.
   * Negative test: fetch returns non-JSON response → ignored, empty list.
   */
  it("[negative] invalid JSON index is silently ignored", async () => {
    // Arrange: stub fetch to return invalid JSON
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );

    const workDir = await tmpDir();
    const agentConfig = makeAgentConfig({
      skillUrls: ["https://example.com/skills/bad-index.json"],
    });

    // Act: must not throw
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: empty list
    expect(skills).toHaveLength(0);
  });

  /**
   * Objective: a local skill with the same name as a remote skill must override the remote one.
   * Positive test: local skill wins over remote skill (higher priority).
   */
  it("[positive] local skill overrides remote skill with same name", async () => {
    // Arrange: stub fetch to return a remote skill
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://example.com/skills/index.json") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              skills: [
                {
                  name: "shared-skill",
                  description: "Remote version",
                  url: "https://example.com/skills/shared-skill/SKILL.md",
                },
              ],
            }),
          });
        }
        if (url === "https://example.com/skills/shared-skill/SKILL.md") {
          return Promise.resolve({
            ok: true,
            text: async () => "# Shared Skill\nRemote content.\nLine 3.",
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }),
    );

    // Create a local skill with the same name
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "shared-skill", "# Shared Skill\nLocal content wins.\nLine 3.");

    const agentConfig = makeAgentConfig({
      skillUrls: ["https://example.com/skills/index.json"],
    });

    // Act
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: only one entry for "shared-skill", with local content
    const matching = skills.filter((s) => s.name === "shared-skill");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.content).toContain("Local content wins.");
  });

  /**
   * Objective: an index with missing "skills" array must be silently ignored.
   * Negative test: index JSON without "skills" key → ignored.
   */
  it("[negative] index without 'skills' array is silently ignored", async () => {
    // Arrange: stub fetch to return an index without "skills" key
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: 1, data: [] }), // no "skills" key
      }),
    );

    const workDir = await tmpDir();
    const agentConfig = makeAgentConfig({
      skillUrls: ["https://example.com/skills/no-skills-key.json"],
    });

    // Act: must not throw
    const skills = await listAvailableSkills(workDir, agentConfig);

    // Assert: empty list
    expect(skills).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildSkillsBlock — via buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSkillsBlock — via buildSystemPrompt", () => {
  // We need to import buildSystemPrompt. Since system-prompt.ts uses node:fs (sync),
  // we import it directly (no mock needed for the skills block — we use real fs).
  // However, system-prompt.ts also uses readFileSync/existsSync for workspace discovery.
  // We use a real workDir with no workspace-<agentId> directory to avoid that path.

  /**
   * Objective: when workDir has skills, the system prompt must contain <available_skills>.
   * Positive test: workDir/skills/ with a skill → prompt contains <available_skills>.
   */
  it("[positive] workDir with skills → system prompt contains <available_skills>", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "my-skill", "# My Skill\nSkill content.\nLine 3.");

    // Import buildSystemPrompt dynamically to avoid module-level mock conflicts
    const { buildSystemPrompt } = await import("../session/system-prompt.js");

    const ctx = {
      instanceSlug: "test-instance" as import("../types.js").InstanceSlug,
      agentConfig: makeAgentConfig({ id: "agent1" }),
      channel: "web",
      workDir,
    };

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain('name="my-skill"');
    expect(prompt).toContain("</available_skills>");
  });

  /**
   * Objective: when workDir has no skills, the system prompt must NOT contain <available_skills>.
   * Negative test: empty workDir → no <available_skills> block.
   */
  it("[negative] workDir without skills → system prompt does NOT contain <available_skills>", async () => {
    // Arrange: empty workDir (no skills directories)
    const workDir = await tmpDir();

    const { buildSystemPrompt } = await import("../session/system-prompt.js");

    const ctx = {
      instanceSlug: "test-instance" as import("../types.js").InstanceSlug,
      agentConfig: makeAgentConfig({ id: "agent1" }),
      channel: "web",
      workDir,
    };

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert
    expect(prompt).not.toContain("<available_skills>");
  });

  /**
   * Objective: a skill denied by agentConfig permissions must be absent from <available_skills>.
   * Negative test: deny rule → skill not listed in the block.
   */
  it("[negative] skill with deny permission is absent from <available_skills>", async () => {
    // Arrange
    const workDir = await tmpDir();
    const skillsDir = path.join(workDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await createSkill(skillsDir, "allowed-skill", "# Allowed Skill\nContent.\nLine 3.");
    await createSkill(skillsDir, "denied-skill", "# Denied Skill\nContent.\nLine 3.");

    const { buildSystemPrompt } = await import("../session/system-prompt.js");

    const ctx = {
      instanceSlug: "test-instance" as import("../types.js").InstanceSlug,
      agentConfig: makeAgentConfig({
        id: "agent1",
        permissions: [{ permission: "skill", pattern: "denied-skill", action: "deny" as const }],
      }),
      channel: "web",
      workDir,
    };

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: allowed-skill present, denied-skill absent
    expect(prompt).toContain('name="allowed-skill"');
    expect(prompt).not.toContain('name="denied-skill"');
  });

  /**
   * Objective: when workDir is undefined, buildSkillsBlock is not called and
   * <available_skills> must not appear.
   * Negative test: no workDir → no skills block.
   */
  it("[negative] no workDir → system prompt does NOT contain <available_skills>", async () => {
    // Arrange
    const { buildSystemPrompt } = await import("../session/system-prompt.js");

    const ctx = {
      instanceSlug: "test-instance" as import("../types.js").InstanceSlug,
      agentConfig: makeAgentConfig({ id: "agent1" }),
      channel: "web",
      workDir: undefined,
    };

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert
    expect(prompt).not.toContain("<available_skills>");
  });
});
