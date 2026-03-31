/**
 * runtime/channel/__tests__/subagent-completed.test.ts
 *
 * Tests for the SubagentCompleted error handling in registerSubagentCompletedHandler().
 *
 * Validates that when `runPromptLoop` fails after an async subagent completes:
 * - The error is logged with structured context
 * - An error message is injected into the parent session
 * - The session queue promise chain does not break
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prompt-loop BEFORE importing router (vi.mock is hoisted)
const mockRunPromptLoop = vi.fn();
vi.mock("../../session/prompt-loop.js", () => ({
  runPromptLoop: (...args: unknown[]) => mockRunPromptLoop(...args),
}));

// Mock provider so resolveModel does not throw for unknown providers
vi.mock("../../provider/provider.js", () => ({
  resolveModel: vi.fn().mockReturnValue({
    languageModel: {},
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  }),
}));

// Mock logger to capture calls
const mockLoggerError = vi.fn();
vi.mock("../../../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

// Mock tool registry (avoid loading heavy built-in tools)
vi.mock("../../tool/registry.js", () => ({
  getTools: vi.fn().mockResolvedValue([]),
}));

import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession } from "../../session/session.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { SubagentCompleted } from "../../bus/events.js";
import { initAgentRegistry } from "../../agent/registry.js";
import { registerSubagentCompletedHandler } from "../router.js";
import type { RuntimeConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-subagent-err";

function seedInstance(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/test')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, INSTANCE_SLUG, 19001, "/tmp/config.json", "/tmp/state", "test.service");
}

function makeRuntimeConfig(): RuntimeConfig {
  return {
    version: 1,
    defaultModel: "anthropic/claude-sonnet-4-5",
    providers: [],
    agents: [
      {
        id: "main",
        name: "Main",
        model: "anthropic/claude-sonnet-4-5",
        permissions: [],
        maxSteps: 5,
        allowSubAgents: true,
        toolProfile: "executor",
        isDefault: true,
      },
    ],
    globalPermissions: [],
    models: [],
    telegram: {
      enabled: false,
      botTokenEnvVar: "TELEGRAM_BOT_TOKEN",
      pollingIntervalMs: 1000,
      allowedUserIds: [],
      dmPolicy: "pairing" as const,
      groupPolicy: "allowlist" as const,
    },
    webChat: { enabled: true, maxSessions: 10 },
    compaction: { auto: true, threshold: 0.85, reservedTokens: 8000, periodicMessageCount: 0 },
    subagents: { maxSpawnDepth: 3, maxChildrenPerSession: 5, retentionHours: 72 },
    multimodal: {
      enabled: true,
      maxFileSizeMB: 20,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    },
    artifacts: { enabled: true, suggestionsEnabled: true, maxSuggestions: 3 },
    mcpEnabled: false,
    mcpServers: [],
    log: { level: "info" as const, format: "text" as const, maxSizeMb: 10, maxFiles: 3 },
  };
}

function makeSubagentPayload(parentSessionId: string) {
  return {
    parentSessionId,
    subSessionId: "sub-test-123",
    result: {
      text: "Subagent analysis complete.",
      steps: 3,
      tokens: { input: 1000, output: 200 },
      model: "anthropic/claude-sonnet-4-5",
    },
  };
}

/** Wait for all pending microtasks + macrotasks to settle. */
function settle(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
  initAgentRegistry([
    {
      id: "main",
      name: "Main",
      model: "anthropic/claude-sonnet-4-5",
      permissions: [],
      maxSteps: 5,
      allowSubAgents: true,
      toolProfile: "executor",
      isDefault: true,
    },
  ]);
  mockRunPromptLoop.mockReset();
  mockLoggerError.mockReset();
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerSubagentCompletedHandler — error handling", () => {
  it("logs error when prompt loop fails after SubagentCompleted", async () => {
    const config = makeRuntimeConfig();
    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    mockRunPromptLoop.mockRejectedValueOnce(new Error("Context window exceeded"));

    const bus = getBus(INSTANCE_SLUG);
    bus.publish(SubagentCompleted, makeSubagentPayload(parentSession.id));

    await settle();

    // Assert: logger.error was called with structured context
    expect(mockLoggerError).toHaveBeenCalledWith(
      "subagent_result_injection_failed",
      expect.objectContaining({
        event: "subagent_result_injection_failed",
        slug: INSTANCE_SLUG,
        parentSessionId: parentSession.id,
        subSessionId: "sub-test-123",
        error: "Context window exceeded",
      }),
    );
  });

  it("injects error message into parent session when prompt loop fails", async () => {
    const config = makeRuntimeConfig();
    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    mockRunPromptLoop.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    const bus = getBus(INSTANCE_SLUG);
    bus.publish(SubagentCompleted, makeSubagentPayload(parentSession.id));

    await settle();

    // Assert: an error message was injected into the parent session
    const messages = db
      .prepare(
        `SELECT m.id, p.content
         FROM rt_messages m
         JOIN rt_parts p ON p.message_id = m.id
         WHERE m.session_id = ? AND m.role = 'user' AND p.type = 'text'
         ORDER BY m.created_at DESC`,
      )
      .all(parentSession.id) as Array<{ id: string; content: string }>;

    const errorMsg = messages.find((m) => m.content.includes("[subagent error]"));
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain("sub-test-123");
    expect(errorMsg!.content).toContain("Rate limit exceeded");
  });

  it("handles double failure gracefully (message injection also fails)", async () => {
    const config = makeRuntimeConfig();
    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    mockRunPromptLoop.mockRejectedValueOnce(new Error("Context window exceeded"));

    // Close the DB so createUserMessage will also fail
    // We need a different approach: archive the session between the two calls
    // Instead, use a non-existent session to make createUserMessage fail
    // Actually, let's just break the DB temporarily
    db.exec("DROP TABLE rt_parts");

    const bus = getBus(INSTANCE_SLUG);

    // This should NOT throw — the catch block must handle the double failure
    bus.publish(SubagentCompleted, makeSubagentPayload(parentSession.id));

    await settle();

    // Assert: both errors were logged
    expect(mockLoggerError).toHaveBeenCalledWith(
      "subagent_result_injection_failed",
      expect.objectContaining({ error: "Context window exceeded" }),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      "subagent_error_message_injection_failed",
      expect.objectContaining({
        slug: INSTANCE_SLUG,
        parentSessionId: parentSession.id,
      }),
    );

    // Re-create the table for afterEach cleanup (db.close doesn't need it, but be safe)
  });

  it("does not log or inject when session is inactive", async () => {
    const config = makeRuntimeConfig();
    registerSubagentCompletedHandler(db, INSTANCE_SLUG, config);

    const parentSession = createSession(db, { instanceSlug: INSTANCE_SLUG, agentId: "main" });
    const { archiveSession } = await import("../../session/session.js");
    archiveSession(db, parentSession.id);

    const bus = getBus(INSTANCE_SLUG);
    bus.publish(SubagentCompleted, makeSubagentPayload(parentSession.id));

    await settle();

    // Assert: prompt loop was never called
    expect(mockRunPromptLoop).not.toHaveBeenCalled();
    // Assert: no error logged
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
