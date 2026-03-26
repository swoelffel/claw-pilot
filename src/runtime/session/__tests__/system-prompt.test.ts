/**
 * runtime/session/__tests__/system-prompt.test.ts
 *
 * Unit tests for buildSystemPrompt and its internal helpers.
 *
 * Strategy:
 * - buildSystemPrompt() is async — all tests await its result.
 * - File-system calls (readFileSync, existsSync) are mocked via vi.mock("node:fs").
 * - fetch is stubbed globally via vi.stubGlobal to test instructionUrls behaviour.
 * - resolveDiscoveryFiles is tested indirectly through the workspace-discovery path:
 *   we create a fake workspace directory with HEARTBEAT.md and verify whether it
 *   appears in the output depending on promptMode / toolProfile.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Mock node:fs — we control which files "exist" and what they contain
// ---------------------------------------------------------------------------

const mockExistsSync = vi.fn<(path: string) => boolean>();
const mockReadFileSync = vi.fn<(path: string, encoding: string) => string>();
const mockWriteFileSync = vi.fn<(path: string, data: string, encoding: string) => void>();
const mockMkdirSync = vi.fn<(path: string, options?: unknown) => void>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
  readFileSync: (path: string, encoding: string) => mockReadFileSync(path, encoding),
  writeFileSync: (path: string, data: string, encoding: string) =>
    mockWriteFileSync(path, data, encoding),
  mkdirSync: (path: string, options?: unknown) => mockMkdirSync(path, options),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
}));

// Import AFTER mocking so the module picks up the mocked fs
import { buildSystemPrompt } from "../system-prompt.js";
import type { SystemPromptContext } from "../system-prompt.js";
import { resetAgentRegistry, initAgentRegistry } from "../../agent/index.js";
import { clearWorkspaceCache } from "../workspace-cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "agent1",
    name: "Agent One",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 20,
    allowSubAgents: false,
    toolProfile: "executor",
    isDefault: false,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<SystemPromptContext>): SystemPromptContext {
  return {
    instanceSlug: "test-instance",
    agentConfig: makeAgentConfig(),
    channel: "web",
    workDir: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // By default: no workspace directories exist, no files readable
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation(() => {
    throw new Error("ENOENT");
  });
  // Write mocks: no-op by default
  mockWriteFileSync.mockImplementation(() => undefined);
  mockMkdirSync.mockImplementation(() => undefined);
  // Restore any fetch stub from previous test
  vi.unstubAllGlobals();
  // Reset agent registry so each test starts with built-in agents
  resetAgentRegistry();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetAgentRegistry();
  // Clear workspace cache between tests — prevents stale entries from affecting
  // subsequent tests that mock different file contents
  clearWorkspaceCache();
});

// ---------------------------------------------------------------------------
// resolveDiscoveryFiles — tested via workspace discovery output
// ---------------------------------------------------------------------------

describe("resolveDiscoveryFiles — promptMode", () => {
  /**
   * Objective: HEARTBEAT.md is no longer in any discovery list (removed from default prompts).
   * It should never appear in the system prompt regardless of promptMode, unless loaded
   * explicitly via bootstrapFiles.
   */
  it("[positive] promptMode=minimal excludes HEARTBEAT.md from the system prompt", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace directory exists; SOUL.md and HEARTBEAT.md are present
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nThis is the soul file.\nLine 3.";
      if (p === `${wsDir}/HEARTBEAT.md`) return "# Heartbeat\nThis is heartbeat.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ promptMode: "minimal" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: SOUL.md content present, HEARTBEAT.md content absent
    expect(prompt).toContain("This is the soul file.");
    expect(prompt).not.toContain("This is heartbeat.");
  });

  /**
   * Objective: promptMode="full" no longer includes HEARTBEAT.md in discovery.
   * HEARTBEAT.md was removed from the default prompt templates to save tokens.
   * It can still be loaded via bootstrapFiles config.
   */
  it("[positive] promptMode=full excludes HEARTBEAT.md from the system prompt", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content here.\nLine 3.";
      if (p === `${wsDir}/HEARTBEAT.md`) return "# Heartbeat\nHeartbeat content here.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ promptMode: "full" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: SOUL.md present, HEARTBEAT.md absent (no longer in discovery lists)
    expect(prompt).toContain("Soul content here.");
    expect(prompt).not.toContain("Heartbeat content here.");
  });

  /**
   * Objective: when promptMode is absent and toolProfile="sentinel", fallback to minimal mode.
   * Positive test: HEARTBEAT.md must be absent.
   */
  it("[positive] promptMode absent + toolProfile=sentinel → HEARTBEAT.md excluded", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul line.\nLine 3.";
      if (p === `${wsDir}/HEARTBEAT.md`) return "# Heartbeat\nHeartbeat line.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      // promptMode intentionally omitted — toolProfile drives the fallback
      agentConfig: makeAgentConfig({ toolProfile: "sentinel" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: HEARTBEAT.md absent
    expect(prompt).not.toContain("Heartbeat line.");
    expect(prompt).toContain("Soul line.");
  });

  /**
   * Objective: when promptMode is absent and toolProfile="executor", fallback to full mode.
   * HEARTBEAT.md is no longer in the full discovery list — it must be absent.
   */
  it("[positive] promptMode absent + toolProfile=executor → HEARTBEAT.md excluded (no longer in full)", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content.\nLine 3.";
      if (p === `${wsDir}/HEARTBEAT.md`) return "# Heartbeat\nHeartbeat content.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ toolProfile: "executor" }), // no promptMode
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: HEARTBEAT.md absent (no longer in any discovery list)
    expect(prompt).not.toContain("Heartbeat content.");
  });
});

