/**
 * runtime/__tests__/mcp.test.ts
 *
 * Tests for MCP integration:
 * - McpClient: connect, listTools, tool name sanitization, close
 * - McpRegistry: init, getTools aggregation, failed server isolation, dispose
 * - tool/registry: mcpRegistry option wires MCP tools in
 * - config schema: mcpServers discriminated union
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient, McpRegistry } from "../mcp/index.js";
import { getTools } from "../tool/registry.js";
import { parseRuntimeConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Mock @modelcontextprotocol/sdk
// ---------------------------------------------------------------------------

// We mock the entire SDK so tests don't need a real MCP server.
// Vitest 4 requires vi.fn() used with `new` to wrap a function constructor, not an arrow.
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              inputSchema: { type: "object", properties: { path: { type: "string" } } },
            },
            {
              name: "write file", // name with space — should be sanitized
              description: "Write a file",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "file contents" }],
        }),
        close: vi.fn().mockResolvedValue(undefined),
        setNotificationHandler: vi.fn(),
      };
    }),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
  StreamableHTTPError: class StreamableHTTPError extends Error {},
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
  SseError: class SseError extends Error {},
}));

// ---------------------------------------------------------------------------
// Config schema tests
// ---------------------------------------------------------------------------

describe("RuntimeConfig — mcpServers schema", () => {
  it("parses a local server config", () => {
    const cfg = parseRuntimeConfig({
      mcpServers: [
        {
          type: "local",
          id: "my-server",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      ],
    });
    expect(cfg.mcpServers).toHaveLength(1);
    const server = cfg.mcpServers[0]!;
    expect(server.type).toBe("local");
    expect(server.id).toBe("my-server");
    expect(server.timeout).toBe(30_000);
    expect(server.enabled).toBe(true);
    // Type-narrowed assertions
    if (server.type === "local") {
      expect(server.command).toBe("npx");
    }
  });

  it("parses a remote server config", () => {
    const cfg = parseRuntimeConfig({
      mcpServers: [
        {
          type: "remote",
          id: "remote-server",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer token" },
        },
      ],
    });
    expect(cfg.mcpServers).toHaveLength(1);
    const server = cfg.mcpServers[0]!;
    expect(server.type).toBe("remote");
    expect(server.timeout).toBe(30_000);
    // Type-narrowed assertions
    if (server.type === "remote") {
      expect(server.url).toBe("https://mcp.example.com/sse");
      expect(server.headers?.["Authorization"]).toBe("Bearer token");
    }
  });

  it("defaults mcpServers to empty array", () => {
    const cfg = parseRuntimeConfig({});
    expect(cfg.mcpServers).toEqual([]);
    expect(cfg.mcpEnabled).toBe(false);
  });

  it("rejects a remote server without url", () => {
    expect(() =>
      parseRuntimeConfig({
        mcpServers: [{ type: "remote", id: "bad" }],
      }),
    ).toThrow();
  });

  it("rejects a local server without command", () => {
    expect(() =>
      parseRuntimeConfig({
        mcpServers: [{ type: "local", id: "bad" }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// McpClient tests
// ---------------------------------------------------------------------------

describe("McpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects to a local server and returns connected status", async () => {
    const client = new McpClient("test-server");
    const status = await client.connect({
      type: "local",
      id: "test-server",
      command: "npx -y @test/server",
      args: [],
      timeout: 5000,
      enabled: true,
    });
    expect(status.status).toBe("connected");
    expect(client.status.status).toBe("connected");
  });

  it("returns disabled status when enabled=false", async () => {
    const client = new McpClient("disabled-server");
    const status = await client.connect({
      type: "local",
      id: "disabled-server",
      command: "npx",
      args: [],
      timeout: 5000,
      enabled: false,
    });
    expect(status.status).toBe("disabled");
  });

  it("listTools returns Tool.Info[] with sanitized IDs", async () => {
    const client = new McpClient("my server"); // server ID with space
    await client.connect({
      type: "local",
      id: "my server",
      command: "npx",
      args: [],
      timeout: 5000,
      enabled: true,
    });

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);

    // Tool IDs should be sanitized: "my server" → "my_server", "write file" → "write_file"
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("my_server_read_file");
    expect(ids).toContain("my_server_write_file");
  });

  it("listTools returns [] when not connected", async () => {
    const client = new McpClient("not-connected");
    const tools = await client.listTools();
    expect(tools).toHaveLength(0);
  });

  it("listTools returns [] when disabled", async () => {
    const client = new McpClient("disabled");
    await client.connect({
      type: "local",
      id: "disabled",
      command: "npx",
      args: [],
      timeout: 5000,
      enabled: false,
    });
    const tools = await client.listTools();
    expect(tools).toHaveLength(0);
  });

  it("close() sets status to disabled", async () => {
    const client = new McpClient("closeable");
    await client.connect({
      type: "local",
      id: "closeable",
      command: "npx",
      args: [],
      timeout: 5000,
      enabled: true,
    });
    expect(client.status.status).toBe("connected");
    await client.close();
    expect(client.status.status).toBe("disabled");
  });

  it("tool execute() calls client.callTool and returns output", async () => {
    const client = new McpClient("exec-server");
    await client.connect({
      type: "local",
      id: "exec-server",
      command: "npx",
      args: [],
      timeout: 5000,
      enabled: true,
    });

    const tools = await client.listTools();
    const readTool = tools.find((t) => t.id === "exec_server_read_file"); // "exec-server" → "exec_server"
    expect(readTool).toBeDefined();

    const def = await readTool!.init();
    const result = await def.execute(
      { path: "/tmp/test.txt" },
      {
        sessionId: "sess-1" as never,
        messageId: "msg-1" as never,
        agentId: "agent-1",
        abort: new AbortController().signal,
        metadata: () => {},
      },
    );

    expect(result.output).toBe("file contents");
    expect(result.title).toBe("read_file");
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// McpRegistry tests
// ---------------------------------------------------------------------------

describe("McpRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("init() connects all servers and returns status map", async () => {
    const registry = new McpRegistry();
    const status = await registry.init([
      { type: "local", id: "server-a", command: "npx", args: [], timeout: 5000, enabled: true },
      { type: "local", id: "server-b", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    expect(status["server-a"]!.status).toBe("connected");
    expect(status["server-b"]!.status).toBe("connected");
    await registry.dispose();
  });

  it("getTools() aggregates tools from all connected servers", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "srv-a", command: "npx", args: [], timeout: 5000, enabled: true },
      { type: "local", id: "srv-b", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    const tools = await registry.getTools();
    // Each server returns 2 tools → 4 total
    expect(tools).toHaveLength(4);

    const ids = tools.map((t) => t.id);
    expect(ids).toContain("srv_a_read_file");
    expect(ids).toContain("srv_b_read_file");
    await registry.dispose();
  });

  it("disabled server does not contribute tools", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "active", command: "npx", args: [], timeout: 5000, enabled: true },
      { type: "local", id: "inactive", command: "npx", args: [], timeout: 5000, enabled: false },
    ]);

    const tools = await registry.getTools();
    // Only active server contributes tools
    expect(tools).toHaveLength(2);
    await registry.dispose();
  });

  it("getStatus() returns current status of all clients", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "s1", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    const status = registry.getStatus();
    expect(status["s1"]!.status).toBe("connected");
    await registry.dispose();
  });

  it("dispose() closes all clients", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "disposable", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    await registry.dispose();
    const status = registry.getStatus();
    expect(Object.keys(status)).toHaveLength(0);
  });

  it("re-init() closes previous clients before reconnecting", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "server", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);
    // Re-init with different servers
    await registry.init([
      { type: "local", id: "new-server", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    const status = registry.getStatus();
    expect(Object.keys(status)).toEqual(["new-server"]);
    await registry.dispose();
  });
});

// ---------------------------------------------------------------------------
// tool/registry integration
// ---------------------------------------------------------------------------

describe("getTools() with mcpRegistry", () => {
  it("includes MCP tools when mcpRegistry is provided", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "mcp-srv", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    const tools = await getTools({ mcpRegistry: registry });

    // Built-in tools + 2 MCP tools
    const mcpTools = tools.filter((t) => t.id.startsWith("mcp_srv_"));
    expect(mcpTools).toHaveLength(2);
    await registry.dispose();
  });

  it("does not include MCP tools when mcpRegistry is not provided", async () => {
    const tools = await getTools();
    // No tool ID should follow the MCP pattern "<serverId>_<toolName>" with two underscore segments
    // Built-in tool IDs are simple single words: "read", "write", "edit", "bash", etc.
    const mcpPrefixed = tools.filter((t) => /^[a-z][a-z0-9]*_[a-z]/.test(t.id));
    expect(mcpPrefixed).toHaveLength(0);
  });

  it("exclude option filters out MCP tools by ID", async () => {
    const registry = new McpRegistry();
    await registry.init([
      { type: "local", id: "filtered-srv", command: "npx", args: [], timeout: 5000, enabled: true },
    ]);

    const tools = await getTools({
      mcpRegistry: registry,
      exclude: ["filtered_srv_read_file"],
    });

    const ids = tools.map((t) => t.id);
    expect(ids).not.toContain("filtered_srv_read_file");
    expect(ids).toContain("filtered_srv_write_file");
    await registry.dispose();
  });
});
