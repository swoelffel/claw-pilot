/**
 * runtime/__tests__/plugin.test.ts
 *
 * Unit tests for the Plugin system (Phase 2).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPlugin,
  initPlugins,
  resetPlugins,
  registerHooks,
  clearHooks,
  triggerAgentBeforeStart,
  triggerAgentEnd,
  triggerToolBeforeCall,
  triggerToolAfterCall,
  triggerMessageReceived,
  triggerSessionStart,
  triggerSessionEnd,
} from "../plugin/index.js";
import type { PluginInput } from "../plugin/index.js";

const TEST_INPUT: PluginInput = {
  instanceSlug: "test-instance",
  workDir: "/tmp/test",
  version: "0.0.0-test",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetPlugins();
});

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

describe("registerHooks() + trigger functions", () => {
  beforeEach(() => {
    clearHooks();
  });

  it("triggers agent.beforeStart hook", async () => {
    const fn = vi.fn();
    registerHooks({ "agent.beforeStart": fn });

    await triggerAgentBeforeStart({
      instanceSlug: "test",
      sessionId: "s1",
      agentName: "main",
      model: "anthropic/claude-sonnet-4-5",
    });

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ agentName: "main" }));
  });

  it("triggers agent.end hook", async () => {
    const fn = vi.fn();
    registerHooks({ "agent.end": fn });

    await triggerAgentEnd({
      instanceSlug: "test",
      sessionId: "s1",
      agentName: "main",
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("triggers tool.beforeCall hook", async () => {
    const fn = vi.fn();
    registerHooks({ "tool.beforeCall": fn });

    await triggerToolBeforeCall({
      instanceSlug: "test",
      sessionId: "s1",
      messageId: "m1",
      toolName: "read",
      args: { filePath: "/tmp/test.txt" },
    });

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ toolName: "read" }));
  });

  it("triggers tool.afterCall hook", async () => {
    const fn = vi.fn();
    registerHooks({ "tool.afterCall": fn });

    await triggerToolAfterCall({
      instanceSlug: "test",
      sessionId: "s1",
      messageId: "m1",
      toolName: "read",
      args: { filePath: "/tmp/test.txt" },
      output: "file contents",
      durationMs: 42,
    });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("triggers message.received hook", async () => {
    const fn = vi.fn();
    registerHooks({ "message.received": fn });

    await triggerMessageReceived({
      instanceSlug: "test",
      sessionId: "s1",
      messageId: "m1",
      role: "user",
      text: "Hello!",
    });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("triggers session.start hook", async () => {
    const fn = vi.fn();
    registerHooks({ "session.start": fn });

    await triggerSessionStart({ instanceSlug: "test", sessionId: "s1" });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("triggers session.end hook", async () => {
    const fn = vi.fn();
    registerHooks({ "session.end": fn });

    await triggerSessionEnd({ instanceSlug: "test", sessionId: "s1" });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("triggers multiple hooks in registration order", async () => {
    const order: number[] = [];
    registerHooks({
      "session.start": () => {
        order.push(1);
      },
    });
    registerHooks({
      "session.start": () => {
        order.push(2);
      },
    });
    registerHooks({
      "session.start": () => {
        order.push(3);
      },
    });

    await triggerSessionStart({ instanceSlug: "test", sessionId: "s1" });

    expect(order).toEqual([1, 2, 3]);
  });

  it("does not throw when a hook throws — logs warning instead", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerHooks({
      "session.start": () => {
        throw new Error("Hook error");
      },
    });

    // Should not throw
    await expect(
      triggerSessionStart({ instanceSlug: "test", sessionId: "s1" }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("session.start"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Plugin registration + init
// ---------------------------------------------------------------------------

describe("registerPlugin() + initPlugins()", () => {
  it("initializes a plugin and registers its hooks", async () => {
    const fn = vi.fn();

    registerPlugin("test-plugin", (_input) => ({
      "session.start": fn,
    }));

    await initPlugins(TEST_INPUT);
    await triggerSessionStart({ instanceSlug: "test", sessionId: "s1" });

    expect(fn).toHaveBeenCalledOnce();
  });

  it("passes PluginInput to the plugin factory", async () => {
    let receivedInput: PluginInput | undefined;

    registerPlugin("input-test", (input) => {
      receivedInput = input;
      return {};
    });

    await initPlugins(TEST_INPUT);

    expect(receivedInput).toEqual(TEST_INPUT);
  });

  it("is idempotent — initPlugins() only runs once", async () => {
    const initFn = vi.fn().mockReturnValue({});

    registerPlugin("idempotent-plugin", initFn);

    await initPlugins(TEST_INPUT);
    await initPlugins(TEST_INPUT);
    await initPlugins(TEST_INPUT);

    expect(initFn).toHaveBeenCalledOnce();
  });

  it("handles plugin init errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerPlugin("broken-plugin", () => {
      throw new Error("Init failed");
    });

    // Should not throw
    await expect(initPlugins(TEST_INPUT)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("broken-plugin"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("resetPlugins() clears all plugins and hooks", async () => {
    const fn = vi.fn();
    registerPlugin("reset-test", () => ({ "session.start": fn }));
    await initPlugins(TEST_INPUT);

    resetPlugins();

    await triggerSessionStart({ instanceSlug: "test", sessionId: "s1" });
    expect(fn).not.toHaveBeenCalled();
  });
});
