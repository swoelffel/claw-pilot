// src/runtime/engine/__tests__/task-wiring.test.ts
//
// Tests for TaskAssigned bus → agent notification wiring.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../../../db/schema.js";
import { Registry } from "../../../core/registry.js";
import { getBus, disposeBus } from "../../bus/index.js";
import { TaskAssigned, SessionStatusChanged } from "../../bus/events.js";
import { wireTaskNotifications } from "../task-wiring.js";
import { createTask } from "../../../core/repositories/task-repository.js";
import type { InstanceSlug } from "../../types.js";
import type { RuntimeConfig } from "../../config/index.js";

// Mock prompt loop and session/message modules
vi.mock("../../session/prompt-loop.js", () => ({
  runPromptLoop: vi.fn().mockResolvedValue({
    text: "ok",
    steps: 1,
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
  }),
}));

vi.mock("../../session/session.js", () => ({
  getOrCreatePermanentSession: vi.fn().mockReturnValue({
    id: "perm-sess-builder",
    agentId: "builder",
    state: "active",
  }),
}));

vi.mock("../../session/message.js", () => ({
  createUserMessage: vi.fn().mockReturnValue({ id: "msg-1", role: "user" }),
}));

vi.mock("../../channel/router.js", () => ({
  resolveModelForAgent: vi.fn().mockReturnValue({
    providerId: "anthropic",
    modelId: "claude-3.5-sonnet",
    apiKey: "test-key",
  }),
}));

// Get references to mocked functions
const { runPromptLoop } = await import("../../session/prompt-loop.js");
const { createUserMessage } = await import("../../session/message.js");
const { getOrCreatePermanentSession } = await import("../../session/session.js");

let tmpDir: string;
let db: ReturnType<typeof initDatabase>;
const SLUG = "test-inst" as InstanceSlug;

const minimalConfig: RuntimeConfig = {
  agents: [
    {
      id: "pilot",
      name: "Pilot Agent",
      model: "claude-3.5-sonnet",
      prompt: "",
      tools: [],
      mcpServers: [],
    },
    {
      id: "builder",
      name: "Builder Agent",
      model: "claude-3.5-sonnet",
      prompt: "",
      tools: [],
      mcpServers: [],
    },
  ],
  mcpEnabled: false,
  mcpServers: [],
} as unknown as RuntimeConfig;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-task-wiring-"));
  db = initDatabase(path.join(tmpDir, "test.db"));
  const registry = new Registry(db);
  const server = registry.upsertLocalServer("testhost", "/opt/claw");
  registry.createInstance({
    serverId: server.id,
    slug: SLUG,
    port: 18789,
    configPath: "/tmp/cfg",
    stateDir: "/tmp/state",
    systemdUnit: "claw-test",
  });
  vi.clearAllMocks();
});

afterEach(() => {
  disposeBus(SLUG);
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("wireTaskNotifications", () => {
  it("injects a message and triggers prompt loop on TaskAssigned", () => {
    const unsub = wireTaskNotifications({
      db,
      instanceSlug: SLUG,
      config: minimalConfig,
      workDir: undefined,
    });
    const bus = getBus(SLUG);

    // Create a task to assign
    const task = createTask(db, {
      instanceSlug: SLUG,
      title: "Implement caching",
      createdBy: "pilot",
    });

    bus.publish(TaskAssigned, {
      instanceSlug: SLUG,
      taskId: task.id,
      assigneeId: "builder",
      assignedBy: "pilot",
    });

    expect(getOrCreatePermanentSession).toHaveBeenCalledWith(db, {
      instanceSlug: SLUG,
      agentId: "builder",
      channel: "internal",
    });
    expect(createUserMessage).toHaveBeenCalledOnce();
    const msgText = (createUserMessage as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .text as string;
    expect(msgText).toContain("[task_assigned:#");
    expect(msgText).toContain("Implement caching");
    expect(msgText).toContain("task_board");

    // Prompt loop should be triggered (session not busy)
    expect(runPromptLoop).toHaveBeenCalledOnce();

    unsub();
  });

  it("skips notification on self-assignment", () => {
    const unsub = wireTaskNotifications({
      db,
      instanceSlug: SLUG,
      config: minimalConfig,
      workDir: undefined,
    });
    const bus = getBus(SLUG);

    const task = createTask(db, {
      instanceSlug: SLUG,
      title: "Self task",
      createdBy: "builder",
    });

    bus.publish(TaskAssigned, {
      instanceSlug: SLUG,
      taskId: task.id,
      assigneeId: "builder",
      assignedBy: "builder",
    });

    expect(createUserMessage).not.toHaveBeenCalled();
    expect(runPromptLoop).not.toHaveBeenCalled();

    unsub();
  });

  it("does not crash when agent is not found in config", () => {
    const unsub = wireTaskNotifications({
      db,
      instanceSlug: SLUG,
      config: minimalConfig,
      workDir: undefined,
    });
    const bus = getBus(SLUG);

    const task = createTask(db, {
      instanceSlug: SLUG,
      title: "Ghost task",
      createdBy: "user",
    });

    // unknown-agent is not in config
    bus.publish(TaskAssigned, {
      instanceSlug: SLUG,
      taskId: task.id,
      assigneeId: "unknown-agent",
      assignedBy: "user",
    });

    expect(createUserMessage).not.toHaveBeenCalled();
    expect(runPromptLoop).not.toHaveBeenCalled();

    unsub();
  });

  it("does not trigger prompt loop when session is busy", () => {
    const unsub = wireTaskNotifications({
      db,
      instanceSlug: SLUG,
      config: minimalConfig,
      workDir: undefined,
    });
    const bus = getBus(SLUG);

    // Mark builder session as busy
    bus.publish(SessionStatusChanged, {
      sessionId: "perm-sess-builder",
      status: "busy",
    });

    const task = createTask(db, {
      instanceSlug: SLUG,
      title: "Busy task",
      createdBy: "pilot",
    });

    bus.publish(TaskAssigned, {
      instanceSlug: SLUG,
      taskId: task.id,
      assigneeId: "builder",
      assignedBy: "pilot",
    });

    // Message should still be injected
    expect(createUserMessage).toHaveBeenCalledOnce();
    // But prompt loop should NOT run
    expect(runPromptLoop).not.toHaveBeenCalled();

    unsub();
  });

  it("stops listening after unsub", () => {
    const unsub = wireTaskNotifications({
      db,
      instanceSlug: SLUG,
      config: minimalConfig,
      workDir: undefined,
    });
    const bus = getBus(SLUG);

    unsub();

    const task = createTask(db, {
      instanceSlug: SLUG,
      title: "Post-unsub task",
      createdBy: "pilot",
    });

    bus.publish(TaskAssigned, {
      instanceSlug: SLUG,
      taskId: task.id,
      assigneeId: "builder",
      assignedBy: "pilot",
    });

    expect(createUserMessage).not.toHaveBeenCalled();
  });
});
