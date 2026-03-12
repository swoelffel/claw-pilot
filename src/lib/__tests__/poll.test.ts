// src/lib/__tests__/poll.test.ts
import { describe, it, expect, vi } from "vitest";
import { pollUntilReady } from "../poll.js";

describe("pollUntilReady", () => {
  it("resolves immediately when check returns true on first attempt", async () => {
    const check = vi.fn().mockResolvedValue(true);
    await expect(pollUntilReady({ check, timeoutMs: 1000 })).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("resolves after N failed attempts then success", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    await expect(
      pollUntilReady({ check, timeoutMs: 5000, intervalMs: 1 }),
    ).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("throws after timeout when check never returns true", async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(pollUntilReady({ check, timeoutMs: 10, intervalMs: 1 })).rejects.toThrow(
      "Timeout after 10ms",
    );
  });

  it("includes label in timeout error message when provided", async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(
      pollUntilReady({ check, timeoutMs: 10, intervalMs: 1, label: "gateway" }),
    ).rejects.toThrow("Timeout after 10ms waiting for gateway");
  });

  it("treats check() throwing as false and continues polling", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("not ready")).mockResolvedValue(true);
    await expect(
      pollUntilReady({ check, timeoutMs: 5000, intervalMs: 1 }),
    ).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("uses default intervalMs of 1000 when not specified", async () => {
    // Just verify the option is optional — we don't wait 1s in tests
    const check = vi.fn().mockResolvedValue(true);
    await expect(pollUntilReady({ check, timeoutMs: 5000 })).resolves.toBeUndefined();
  });
});
