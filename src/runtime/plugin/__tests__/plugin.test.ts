import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginInput, PluginHooks } from "../types.js";

vi.mock("../hooks.js", () => ({
  registerHooks: vi.fn(),
  clearHooks: vi.fn(),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerHooks, clearHooks } from "../hooks.js";
import { logger } from "../../../lib/logger.js";
import { registerPlugin, initPlugins, loadPluginFromFile, resetPlugins } from "../plugin.js";

const mockInput: PluginInput = {
  instanceSlug: "test" as PluginInput["instanceSlug"],
  workDir: "/tmp/test",
  version: "0.0.0-test",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPlugins();
});

describe("registerPlugin", () => {
  it("adds a plugin descriptor", async () => {
    const factory = vi.fn().mockResolvedValue({});
    registerPlugin("alpha", factory);

    // Verify plugin was registered by initializing — factory should be called
    await initPlugins(mockInput);
    expect(factory).toHaveBeenCalledWith(mockInput);
  });
});

describe("initPlugins", () => {
  it("calls plugin factory and registerHooks", async () => {
    const hooks: PluginHooks = { "tool.definition": vi.fn() };
    const factory = vi.fn().mockResolvedValue(hooks);
    registerPlugin("beta", factory);

    await initPlugins(mockInput);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(mockInput);
    expect(registerHooks).toHaveBeenCalledWith(hooks);
  });

  it("is idempotent — second call is a no-op", async () => {
    const factory = vi.fn().mockResolvedValue({});
    registerPlugin("gamma", factory);

    await initPlugins(mockInput);
    await initPlugins(mockInput);

    expect(factory).toHaveBeenCalledOnce();
  });

  it("clears hooks before re-initializing", async () => {
    const factory = vi.fn().mockResolvedValue({});
    registerPlugin("delta", factory);

    // clearHooks was already called once by resetPlugins in beforeEach
    vi.mocked(clearHooks).mockClear();

    await initPlugins(mockInput);

    expect(clearHooks).toHaveBeenCalledOnce();
    // clearHooks is called before any registerHooks
    const clearOrder = vi.mocked(clearHooks).mock.invocationCallOrder[0]!;
    const regOrder = vi.mocked(registerHooks).mock.invocationCallOrder[0]!;
    expect(clearOrder).toBeLessThan(regOrder);
  });

  it("logs warning on plugin factory error (non-fatal)", async () => {
    const brokenFactory = vi.fn().mockRejectedValue(new Error("boom"));
    registerPlugin("broken", brokenFactory);

    // Should not throw
    await initPlugins(mockInput);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialize plugin "broken"'),
    );
  });

  it("continues initializing remaining plugins after one fails", async () => {
    const brokenFactory = vi.fn().mockRejectedValue(new Error("boom"));
    const goodHooks: PluginHooks = {};
    const goodFactory = vi.fn().mockResolvedValue(goodHooks);

    registerPlugin("broken", brokenFactory);
    registerPlugin("good", goodFactory);

    await initPlugins(mockInput);

    expect(goodFactory).toHaveBeenCalledOnce();
    expect(registerHooks).toHaveBeenCalledWith(goodHooks);
  });

  it("initializes multiple plugins in registration order", async () => {
    const callOrder: string[] = [];
    const factoryA = vi.fn().mockImplementation(async () => {
      callOrder.push("A");
      return {};
    });
    const factoryB = vi.fn().mockImplementation(async () => {
      callOrder.push("B");
      return {};
    });

    registerPlugin("A", factoryA);
    registerPlugin("B", factoryB);

    await initPlugins(mockInput);

    expect(callOrder).toEqual(["A", "B"]);
  });
});

describe("resetPlugins", () => {
  it("clears all plugins and hooks", async () => {
    const factory = vi.fn().mockResolvedValue({});
    registerPlugin("epsilon", factory);
    await initPlugins(mockInput);

    vi.clearAllMocks();
    resetPlugins();

    // After reset, initPlugins should not call any factory
    await initPlugins(mockInput);
    expect(factory).not.toHaveBeenCalled();
    expect(clearHooks).toHaveBeenCalled();
  });
});

describe("registerPlugin after initPlugins forces re-init", () => {
  it("re-initializes on next initPlugins call", async () => {
    const factoryA = vi.fn().mockResolvedValue({});
    registerPlugin("first", factoryA);
    await initPlugins(mockInput);

    expect(factoryA).toHaveBeenCalledOnce();
    vi.clearAllMocks();

    // Register another plugin — should reset the _initialized flag
    const factoryB = vi.fn().mockResolvedValue({});
    registerPlugin("second", factoryB);

    await initPlugins(mockInput);

    // Both factories should be called again on re-init
    expect(factoryA).toHaveBeenCalledOnce();
    expect(factoryB).toHaveBeenCalledOnce();
  });
});

describe("loadPluginFromFile", () => {
  it("throws on missing file", async () => {
    await expect(loadPluginFromFile("/nonexistent/plugin.js")).rejects.toThrow(
      "Plugin file not found",
    );
  });

  it("throws on invalid export (not a function)", async () => {
    const { writeFileSync, mkdirSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { mkdtempSync } = await import("node:fs");

    const dir = mkdtempSync(join(tmpdir(), "plugin-test-"));
    const file = join(dir, "bad-plugin.mjs");
    writeFileSync(file, 'export default "not-a-function";\n');

    try {
      await expect(loadPluginFromFile(file)).rejects.toThrow("must export a default function");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
