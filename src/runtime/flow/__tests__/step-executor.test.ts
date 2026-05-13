// src/runtime/flow/__tests__/step-executor.test.ts
//
// Unit test for executeStep — verifies that the mcpRegistry captured in the
// FlowEngineContext is forwarded into ChannelRouter.route, so MCP tools
// reach the agent during a flow step the same way as in interactive chat.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../../../db/schema.js";
import type { McpRegistry } from "../../mcp/registry.js";
import type { RuntimeConfig } from "../../config/index.js";
import type { Registry } from "../../../core/registry.js";
import type { FlowEngineContext } from "../types.js";

const routeSpy = vi.fn();

vi.mock("../../channel/router.js", () => ({
  ChannelRouter: {
    route: (input: unknown) => {
      routeSpy(input);
      return Promise.resolve({
        response: { channelType: "web", peerId: "flow-engine", text: "ok" },
        sessionId: "sess-1",
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0,
      });
    },
  },
}));

// Imported AFTER vi.mock so the mocked router is used.
const { executeStep } = await import("../step-executor.js");

let db: ReturnType<typeof initDatabase>;

beforeEach(() => {
  db = initDatabase(":memory:");
  db.prepare(
    "INSERT INTO servers (id, hostname, openclaw_home) VALUES (1, 'test', '/opt/test')",
  ).run();
  db.prepare(
    "INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit) VALUES (1, 'inst-1', 18789, '/tmp/rt.json', '/tmp/state', 'claw-test.service')",
  ).run();
  routeSpy.mockClear();
});

afterEach(() => {
  db.close();
});

function makeCtx(mcpRegistry?: McpRegistry): FlowEngineContext {
  const config = {
    agents: [],
    models: [],
    defaultModel: "anthropic/claude-sonnet-4-6",
  } as unknown as RuntimeConfig;
  return {
    db,
    instanceSlug: "inst-1",
    registry: {} as Registry,
    config,
    workDir: undefined,
    ...(mcpRegistry !== undefined ? { mcpRegistry } : {}),
  };
}

describe("executeStep — mcpRegistry propagation", () => {
  it("forwards mcpRegistry from ctx to ChannelRouter.route", async () => {
    const fakeRegistry = { __tag: "mcp" } as unknown as McpRegistry;
    await executeStep(makeCtx(fakeRegistry), {
      agentId: "a1",
      briefingText: "briefing",
      flowName: "f",
      stepId: "s1",
      stepRunId: 1,
    });

    expect(routeSpy).toHaveBeenCalledTimes(1);
    const call = routeSpy.mock.calls[0]?.[0] as { mcpRegistry?: unknown };
    expect(call.mcpRegistry).toBe(fakeRegistry);
  });

  it("omits mcpRegistry when ctx has none (no MCP configured)", async () => {
    await executeStep(makeCtx(undefined), {
      agentId: "a1",
      briefingText: "briefing",
      flowName: "f",
      stepId: "s1",
      stepRunId: 1,
    });

    expect(routeSpy).toHaveBeenCalledTimes(1);
    const call = routeSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("mcpRegistry" in call).toBe(false);
  });
});
