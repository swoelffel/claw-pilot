/**
 * runtime/session/__tests__/tool-set-builder.test.ts
 *
 * Unit tests for buildToolSet — the function that converts Tool.Info[]
 * to a Vercel AI SDK ToolSet, wiring doom-loop detection, plugin hooks,
 * ownerOnly filtering, dynamic tool injection, and DB part tracking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { Tool } from "../../tool/tool.js";
import type { RuntimeAgentConfig, RuntimeConfig } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("ai", () => ({
  tool: vi.fn((opts: Record<string, unknown>) => opts),
  zodSchema: vi.fn((s: unknown) => s),
}));

const mockPublish = vi.fn();
vi.mock("../../bus/index.js", () => ({
  getBus: vi.fn(() => ({ publish: mockPublish })),
}));

vi.mock("../part.js", () => ({
  listParts: vi.fn().mockReturnValue([]),
  createPart: vi.fn().mockReturnValue({
    id: "part-1",
    messageId: "msg-1",
    type: "tool_call",
    state: "running",
    content: null,
    metadata: null,
    createdAt: "",
    updatedAt: "",
  }),
  updatePartState: vi.fn(),
}));

vi.mock("../../plugin/hooks.js", () => ({
  triggerToolBeforeCall: vi.fn().mockResolvedValue(undefined),
  triggerToolAfterCall: vi.fn().mockResolvedValue(undefined),
  getRegisteredHooks: vi.fn().mockReturnValue([]),
}));

vi.mock("../../memory/search-tool.js", () => ({
  createMemorySearchTool: vi.fn().mockReturnValue({
    id: "memory_search",
    init: vi.fn().mockResolvedValue({
      description: "Search memory",
      parameters: z.object({ query: z.string() }),
      execute: vi.fn().mockResolvedValue({ title: "memory", output: "found", truncated: false }),
    }),
  }),
}));

vi.mock("../../memory/index.js", () => ({
  rebuildMemoryIndex: vi.fn(),
}));

vi.mock("../../tool/task.js", () => ({
  createTaskTool: vi.fn().mockReturnValue({
    id: "task",
    init: vi.fn().mockResolvedValue({
      description: "Run a sub-task",
      parameters: z.object({ prompt: z.string() }),
      execute: vi.fn().mockResolvedValue({ title: "task", output: "done", truncated: false }),
    }),
  }),
}));

vi.mock("../../tool/send-message.js", () => ({
  createSendMessageTool: vi.fn().mockReturnValue({
    id: "send_message",
    init: vi.fn().mockResolvedValue({
      description: "Send a message",
      parameters: z.object({ to: z.string(), body: z.string() }),
      execute: vi
        .fn()
        .mockResolvedValue({ title: "send_message", output: "sent", truncated: false }),
    }),
  }),
}));

vi.mock("../../tool/normalize.js", () => ({
  normalizeForProvider: vi.fn((params: unknown) => params),
}));

vi.mock("../workspace-cache.js", () => ({
  invalidateWorkspaceCache: vi.fn(),
}));

vi.mock("../system-prompt-dirty.js", () => ({
  markDirty: vi.fn(),
}));

vi.mock("../../../lib/env-reader.js", () => ({
  buildResolvedEnv: vi.fn().mockReturnValue({}),
}));

vi.mock("../../tool/registry.js", () => ({
  TOOL_PROFILES: {
    executor: [
      "read",
      "write",
      "edit",
      "multiedit",
      "bash",
      "glob",
      "grep",
      "webfetch",
      "question",
      "todowrite",
      "todoread",
      "skill",
      "send_message",
      "create_artifact",
      "send_file",
    ],
    manager: [
      "read",
      "write",
      "edit",
      "multiedit",
      "bash",
      "glob",
      "grep",
      "webfetch",
      "question",
      "todowrite",
      "todoread",
      "skill",
      "send_message",
      "task",
      "create_artifact",
      "send_file",
    ],
    pilot: ["question", "webfetch", "send_message", "task", "create_artifact", "send_file"],
    sentinel: ["question"],
  },
}));

// Import the module under test AFTER all mocks are set up
import { buildToolSet } from "../tool-set-builder.js";
import { createPart, listParts, updatePartState } from "../part.js";
import { triggerToolBeforeCall, triggerToolAfterCall } from "../../plugin/hooks.js";
import { invalidateWorkspaceCache } from "../workspace-cache.js";
import { markDirty } from "../system-prompt-dirty.js";
import { DoomLoopDetected, MessageUpdated } from "../../bus/events.js";
import type { ResolvedModel } from "../../provider/provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(id: string, opts?: { ownerOnly?: boolean }): Tool.Info {
  return {
    id,
    init: () => ({
      description: `tool ${id}`,
      parameters: z.object({}),
      ...(opts?.ownerOnly ? { ownerOnly: true } : {}),
      execute: vi.fn().mockResolvedValue({ title: id, output: "ok", truncated: false }),
    }),
  };
}

function makeFailingTool(id: string): Tool.Info {
  return {
    id,
    init: () => ({
      description: `tool ${id}`,
      parameters: z.object({}),
      execute: vi.fn().mockRejectedValue(new Error("tool failed")),
    }),
  };
}

function makeCtx(overrides?: Partial<Tool.Context>): Tool.Context {
  return {
    sessionId: "sess-1",
    messageId: "msg-1",
    agentId: "main",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    senderIsOwner: true,
    ...overrides,
  };
}

const RESOLVED_MODEL = {
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  languageModel: {},
  costPerMillion: { input: 3, output: 15 },
} as unknown as ResolvedModel;

function makeAgentConfig(overrides?: Partial<RuntimeAgentConfig>): RuntimeAgentConfig {
  return {
    id: "main",
    name: "main",
    model: "anthropic/claude-sonnet-4-5",
    permissions: [],
    maxSteps: 5,
    allowSubAgents: false,
    toolProfile: "manager",
    isDefault: true,
    ...overrides,
  };
}

/** Minimal stub DB with a prepare().run() method for the metadata UPDATE */
function makeStubDb(): Database.Database {
  return {
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), all: vi.fn().mockReturnValue([]) }),
  } as unknown as Database.Database;
}

