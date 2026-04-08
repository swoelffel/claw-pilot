// src/runtime/tool/__tests__/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tool } from "../tool.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../plugin/hooks.js", () => ({
  getRegisteredHooks: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getRegisteredHooks } from "../../plugin/hooks.js";
import { logger } from "../../../lib/logger.js";
import {
  TOOL_PROFILES,
  ALL_TOOL_IDS,
  getTools,
  getToolsForAgent,
  getBuiltinTools,
  getBuiltinTool,
} from "../registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Tool.Info stub for testing */
function stubTool(id: string): Tool.Info {
  return {
    id,
    init: () => ({
      description: `Stub tool ${id}`,
      parameters: {} as never,
      execute: vi.fn() as never,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRegisteredHooks).mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// TOOL_PROFILES
// ---------------------------------------------------------------------------

describe("TOOL_PROFILES", () => {
  it("sentinel profile contains only 'question'", () => {
    expect(TOOL_PROFILES.sentinel).toEqual(["question"]);
  });

  it("executor profile includes core file/shell tools", () => {
    const executor = TOOL_PROFILES.executor;
    for (const id of ["read", "write", "edit", "bash", "glob", "grep"]) {
      expect(executor).toContain(id);
    }
  });

  it("manager profile includes task and send_message", () => {
    const manager = TOOL_PROFILES.manager;
    expect(manager).toContain("task");
    expect(manager).toContain("send_message");
  });
});

// ---------------------------------------------------------------------------
// ALL_TOOL_IDS
// ---------------------------------------------------------------------------

describe("ALL_TOOL_IDS", () => {
  it("contains 17 tool IDs", () => {
    expect(ALL_TOOL_IDS).toHaveLength(17);
  });
});

// ---------------------------------------------------------------------------
// getBuiltinTools
// ---------------------------------------------------------------------------

describe("getBuiltinTools", () => {
  it("returns all 14 built-in tools", () => {
    const tools = getBuiltinTools();
    expect(tools).toHaveLength(14);
    // Every tool has an id and an init function
    for (const t of tools) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.init).toBe("function");
    }
  });

  it("returns a shallow copy (mutation-safe)", () => {
    const a = getBuiltinTools();
    const b = getBuiltinTools();
    expect(a).not.toBe(b);
    // Same contents
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });
});

// ---------------------------------------------------------------------------
// getBuiltinTool
// ---------------------------------------------------------------------------

describe("getBuiltinTool", () => {
  it("finds a tool by ID", () => {
    const tool = getBuiltinTool("read");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("read");
  });

  it("returns undefined for an unknown ID", () => {
    expect(getBuiltinTool("nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTools
// ---------------------------------------------------------------------------

describe("getTools", () => {
  it("returns all built-in tools when called with no options", async () => {
    const tools = await getTools();
    expect(tools).toHaveLength(14);
  });

  it("filters by toolProfile (sentinel → only question)", async () => {
    const tools = await getTools({ toolProfile: "sentinel" });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.id).toBe("question");
  });

  it("alsoAllow adds extra tools beyond the profile", async () => {
    const tools = await getTools({ toolProfile: "sentinel", alsoAllow: ["read", "bash"] });
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("question");
    expect(ids).toContain("read");
    expect(ids).toContain("bash");
    expect(tools).toHaveLength(3);
  });

  it("exclude removes specific tools", async () => {
    const tools = await getTools({ exclude: ["read", "write"] });
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("read");
    expect(ids).not.toContain("write");
    expect(tools).toHaveLength(12);
  });

  it("combines toolProfile + exclude correctly", async () => {
    const tools = await getTools({ toolProfile: "executor", exclude: ["bash"] });
    const ids = tools.map((t) => t.id);
    // executor has bash, but it should be excluded
    expect(ids).not.toContain("bash");
    // executor does not have task
    expect(ids).not.toContain("task");
  });

  it("appends MCP tools from mcpRegistry", async () => {
    const mcpTool = stubTool("mcp-tool-1");
    const mockMcpRegistry = {
      getTools: vi.fn().mockResolvedValue([mcpTool]),
    };

    const tools = await getTools({ mcpRegistry: mockMcpRegistry as never });
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("mcp-tool-1");
    expect(tools).toHaveLength(15); // 14 built-in + 1 MCP
    expect(mockMcpRegistry.getTools).toHaveBeenCalledOnce();
  });

  it("appends plugin tools and deduplicates with a warning on conflict", async () => {
    const pluginTool = stubTool("plugin-tool");
    const conflictTool = stubTool("read"); // conflicts with built-in

    vi.mocked(getRegisteredHooks).mockReturnValue([
      {
        tools: vi.fn().mockResolvedValue([pluginTool, conflictTool]),
      },
    ] as never);

    const tools = await getTools({ pluginInput: {} as never });
    const ids = tools.map((t) => t.id);

    // plugin-tool is added, conflicting "read" is skipped
    expect(ids).toContain("plugin-tool");
    expect(ids.filter((id) => id === "read")).toHaveLength(1);
    expect(tools).toHaveLength(15); // 14 built-in + 1 plugin (conflict skipped)

    // Warning logged for the conflict
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Plugin tool 'read' conflicts"),
    );
  });

  it("ignores an unknown toolProfile and returns all tools", async () => {
    const tools = await getTools({ toolProfile: "nonexistent" });
    expect(tools).toHaveLength(14);
  });

  it("alsoAllow does not duplicate tools already in the profile", async () => {
    // "question" is already in sentinel
    const tools = await getTools({ toolProfile: "sentinel", alsoAllow: ["question"] });
    const ids = tools.map((t) => t.id);
    expect(ids.filter((id) => id === "question")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getToolsForAgent
// ---------------------------------------------------------------------------

describe("getToolsForAgent", () => {
  it("removes task and send_message for subagents", async () => {
    const tools = await getToolsForAgent({ toolProfile: "manager", agentKind: "subagent" });
    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("task");
    expect(ids).not.toContain("send_message");
  });

  it("keeps non-subagent-restricted tools for primary agents", async () => {
    // task and send_message are not in BUILTIN_TOOLS (they are dynamic),
    // so we inject them via MCP to verify they are NOT stripped for primary agents.
    const taskTool = stubTool("task");
    const sendTool = stubTool("send_message");
    const mockMcp = { getTools: vi.fn().mockResolvedValue([taskTool, sendTool]) };

    const tools = await getToolsForAgent({
      agentKind: "primary",
      mcpRegistry: mockMcp as never,
    });
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("task");
    expect(ids).toContain("send_message");
  });

  it("defaults to keeping all tools when agentKind is omitted", async () => {
    const taskTool = stubTool("task");
    const sendTool = stubTool("send_message");
    const mockMcp = { getTools: vi.fn().mockResolvedValue([taskTool, sendTool]) };

    const tools = await getToolsForAgent({ mcpRegistry: mockMcp as never });
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("task");
    expect(ids).toContain("send_message");
  });
});
