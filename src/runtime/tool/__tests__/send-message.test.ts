/**
 * runtime/tool/__tests__/send-message.test.ts
 *
 * Tests for the send_message tool:
 * - expect_reply=true: messages appear in both sessions, reply returned
 * - expect_reply=false: message in target only + sent trace in caller
 * - Unknown agent → descriptive error
 * - Skill-based routing
 * - A2A policy denial
 * - AgentMessageSent bus event published
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { initDatabase } from "../../../db/schema.js";
import type Database from "better-sqlite3";
import { createSession } from "../../session/session.js";
import { listMessages } from "../../session/message.js";
import { listParts } from "../../session/part.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { AgentMessageSent } from "../../bus/events.js";
import { createSendMessageTool } from "../send-message.js";
import type { Tool } from "../tool.js";
import type { ResolvedModel } from "../../provider/provider.js";
import type { RuntimeAgentConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_SLUG = "test-send-msg";

function seedInstance(db: Database.Database, slug = INSTANCE_SLUG) {
  db.prepare(
    `INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')`,
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT OR IGNORE INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(server.id, slug, 19001, "/tmp/config.json", "/tmp/state", "openclaw-test.service");
}

function makeResolvedModel(): ResolvedModel {
  return {
    languageModel: {} as ResolvedModel["languageModel"],
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    costPerMillion: { input: 3, output: 15 },
  };
}

function makeToolContext(db: Database.Database, sessionId: string): Tool.Context {
  return {
    sessionId,
    messageId: "msg-test",
    agentId: "pilot",
    abort: new AbortController().signal,
    metadata: vi.fn(),
  };
}

const PILOT_CONFIG: RuntimeAgentConfig = {
  id: "pilot",
  name: "Pilot",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "full" as const,
  isDefault: true,
};

const LEAD_TECH_CONFIG: RuntimeAgentConfig = {
  id: "lead-tech",
  name: "Lead Tech",
  model: "anthropic/claude-sonnet-4-5",
  permissions: [],
  maxSteps: 20,
  allowSubAgents: true,
  toolProfile: "full" as const,
  isDefault: false,
  expertIn: ["architecture", "code-review"],
};

function getUserMessageTexts(db: Database.Database, sessionId: string): string[] {
  const messages = listMessages(db, sessionId).filter((m) => m.role === "user");
  const texts: string[] = [];
  for (const msg of messages) {
    const parts = listParts(db, msg.id);
    for (const part of parts) {
      if (part.type === "text" && part.content) {
        texts.push(part.content);
      }
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(":memory:");
  seedInstance(db);
  disposeBus(INSTANCE_SLUG);
});

afterEach(() => {
  db.close();
  disposeBus(INSTANCE_SLUG);
});

// ---------------------------------------------------------------------------
// expect_reply = true
// ---------------------------------------------------------------------------

describe("send_message — expect_reply=true", () => {
  it("sends message and returns reply, both sessions have traces", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      text: "I recommend WebSocket ping/pong",
      steps: 1,
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    });

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    const result = await def.execute(
      { to: "lead-tech", message: "What heartbeat arch?", expect_reply: true },
      ctx,
    );

    // Assert: reply content
    expect(result.output).toContain("I recommend WebSocket ping/pong");
    expect(result.output).toContain("<reply>");

    // Assert: caller session has [message_sent] and [message_received]
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    expect(callerTexts.some((t) => t.includes("[message_sent]") && t.includes("lead-tech"))).toBe(
      true,
    );
    expect(
      callerTexts.some((t) => t.includes("[message_received]") && t.includes("WebSocket")),
    ).toBe(true);

    // Assert: target session has the message
    const targetSessionKey = `${INSTANCE_SLUG}:lead-tech`;
    const targetSession = db
      .prepare("SELECT id FROM rt_sessions WHERE session_key = ?")
      .get(targetSessionKey) as { id: string } | undefined;
    expect(targetSession).toBeDefined();

    // runPromptLoop was called with the message as userText
    expect(mockRunPromptLoop).toHaveBeenCalledOnce();
    const call = mockRunPromptLoop.mock.calls[0]![0] as { userText: string; sessionId: string };
    expect(call.userText).toContain("What heartbeat arch?");
    expect(call.sessionId).toBe(targetSession!.id);
  });
});

// ---------------------------------------------------------------------------
// expect_reply = false (fire-and-forget)
// ---------------------------------------------------------------------------

describe("send_message — expect_reply=false", () => {
  it("delivers message without running prompt loop, caller has sent trace", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn();

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act
    const result = await def.execute(
      { to: "lead-tech", message: "FYI: heartbeat spec updated", expect_reply: false },
      ctx,
    );

    // Assert: no prompt loop called
    expect(mockRunPromptLoop).not.toHaveBeenCalled();
    expect(result.output).toContain("fire-and-forget");

    // Assert: caller has [message_sent]
    const callerTexts = getUserMessageTexts(db, callerSession.id);
    expect(callerTexts.some((t) => t.includes("[message_sent]"))).toBe(true);

    // Assert: target session has the message
    const targetSessionKey = `${INSTANCE_SLUG}:lead-tech`;
    const targetSession = db
      .prepare("SELECT id FROM rt_sessions WHERE session_key = ?")
      .get(targetSessionKey) as { id: string } | undefined;
    expect(targetSession).toBeDefined();

    const targetTexts = getUserMessageTexts(db, targetSession!.id);
    expect(targetTexts.some((t) => t.includes("heartbeat spec updated"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown agent
// ---------------------------------------------------------------------------

describe("send_message — error cases", () => {
  it("throws descriptive error for unknown agent", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: vi.fn(),
    });
    const def = await toolInfo.init();

    await expect(
      def.execute({ to: "nonexistent", message: "hello", expect_reply: true }, ctx),
    ).rejects.toThrow(/No agent found for "nonexistent"/);
  });

  it("throws when A2A policy denies the target agent", async () => {
    const restrictedPilot: RuntimeAgentConfig = {
      ...PILOT_CONFIG,
      agentToAgent: { enabled: true, allowList: ["other-agent"] },
    };
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: restrictedPilot,
      runtimeAgentConfigs: [restrictedPilot, LEAD_TECH_CONFIG],
      runPromptLoop: vi.fn(),
    });
    const def = await toolInfo.init();

    await expect(
      def.execute({ to: "lead-tech", message: "hello", expect_reply: true }, ctx),
    ).rejects.toThrow(/not allowed/);
  });
});

// ---------------------------------------------------------------------------
// Skill-based routing
// ---------------------------------------------------------------------------

describe("send_message — skill routing", () => {
  it("routes by skill name when no exact agent ID match", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);

    const mockRunPromptLoop = vi.fn().mockResolvedValue({
      text: "architecture advice here",
      steps: 1,
      tokens: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 },
    });

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: mockRunPromptLoop,
    });
    const def = await toolInfo.init();

    // Act: route by skill "architecture" → should resolve to lead-tech
    const result = await def.execute(
      { to: "architecture", message: "Need arch advice", expect_reply: true },
      ctx,
    );

    expect(result.output).toContain("architecture advice here");

    // Verify it called prompt loop with lead-tech's session
    const call = mockRunPromptLoop.mock.calls[0]![0] as { agentConfig: { id: string } };
    expect(call.agentConfig.id).toBe("lead-tech");
  });
});

// ---------------------------------------------------------------------------
// Bus event
// ---------------------------------------------------------------------------

describe("send_message — bus event", () => {
  it("publishes AgentMessageSent event", async () => {
    const callerSession = createSession(db, {
      instanceSlug: INSTANCE_SLUG,
      agentId: "pilot",
      persistent: true,
    });
    const ctx = makeToolContext(db, callerSession.id);
    const bus = getBus(INSTANCE_SLUG);

    let capturedEvent: unknown;
    bus.subscribe(AgentMessageSent, (payload) => {
      capturedEvent = payload;
    });

    const toolInfo = createSendMessageTool({
      db,
      instanceSlug: INSTANCE_SLUG,
      resolvedModel: makeResolvedModel(),
      workDir: undefined,
      callerAgentConfig: PILOT_CONFIG,
      runtimeAgentConfigs: [PILOT_CONFIG, LEAD_TECH_CONFIG],
      runPromptLoop: vi.fn().mockResolvedValue({
        text: "ok",
        steps: 1,
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      }),
    });
    const def = await toolInfo.init();

    await def.execute({ to: "lead-tech", message: "test", expect_reply: true }, ctx);

    expect(capturedEvent).toBeDefined();
    const event = capturedEvent as {
      fromAgentId: string;
      toAgentId: string;
      expectReply: boolean;
    };
    expect(event.fromAgentId).toBe("pilot");
    expect(event.toAgentId).toBe("lead-tech");
    expect(event.expectReply).toBe(true);
  });
});