const noopPromptLoop = vi.fn().mockResolvedValue({
  text: "",
  steps: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

// Common args shorthand for buildToolSet
function callBuild(
  tools: Tool.Info[],
  overrides?: {
    ctx?: Partial<Tool.Context>;
    memoryDb?: Database.Database;
    agentConfig?: RuntimeAgentConfig;
    agentKind?: "primary" | "subagent";
    runtimeConfig?: RuntimeConfig;
  },
) {
  const db = makeStubDb();
  const ctx = makeCtx(overrides?.ctx);
  return buildToolSet(
    tools,
    ctx,
    db,
    "msg-1",
    "test-slug",
    "sess-1",
    RESOLVED_MODEL,
    overrides?.memoryDb,
    "/tmp/work",
    overrides?.agentConfig,
    undefined, // subagentsConfig
    undefined, // compactionConfig
    undefined, // pluginInput
    overrides?.agentKind,
    noopPromptLoop,
    undefined, // runtimeAgentConfigs
    overrides?.runtimeConfig,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildToolSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Empty tools → only 'invalid' tool
  it("returns only 'invalid' tool for an empty tools array", async () => {
    const set = await callBuild([]);
    expect(Object.keys(set)).toEqual(["invalid"]);
  });

  // 2. Includes all non-ownerOnly tools
  it("includes all non-ownerOnly tools in the set", async () => {
    const set = await callBuild([makeTool("read"), makeTool("write"), makeTool("bash")]);
    expect(set).toHaveProperty("read");
    expect(set).toHaveProperty("write");
    expect(set).toHaveProperty("bash");
    expect(set).toHaveProperty("invalid");
  });

  // 3. Filters ownerOnly tools when senderIsOwner=false
  it("filters ownerOnly tools when senderIsOwner is false", async () => {
    const set = await callBuild([makeTool("read"), makeTool("secret", { ownerOnly: true })], {
      ctx: { senderIsOwner: false },
    });
    expect(set).toHaveProperty("read");
    expect(set).not.toHaveProperty("secret");
  });

  // 4. Includes ownerOnly tools when senderIsOwner=true
  it("includes ownerOnly tools when senderIsOwner is true", async () => {
    const set = await callBuild([makeTool("read"), makeTool("secret", { ownerOnly: true })], {
      ctx: { senderIsOwner: true },
    });
    expect(set).toHaveProperty("read");
    expect(set).toHaveProperty("secret");
  });

  // 5. Always includes 'invalid' tool
  it("always includes the 'invalid' tool", async () => {
    const set = await callBuild([makeTool("read")]);
    expect(set).toHaveProperty("invalid");
  });

  // 6. 'invalid' tool lists available tool names
  it("'invalid' tool execute returns available tool names", async () => {
    const set = await callBuild([makeTool("read"), makeTool("write")]);
    // The mocked ai.tool returns the opts directly, so set["invalid"].execute exists
    const invalidTool = set["invalid"] as { execute: (args: unknown) => Promise<string> };
    const result = await invalidTool.execute({ toolName: "nonexistent", reason: "not found" });
    expect(result).toContain("read");
    expect(result).toContain("write");
    expect(result).toContain("does not exist");
  });

  // 7. Injects memory_search when memoryDb is provided
  it("injects memory_search when memoryDb is provided", async () => {
    const fakeMemoryDb = makeStubDb();
    const set = await callBuild([], { memoryDb: fakeMemoryDb });
    expect(set).toHaveProperty("memory_search");
  });

  // 8. Does NOT inject memory_search when memoryDb is undefined
  it("does not inject memory_search when memoryDb is undefined", async () => {
    const set = await callBuild([]);
    expect(set).not.toHaveProperty("memory_search");
  });

  // 9. Removes create_artifact when artifacts disabled
  it("removes create_artifact when artifacts.enabled is false", async () => {
    const set = await callBuild([makeTool("create_artifact")], {
      runtimeConfig: { artifacts: { enabled: false } } as RuntimeConfig,
    });
    expect(set).not.toHaveProperty("create_artifact");
  });

  // 10. Tool execution calls triggerToolBeforeCall and triggerToolAfterCall
  it("calls plugin hooks before and after tool execution", async () => {
    const set = await callBuild([makeTool("read")]);
    const readTool = set["read"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await readTool.execute({}, { toolCallId: "tc-1" });

    expect(triggerToolBeforeCall).toHaveBeenCalledOnce();
    expect(triggerToolAfterCall).toHaveBeenCalledOnce();
  });

  // 11. Tool execution updates part state to "completed"
  it("updates part state to 'completed' on successful execution", async () => {
    const set = await callBuild([makeTool("read")]);
    const readTool = set["read"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await readTool.execute({}, { toolCallId: "tc-1" });

    expect(updatePartState).toHaveBeenCalledWith(
      expect.anything(), // db
      "part-1",
      "completed",
      "ok",
    );
  });

  // 12. Tool execution updates part state to "error" on failure
  it("updates part state to 'error' on execution failure", async () => {
    const set = await callBuild([makeFailingTool("badtool")]);
    const badTool = set["badtool"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };

    await expect(badTool.execute({}, { toolCallId: "tc-2" })).rejects.toThrow("tool failed");

    expect(updatePartState).toHaveBeenCalledWith(
      expect.anything(), // db
      "part-1",
      "error",
      "tool failed",
    );
  });

  // 13. Doom loop detection throws after 3 identical calls
  it("throws doom loop error after 3 identical calls", async () => {
    const set = await callBuild([makeTool("read")]);
    const readTool = set["read"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    const args = { filePath: "/tmp/test.txt" };

    // First two calls succeed
    await readTool.execute(args, { toolCallId: "tc-1" });
    await readTool.execute(args, { toolCallId: "tc-2" });

    // Third identical call triggers doom loop
    await expect(readTool.execute(args, { toolCallId: "tc-3" })).rejects.toThrow(
      /Doom loop detected/,
    );

    expect(mockPublish).toHaveBeenCalledWith(
      DoomLoopDetected,
      expect.objectContaining({
        sessionId: "sess-1",
        toolName: "read",
      }),
    );
  });

  // 14. Tool execution publishes MessageUpdated event
  it("publishes MessageUpdated event after tool execution", async () => {
    const set = await callBuild([makeTool("read")]);
    const readTool = set["read"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await readTool.execute({}, { toolCallId: "tc-1" });

    expect(mockPublish).toHaveBeenCalledWith(MessageUpdated, {
      sessionId: "sess-1",
      messageId: "msg-1",
    });
  });

  // 15. Injects task tool when toolProfile allows it and agentKind != "subagent"
  it("injects task tool when agent config allows it", async () => {
    const set = await callBuild([], {
      agentConfig: makeAgentConfig({ toolProfile: "manager" }),
      agentKind: "primary",
    });
    expect(set).toHaveProperty("task");
  });

  // 16. Does NOT inject task tool for subagents
  it("does not inject task tool when agentKind is subagent", async () => {
    const set = await callBuild([], {
      agentConfig: makeAgentConfig({ toolProfile: "manager" }),
      agentKind: "subagent",
    });
    expect(set).not.toHaveProperty("task");
  });

  // 17. Injects send_message when allowed by profile
  it("injects send_message when agent config allows it", async () => {
    const set = await callBuild([], {
      agentConfig: makeAgentConfig({ toolProfile: "executor" }),
      agentKind: "primary",
    });
    expect(set).toHaveProperty("send_message");
  });
});

// ---------------------------------------------------------------------------
// isMemoryFile — tested via write tool behavior (workspace cache invalidation)
// ---------------------------------------------------------------------------

describe("isMemoryFile detection (via write tool behavior)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks dirty as 'memory' when writing to MEMORY.md", async () => {
    const set = await callBuild([makeTool("write")]);
    const writeTool = set["write"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await writeTool.execute({ filePath: "/workspace/MEMORY.md" }, { toolCallId: "tc-w1" });

    expect(invalidateWorkspaceCache).toHaveBeenCalledWith("/workspace/MEMORY.md");
    expect(markDirty).toHaveBeenCalledWith("sess-1", "memory");
  });

  it("marks dirty as 'memory' for memory/*.md paths", async () => {
    const set = await callBuild([makeTool("write")]);
    const writeTool = set["write"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await writeTool.execute({ filePath: "/workspace/memory/notes.md" }, { toolCallId: "tc-w2" });

    expect(invalidateWorkspaceCache).toHaveBeenCalledWith("/workspace/memory/notes.md");
    expect(markDirty).toHaveBeenCalledWith("sess-1", "memory");
  });

  it("marks dirty as 'workspace' for non-memory files", async () => {
    const set = await callBuild([makeTool("write")]);
    const writeTool = set["write"] as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<unknown>;
    };
    await writeTool.execute({ filePath: "/workspace/src/index.ts" }, { toolCallId: "tc-w3" });

    expect(invalidateWorkspaceCache).toHaveBeenCalledWith("/workspace/src/index.ts");
    expect(markDirty).toHaveBeenCalledWith("sess-1", "workspace");
  });
});
