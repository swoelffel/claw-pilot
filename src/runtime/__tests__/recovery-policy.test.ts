import { describe, expect, it, vi } from "vitest";
import { shouldAutomaticallyRetry, withPhaseTimeout } from "../recovery-policy.js";

describe("recovery policy", () => {
  it("retries only known-safe failures", () => {
    expect(shouldAutomaticallyRetry("read_only", "failed_safely")).toBe(true);
    expect(shouldAutomaticallyRetry("idempotent", "failed_safely")).toBe(true);
    expect(shouldAutomaticallyRetry("unsafe", "failed_safely")).toBe(false);
    expect(shouldAutomaticallyRetry("idempotent", "uncertain")).toBe(false);
  });

  it("reports the timeout phase independently", async () => {
    vi.useFakeTimers();
    const pending = withPhaseTimeout(
      "firstTokenMs",
      (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      {
        providerConnectionMs: 10,
        firstTokenMs: 20,
        chunkInactivityMs: 30,
        toolMs: 40,
        agentMs: 50,
        reconnectionMs: 60,
      },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT_FIRST_TOKEN_MS" });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    vi.useRealTimers();
  });
});
