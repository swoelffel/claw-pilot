import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "../../bus/index.js";
import { createWatchdogManager } from "../_prompt-loop-handlers.js";

describe("watchdog during tool execution", () => {
  const managers: ReturnType<typeof createWatchdogManager>[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    managers.forEach((manager) => manager.cleanup());
    managers.length = 0;
    vi.useRealTimers();
  });

  function setup(timeoutMs = 600_000) {
    const manager = createWatchdogManager(
      new Bus("tool-watchdog"),
      "session",
      "main",
      timeoutMs,
      120_000,
    );
    managers.push(manager);
    return manager;
  }

  it("allows a silent tool beyond chunk timeout and starts a fresh chunk window after completion", async () => {
    const manager = setup();
    const tool = manager.onToolExecution(
      () => new Promise<void>((resolve) => setTimeout(resolve, 241_000)),
    );
    await vi.advanceTimersByTimeAsync(241_000);
    await tool;
    expect(manager.fullAbort.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(manager.fullAbort.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(manager.fullAbort.aborted).toBe(true);
  });

  it("enforces the overall deadline while a tool is active", async () => {
    const manager = setup(180_000);
    const tool = manager.onToolExecution(
      () =>
        new Promise<void>((resolve) => {
          manager.fullAbort.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    await vi.advanceTimersByTimeAsync(179_999);
    expect(manager.fullAbort.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.fullAbort.aborted).toBe(true);
    await tool;
  });

  it("keeps the chunk watchdog paused until every concurrent tool settles, including failures", async () => {
    const manager = setup();
    let finishFirst!: () => void;
    let failSecond!: (error: Error) => void;
    const first = manager.onToolExecution(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = manager.onToolExecution(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSecond = reject;
        }),
    );
    const secondResult = second.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(100_000);
    finishFirst();
    await first;
    await vi.advanceTimersByTimeAsync(150_000);
    expect(manager.fullAbort.aborted).toBe(false);
    failSecond(new Error("tool failed"));
    expect(await secondResult).toBe("tool failed");
    await vi.advanceTimersByTimeAsync(130_000);
    expect(manager.fullAbort.aborted).toBe(true);
  });
});