// ---------------------------------------------------------------------------
// extraSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — extraSystemPrompt", () => {
  /**
   * Objective: when extraSystemPrompt is not provided, no extra section appears.
   * Positive test: prompt does not contain any injected subagent context.
   */
  it("[positive] without extraSystemPrompt, no extra section in the prompt", async () => {
    // Arrange: no workspace, no extraSystemPrompt
    const ctx = makeCtx(); // extraSystemPrompt omitted

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: BEHAVIOR_BLOCK is present but nothing after it
    expect(prompt).toContain("<behavior>");
    expect(prompt).not.toContain("## Subagent Context");
  });

  /**
   * Objective: when extraSystemPrompt is provided, it appears after BEHAVIOR_BLOCK.
   * Positive test: the injected content is present and positioned after <behavior>.
   */
  it("[positive] with extraSystemPrompt, content is appended after BEHAVIOR_BLOCK", async () => {
    // Arrange
    const extra = "## Subagent Context\nYou are a subagent.\nSpawn depth: 1";
    const ctx = makeCtx({ extraSystemPrompt: extra });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: extra content present
    expect(prompt).toContain("## Subagent Context");
    expect(prompt).toContain("You are a subagent.");

    // Assert: extra content comes AFTER the behavior block
    const behaviorIdx = prompt.indexOf("<behavior>");
    const extraIdx = prompt.indexOf("## Subagent Context");
    expect(extraIdx).toBeGreaterThan(behaviorIdx);
  });

  /**
   * Objective: extraSystemPrompt with leading/trailing whitespace is trimmed.
   * Negative test: whitespace-only extraSystemPrompt should not add a blank section.
   * The implementation does `ctx.extraSystemPrompt.trim()` which yields "" — falsy check
   * in the `if (ctx.extraSystemPrompt)` guard means it IS still pushed (non-empty string
   * passes the truthy check before trim). We verify the prompt does NOT contain a
   * meaningful extra section (no "## Subagent" or similar marker).
   */
  it("[negative] whitespace-only extraSystemPrompt does not inject meaningful content", async () => {
    // Arrange
    const ctx = makeCtx({ extraSystemPrompt: "   \n  " });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: no meaningful extra content injected (the trimmed empty string adds nothing useful)
    expect(prompt).toContain("<behavior>");
    expect(prompt).not.toContain("## Subagent Context");
    // The prompt must still be a valid non-empty string
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// instructionUrls
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — instructionUrls", () => {
  /**
   * Objective: a valid URL returning content must be injected into the prompt.
   * Positive test: fetch returns "# Remote Instructions\nDo this.", content appears in prompt.
   */
  it("[positive] valid URL with content is injected into the system prompt", async () => {
    // Arrange: stub fetch to return content
    const remoteContent = "# Remote Instructions\nDo this.\nAnd that.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => remoteContent,
      }),
    );

    const ctx = makeCtx({
      agentConfig: makeAgentConfig({
        instructionUrls: ["https://example.com/instructions.md"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: remote content present in prompt
    expect(prompt).toContain("# Remote Instructions");
    expect(prompt).toContain("Do this.");
  });

  /**
   * Objective: a URL that times out must be silently ignored — prompt must not block.
   * Negative test: fetch rejects immediately with AbortError → prompt is built without that content.
   *
   * We simulate the timeout by having fetch reject immediately with an AbortError,
   * which is what fetchWithTimeout() produces when the 5s timer fires.
   * We increase the test timeout to 10s to be safe.
   */
  it("[negative] URL that times out is silently ignored, prompt is still built", async () => {
    // Arrange: stub fetch to reject immediately with AbortError (simulates timeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")),
    );

    const ctx = makeCtx({
      agentConfig: makeAgentConfig({
        instructionUrls: ["https://slow.example.com/instructions.md"],
      }),
    });

    // Act: must resolve without throwing
    const prompt = await buildSystemPrompt(ctx);

    // Assert: prompt is built (contains env block), no remote content
    expect(prompt).toContain("<env>");
    expect(prompt).not.toContain("Remote Instructions");
  }, 10_000);

  /**
   * Objective: a URL returning HTTP 404 must be silently ignored.
   * Negative test: fetch returns { ok: false, status: 404 } → content not injected.
   */
  it("[negative] URL returning HTTP 404 is silently ignored", async () => {
    // Arrange: stub fetch to return a 404 response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      }),
    );

    const ctx = makeCtx({
      agentConfig: makeAgentConfig({
        instructionUrls: ["https://example.com/missing.md"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: prompt built normally, no 404 content
    expect(prompt).toContain("<env>");
    expect(prompt).not.toContain("Not Found");
  });

  /**
   * Objective: when instructionUrls is absent, fetch is never called.
   * Positive test: no fetch stub needed — if fetch were called it would throw.
   */
  it("[positive] no instructionUrls → fetch is never called", async () => {
    // Arrange: stub fetch to throw if called
    const fetchSpy = vi.fn().mockRejectedValue(new Error("fetch should not be called"));
    vi.stubGlobal("fetch", fetchSpy);

    const ctx = makeCtx({
      agentConfig: makeAgentConfig(), // no instructionUrls
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: prompt built, fetch never called
    expect(prompt).toContain("<env>");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Objective: multiple URLs — one succeeds, one fails — only the successful one is injected.
   * Positive test: partial failure must not block the successful URL's content.
   */
  it("[positive] one valid URL + one failing URL → only valid content injected", async () => {
    // Arrange
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "https://example.com/good.md") {
          return Promise.resolve({
            ok: true,
            text: async () => "Good content here.",
          });
        }
        // Second URL returns 500
        return Promise.resolve({ ok: false, status: 500, text: async () => "Error" });
      }),
    );

    const ctx = makeCtx({
      agentConfig: makeAgentConfig({
        instructionUrls: ["https://example.com/good.md", "https://example.com/bad.md"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert
    expect(prompt).toContain("Good content here.");
    expect(prompt).not.toContain("Error");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — general structure
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — general structure", () => {
  /**
   * Objective: the env block is always present in the output.
   * Positive test: even with no workspace, the env block appears.
   */
  it("[positive] always includes the env block", async () => {
    const ctx = makeCtx({ instanceSlug: "my-instance", channel: "telegram" });

    const prompt = await buildSystemPrompt(ctx);

    expect(prompt).toContain("<env>");
    expect(prompt).toContain("Instance: my-instance");
    expect(prompt).toContain("Channel: telegram");
  });

  /**
   * Objective: the behavior block is always present.
   * Positive test: BEHAVIOR_BLOCK appears in every prompt.
   */
  it("[positive] always includes the behavior block", async () => {
    const ctx = makeCtx();

    const prompt = await buildSystemPrompt(ctx);

    expect(prompt).toContain("<behavior>");
    expect(prompt).toContain("</behavior>");
  });

  /**
   * Objective: inline systemPrompt takes priority over workspace discovery.
   * Negative test: if systemPrompt is set, workspace files must NOT be read.
   */
  it("[negative] inline systemPrompt takes priority — workspace files not read", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace exists with content
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nWorkspace soul.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ systemPrompt: "You are a custom assistant." }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: inline prompt present, workspace content absent
    expect(prompt).toContain("You are a custom assistant.");
    expect(prompt).not.toContain("Workspace soul.");
  });
});

// ---------------------------------------------------------------------------
// BOOTSTRAP.md one-shot (Phase 1c)
// ---------------------------------------------------------------------------

describe("BOOTSTRAP.md one-shot", () => {
  /**
   * Objective: on the first session (no workspace-state.json), BOOTSTRAP.md content
   * must be injected into the prompt AND writeFileSync must be called with bootstrapDone: true.
   *
   * [positive] première session : BOOTSTRAP.md injecté + writeFileSync appelé avec bootstrapDone: true
   */
  it("[positive] première session : BOOTSTRAP.md injecté + writeFileSync appelé avec bootstrapDone: true", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;

    // Arrange: workspace exists, BOOTSTRAP.md present with real content (>1 line)
    // workspace-state.json absent → readFileSync throws → empty state
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return false; // .claw-pilot dir does not exist yet
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nThis is the bootstrap content.\nLine 3.";
      // workspace-state.json absent → throw
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: BOOTSTRAP.md content injected
    expect(prompt).toContain("This is the bootstrap content.");

    // Assert: writeFileSync called at least once for workspace-state.json with bootstrapDone: true
    // (a second call may occur for bootstrap-history.md archiving)
    expect(mockWriteFileSync).toHaveBeenCalled();
    const stateCall = mockWriteFileSync.mock.calls.find(([p]) => p === statePath);
    expect(stateCall).toBeDefined();
    const [, writtenData] = stateCall!;
    const parsed = JSON.parse(writtenData as string) as { bootstrapDone: boolean };
    expect(parsed.bootstrapDone).toBe(true);
  });

  /**
   * Objective: on the second session (bootstrapDone: true in state), BOOTSTRAP.md
   * must NOT be injected even if the file still exists.
   *
   * [positive] deuxième session (bootstrapDone=true dans state) : BOOTSTRAP.md non injecté
   */
  it("[positive] deuxième session (bootstrapDone=true dans state) : BOOTSTRAP.md non injecté", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;

    // Arrange: workspace exists, BOOTSTRAP.md present, state has bootstrapDone: true
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nThis is the bootstrap content.\nLine 3.";
      if (p === statePath) return JSON.stringify({ bootstrapDone: true });
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: BOOTSTRAP.md content NOT injected (already done)
    expect(prompt).not.toContain("This is the bootstrap content.");

    // Assert: writeFileSync NOT called (no state update needed)
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  /**
   * Objective: when workspace-state.json is absent (readFileSync throws),
   * the state is treated as empty → BOOTSTRAP.md must be injected.
   *
   * [negative] workspace-state.json absent → BOOTSTRAP.md injecté (readFileSync throw → état vide)
   */
  it("[negative] workspace-state.json absent → BOOTSTRAP.md injecté (readFileSync throw → état vide)", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const stateDir = `${wsDir}/.claw-pilot`;

    // Arrange: workspace exists, BOOTSTRAP.md present, state file absent
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nBootstrap content for first session.\nLine 3.";
      // All other reads (including state file) throw
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: BOOTSTRAP.md injected because state was empty
    expect(prompt).toContain("Bootstrap content for first session.");
  });

  /**
   * Objective: when workspace-state.json contains invalid JSON, the state is
   * treated as empty → BOOTSTRAP.md must be injected (safe degradation).
   *
   * [negative] workspace-state.json corrompu (JSON invalide) → BOOTSTRAP.md injecté
   */
  it("[negative] workspace-state.json corrompu (JSON invalide) → BOOTSTRAP.md injecté", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;

    // Arrange: workspace exists, BOOTSTRAP.md present, state file contains invalid JSON
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nBootstrap content corrupted state.\nLine 3.";
      if (p === statePath) return "{ invalid json !!!";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: BOOTSTRAP.md injected because JSON.parse failed → empty state
    expect(prompt).toContain("Bootstrap content corrupted state.");
  });

  /**
   * Objective: a BOOTSTRAP.md that is a stub (only 1 line, e.g. "# titre") must
   * NOT be injected and writeFileSync must NOT be called (bootstrapDone stays unset).
   *
   * [negative] BOOTSTRAP.md stub (1 ligne) → non injecté, writeFileSync non appelé
   */
  it("[negative] BOOTSTRAP.md stub (1 ligne) → non injecté, writeFileSync non appelé", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const stateDir = `${wsDir}/.claw-pilot`;

    // Arrange: workspace exists, BOOTSTRAP.md is a stub (single line)
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`) return "# Bootstrap";
      // State file absent
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: stub content NOT injected (single-line stub is filtered out)
    expect(prompt).not.toContain("# Bootstrap");

    // Assert: writeFileSync NOT called (no successful injection → bootstrapDone not set)
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// bootstrapFiles (Phase 1b)
// ---------------------------------------------------------------------------

describe("bootstrapFiles", () => {
  /**
   * Objective: a file listed in bootstrapFiles (exact path) must be loaded
   * and appear in the prompt after DISCOVERY_FILES content.
   *
   * [positive] fichier exact chargé après DISCOVERY_FILES
   */
  it("[positive] fichier exact chargé après DISCOVERY_FILES", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace exists, SOUL.md present, project-context.md present
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content.\nLine 3.";
      if (p === `${wsDir}/project-context.md`)
        return "# Project Context\nProject context content.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({
        id: "agent1",
        bootstrapFiles: ["project-context.md"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: both SOUL.md and project-context.md content present
    expect(prompt).toContain("Soul content.");
    expect(prompt).toContain("Project context content.");

    // Assert: project-context.md appears AFTER SOUL.md in the prompt
    const soulIdx = prompt.indexOf("Soul content.");
    const ctxIdx = prompt.indexOf("Project context content.");
    expect(ctxIdx).toBeGreaterThan(soulIdx);
  });

  /**
   * Objective: a glob pattern like "docs/*.md" must load all matching files
   * in alphabetical order.
   *
   * [positive] glob docs/*.md → plusieurs fichiers chargés en ordre alphabétique
   */
  it("[positive] glob docs/*.md → plusieurs fichiers chargés en ordre alphabétique", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;
    const docsDir = `${wsDir}/docs`;

    // Arrange: workspace exists, docs/ directory with multiple .md files
    // readdirSync must return the files for the glob expansion
    const { readdirSync } = await import("node:fs");
    vi.mocked(readdirSync).mockImplementation((p) => {
      if (p === docsDir)
        return ["zebra.md", "alpha.md", "beta.md"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === docsDir) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content.\nLine 3.";
      if (p === `${docsDir}/alpha.md`) return "# Alpha\nAlpha doc content.\nLine 3.";
      if (p === `${docsDir}/beta.md`) return "# Beta\nBeta doc content.\nLine 3.";
      if (p === `${docsDir}/zebra.md`) return "# Zebra\nZebra doc content.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({
        id: "agent1",
        bootstrapFiles: ["docs/*.md"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: all three docs present
    expect(prompt).toContain("Alpha doc content.");
    expect(prompt).toContain("Beta doc content.");
    expect(prompt).toContain("Zebra doc content.");

    // Assert: alphabetical order (alpha < beta < zebra)
    const alphaIdx = prompt.indexOf("Alpha doc content.");
    const betaIdx = prompt.indexOf("Beta doc content.");
    const zebraIdx = prompt.indexOf("Zebra doc content.");
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(zebraIdx);
  });

  /**
   * Objective: when a file listed in bootstrapFiles does not exist, it must be
   * silently ignored and the prompt must still be built normally.
   *
   * [negative] fichier absent → ignoré silencieusement, prompt construit normalement
   */
  it("[negative] fichier absent → ignoré silencieusement, prompt construit normalement", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace exists, SOUL.md present, missing-file.md absent
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content.\nLine 3.";
      // missing-file.md throws ENOENT
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({
        id: "agent1",
        bootstrapFiles: ["missing-file.md"],
      }),
    });

    // Act: must not throw
    const prompt = await buildSystemPrompt(ctx);

    // Assert: prompt built normally with SOUL.md content
    expect(prompt).toContain("Soul content.");
    expect(prompt).toContain("<env>");
    // Assert: no error content injected
    expect(prompt).not.toContain("missing-file");
  });

  /**
   * Objective: a path traversal pattern like "../../etc/passwd" must be blocked
   * by the guard (absPath.startsWith(wsDir + "/")) and NOT injected.
   *
   * [negative] path traversal ../../etc/passwd → non injecté
   */
  it("[negative] path traversal ../../etc/passwd → non injecté", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace exists, SOUL.md present
    // The traversal path resolves to /etc/passwd (outside wsDir)
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content.\nLine 3.";
      if (p === "/etc/passwd") return "root:x:0:0:root:/root:/bin/bash\nline2\nline3";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({
        id: "agent1",
        bootstrapFiles: ["../../etc/passwd"],
      }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: /etc/passwd content NOT injected (path traversal blocked)
    expect(prompt).not.toContain("root:x:0:0:root");
    // Assert: normal content still present
    expect(prompt).toContain("Soul content.");
  });

  /**
   * Objective: when bootstrapFiles is absent, the prompt must be identical to V1
   * behaviour (no regression — only DISCOVERY_FILES are loaded).
   *
   * [positive] bootstrapFiles absent → comportement identique à V1 (pas de régression)
   */
  it("[positive] bootstrapFiles absent → comportement identique à V1 (pas de régression)", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/agent1`;

    // Arrange: workspace exists, SOUL.md present, no bootstrapFiles configured
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/SOUL.md`) return "# Soul\nSoul content V1.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctxWithBootstrap = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "agent1" }), // no bootstrapFiles
    });

    // Act
    const prompt = await buildSystemPrompt(ctxWithBootstrap);

    // Assert: SOUL.md content present (V1 behaviour preserved)
    expect(prompt).toContain("Soul content V1.");
    // Assert: env block present (structure intact)
    expect(prompt).toContain("<env>");
    expect(prompt).toContain("<behavior>");
  });
});

// ---------------------------------------------------------------------------
// agent_identity block (PLAN-15a Phase 0)
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — agent_identity block", () => {
  // All built-ins are now hidden subagents — tests in this suite need a primary user agent
  beforeEach(() => {
    initAgentRegistry([
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-5",
        permissions: [],
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "executor",
        isDefault: true,
      },
    ]);
  });

  /**
   * Objective: a primary agent with a workDir must have the <agent_identity> block
   * injected at the start of the system prompt.
   *
   * [positive] agent kind="primary" → bloc <agent_identity> présent en début de prompt
   */
  it("[positive] agent kind='primary' → <agent_identity> block present at start of prompt", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;

    // Arrange: registry has built-in agents (build is kind="primary")
    // workspace directory exists so the identity block is triggered
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: <agent_identity> block is present
    expect(prompt).toContain("<agent_identity>");
    expect(prompt).toContain("</agent_identity>");

    // Assert: block appears before the env block (injected at start)
    const identityIdx = prompt.indexOf("<agent_identity>");
    const envIdx = prompt.indexOf("<env>");
    expect(identityIdx).toBeLessThan(envIdx);
  });

  /**
   * Objective: a subagent must NOT have the <agent_identity> block.
   * Subagents are ephemeral tools — they don't need a stable identity.
   *
   * [negative] agent kind="subagent" → bloc <agent_identity> absent
   */
  it("[negative] agent kind='subagent' → <agent_identity> block absent", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/explore`;

    // Arrange: explore agent is kind="subagent"
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "explore", name: "explore" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: <agent_identity> block must NOT be present for subagents
    expect(prompt).not.toContain("<agent_identity>");
  });

  /**
   * Objective: the <agent_identity> block must contain all required fields.
   *
   * [positive] bloc contient Name:, ID:, Born:, Instance:, Channel:, Runtime:
   */
  it("[positive] <agent_identity> block contains Name:, ID:, Born:, Instance:, Channel:, Runtime:", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;

    // Arrange
    mockExistsSync.mockImplementation((p) => p === wsDir);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      instanceSlug: "my-instance",
      channel: "telegram",
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: all required fields present
    expect(prompt).toContain("Name:");
    expect(prompt).toContain("ID:");
    expect(prompt).toContain("Born:");
    expect(prompt).toContain("Instance:");
    expect(prompt).toContain("Channel:");
    expect(prompt).toContain("Runtime:");
  });

  /**
   * Objective: when agentCreatedAt is absent from workspace-state, Born must show "inconnue".
   *
   * [positive] agentCreatedAt absent → Born: inconnue
   */
  it("[positive] agentCreatedAt absent in workspace-state → Born: inconnue", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;

    // Arrange: workspace exists, state file has no agentCreatedAt
    mockExistsSync.mockImplementation((p) => p === wsDir || p === stateDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === statePath) return JSON.stringify({ bootstrapDone: true });
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: Born shows "inconnue" when agentCreatedAt is absent
    expect(prompt).toContain("Born: inconnue");
  });

  /**
   * Objective: when agentCreatedAt is present in workspace-state, Born must show
   * the formatted date (not "inconnue").
   *
   * [positive] agentCreatedAt présent → Born: affiche la date formatée
   */
  it("[positive] agentCreatedAt present in workspace-state → Born: shows formatted date", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;

    // Arrange: workspace exists, state file has agentCreatedAt
    const createdAt = "2025-01-15T10:00:00.000Z";
    mockExistsSync.mockImplementation((p) => p === wsDir || p === stateDir);
    mockReadFileSync.mockImplementation((p) => {
      if (p === statePath)
        return JSON.stringify({ bootstrapDone: true, agentCreatedAt: createdAt });
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: Born must NOT show "inconnue" — it shows the formatted date
    expect(prompt).not.toContain("Born: inconnue");
    // The date is formatted via toLocaleDateString("fr-FR") — verify it contains a year
    expect(prompt).toMatch(/Born: .+2025/);
  });

  /**
   * Objective: when workDir is undefined, the <agent_identity> block must NOT be injected
   * even for a primary agent (no workspace = no identity context).
   *
   * [negative] workDir absent → bloc <agent_identity> absent même pour primary
   */
  it("[negative] workDir absent → <agent_identity> block absent even for primary agent", async () => {
    // Arrange: no workDir
    const ctx = makeCtx({
      workDir: undefined,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    const prompt = await buildSystemPrompt(ctx);

    // Assert: no identity block without workDir
    expect(prompt).not.toContain("<agent_identity>");
  });
});

// ---------------------------------------------------------------------------
// archiveBootstrapContent (PLAN-15a Phase 0)
// ---------------------------------------------------------------------------

describe("archiveBootstrapContent — memory/bootstrap-history.md", () => {
  // All built-ins are now hidden subagents — tests in this suite need a primary user agent
  beforeEach(() => {
    initAgentRegistry([
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-5",
        permissions: [],
        maxSteps: 20,
        allowSubAgents: true,
        toolProfile: "executor",
        isDefault: true,
      },
    ]);
  });

  /**
   * Objective: on the first session, after BOOTSTRAP.md is injected,
   * writeFileSync must be called for memory/bootstrap-history.md with the bootstrap content.
   *
   * [positive] archiveBootstrapContent crée memory/bootstrap-history.md avec le contenu BOOTSTRAP.md
   */
  it("[positive] first session: writeFileSync called for memory/bootstrap-history.md", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const historyPath = `${wsDir}/memory/bootstrap-history.md`;

    // Arrange: workspace exists, BOOTSTRAP.md present with real content (>1 line)
    // workspace-state.json absent → bootstrapDone is false → BOOTSTRAP.md injected
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nThis is the bootstrap content to archive.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    await buildSystemPrompt(ctx);

    // Assert: writeFileSync called for bootstrap-history.md
    const historyCall = mockWriteFileSync.mock.calls.find(([p]) => p === historyPath);
    expect(historyCall).toBeDefined();

    // Assert: the written content contains the bootstrap content
    const [, writtenData] = historyCall!;
    expect(writtenData as string).toContain("This is the bootstrap content to archive.");
  });

  /**
   * Objective: the bootstrap-history.md entry must contain a timestamp header.
   *
   * [positive] bootstrap-history.md contient un header avec timestamp
   */
  it("[positive] bootstrap-history.md entry contains a timestamp header", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const historyPath = `${wsDir}/memory/bootstrap-history.md`;

    // Arrange
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`) return "# Bootstrap\nContent to archive.\nLine 3.";
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    await buildSystemPrompt(ctx);

    // Assert: history entry contains the "Bootstrap completed:" timestamp header
    const historyCall = mockWriteFileSync.mock.calls.find(([p]) => p === historyPath);
    expect(historyCall).toBeDefined();
    const [, writtenData] = historyCall!;
    expect(writtenData as string).toContain("## Bootstrap completed:");
  });

  /**
   * Objective: when bootstrapDone is already true, archiveBootstrapContent must NOT
   * be called (BOOTSTRAP.md is not re-injected on subsequent sessions).
   *
   * [negative] bootstrapDone=true → writeFileSync non appelé pour bootstrap-history.md
   */
  it("[negative] bootstrapDone=true → writeFileSync not called for bootstrap-history.md", async () => {
    const workDir = "/workspace";
    const wsDir = `${workDir}/workspaces/main`;
    const stateDir = `${wsDir}/.claw-pilot`;
    const statePath = `${stateDir}/workspace-state.json`;
    const historyPath = `${wsDir}/memory/bootstrap-history.md`;

    // Arrange: bootstrapDone is already true
    mockExistsSync.mockImplementation((p) => {
      if (p === wsDir) return true;
      if (p === stateDir) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      if (p === `${wsDir}/BOOTSTRAP.md`)
        return "# Bootstrap\nContent that should not be archived again.\nLine 3.";
      if (p === statePath) return JSON.stringify({ bootstrapDone: true });
      throw new Error("ENOENT");
    });

    const ctx = makeCtx({
      workDir,
      agentConfig: makeAgentConfig({ id: "main", name: "Main" }),
    });

    // Act
    await buildSystemPrompt(ctx);

    // Assert: writeFileSync must NOT be called for bootstrap-history.md
    const historyCall = mockWriteFileSync.mock.calls.find(([p]) => p === historyPath);
    expect(historyCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// teammates block — archetype routing hints
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — teammates block with archetypes", () => {
  it("omits teammates block when only one agent is present", async () => {
    const ctx = makeCtx({
      runtimeAgents: [{ id: "pilot", name: "Pilot" }],
      runtimeAgentConfigs: [makeAgentConfig({ id: "pilot", archetype: "planner" })],
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).not.toContain("<teammates>");
  });

  it("includes teammates block when multiple agents are present", async () => {
    const ctx = makeCtx({
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("<teammates>");
    expect(result).toContain("- pilot (Pilot)");
    expect(result).toContain("- dev (Dev)");
  });

  it("marks current agent with [you]", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ id: "pilot" }),
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("- pilot (Pilot) [you]");
    expect(result).toContain("- dev (Dev)");
    expect(result).not.toContain("- dev (Dev) [you]");
  });

  it("annotates agents with their declared archetype when runtimeAgentConfigs provided", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ id: "pilot" }),
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
        { id: "qa", name: "QA" },
      ],
      runtimeAgentConfigs: [
        makeAgentConfig({ id: "pilot" }),
        makeAgentConfig({ id: "dev", archetype: "generator" }),
        makeAgentConfig({ id: "qa", archetype: "evaluator" }),
      ],
    });
    const result = await buildSystemPrompt(ctx);
    // dev should show its archetype
    expect(result).toContain("- dev (Dev) [archetype: generator]");
    // qa should show its archetype
    expect(result).toContain("- qa (QA) [archetype: evaluator]");
    // pilot has no archetype — no archetype marker
    expect(result).toContain("- pilot (Pilot) [you]");
    expect(result).not.toContain("- pilot (Pilot) [archetype:");
  });

  it("includes archetype routing hint when at least one agent has archetype", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ id: "pilot" }),
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
      runtimeAgentConfigs: [
        makeAgentConfig({ id: "pilot" }),
        makeAgentConfig({ id: "dev", archetype: "generator" }),
      ],
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("route by archetype");
    expect(result).toContain("subagent_type");
  });

  it("omits archetype routing hint when no agent has archetype", async () => {
    const ctx = makeCtx({
      agentConfig: makeAgentConfig({ id: "pilot" }),
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
      runtimeAgentConfigs: [makeAgentConfig({ id: "pilot" }), makeAgentConfig({ id: "dev" })],
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("<teammates>");
    expect(result).not.toContain("route by archetype");
  });

  it("handles missing runtimeAgentConfigs gracefully (no archetype annotations)", async () => {
    const ctx = makeCtx({
      runtimeAgents: [
        { id: "pilot", name: "Pilot" },
        { id: "dev", name: "Dev" },
      ],
      // runtimeAgentConfigs intentionally omitted
    });
    const result = await buildSystemPrompt(ctx);
    expect(result).toContain("<teammates>");
    expect(result).not.toContain("[archetype:");
    expect(result).not.toContain("route by skill");
  });
});
