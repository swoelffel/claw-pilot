import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginHooks, ToolCallContext, ToolCallDecision } from "../types.js";

const hooksList: PluginHooks[] = [];

vi.mock("../hooks.js", () => ({
  getRegisteredHooks: vi.fn(() => [...hooksList]),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../core/audit/emitter.js", () => ({
  emitAudit: vi.fn(),
}));

import { dispatchToolBeforeCall } from "../dispatcher.js";
import { emitAudit } from "../../../core/audit/emitter.js";

const baseCtx: ToolCallContext = {
  instanceSlug: "test" as ToolCallContext["instanceSlug"],
  sessionId: "sess-1" as ToolCallContext["sessionId"],
  messageId: "msg-1",
  toolName: "bash",
  args: { cmd: "ls" },
};

function setHook(fn: NonNullable<PluginHooks["tool.beforeCall"]>): void {
  hooksList.length = 0;
  hooksList.push({ "tool.beforeCall": fn });
}

function setHooks(...fns: Array<NonNullable<PluginHooks["tool.beforeCall"]>>): void {
  hooksList.length = 0;
  for (const fn of fns) hooksList.push({ "tool.beforeCall": fn });
}

beforeEach(() => {
  hooksList.length = 0;
  vi.clearAllMocks();
});

describe("dispatchToolBeforeCall — backward compatibility", () => {
  it("returns allow when no plugin is registered", async () => {
    const result = await dispatchToolBeforeCall(baseCtx);
    expect(result.decision).toEqual({ action: "allow" });
    expect(result.effectiveArgs).toBe(baseCtx.args);
    expect(emitAudit).not.toHaveBeenCalled();
  });

  it("treats a void return as allow", async () => {
    setHook(() => {});
    const result = await dispatchToolBeforeCall(baseCtx);
    expect(result.decision).toEqual({ action: "allow" });
    expect(emitAudit).not.toHaveBeenCalled();
  });

  it("treats an explicit { action: 'allow' } return as allow", async () => {
    setHook(() => ({ action: "allow" }) as ToolCallDecision);
    const result = await dispatchToolBeforeCall(baseCtx);
    expect(result.decision).toEqual({ action: "allow" });
  });

  it("treats a throw as deny with the error message", async () => {
    setHook(() => {
      throw new Error("policy engine offline");
    });
    const result = await dispatchToolBeforeCall(baseCtx, { agentId: "agent-1" });
    expect(result.decision).toEqual({ action: "deny", reason: "policy engine offline" });
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool.denied",
        agentId: "agent-1",
        tool: "bash",
        reason: "policy engine offline",
      }),
    );
  });
});

describe("dispatchToolBeforeCall — deny", () => {
  it("short-circuits on deny and emits tool.denied", async () => {
    const second = vi.fn().mockReturnValue({ action: "allow" });
    setHooks(
      () => ({ action: "deny", reason: "forbidden tool" }),
      second as NonNullable<PluginHooks["tool.beforeCall"]>,
    );
    const result = await dispatchToolBeforeCall(baseCtx, { agentId: "a", userId: "u1" });
    expect(result.decision).toEqual({ action: "deny", reason: "forbidden tool" });
    expect(second).not.toHaveBeenCalled();
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool.denied",
        reason: "forbidden tool",
        userId: "u1",
      }),
    );
  });
});

describe("dispatchToolBeforeCall — modify-args", () => {
  it("chains mutated args through subsequent plugins and emits tool.args_modified", async () => {
    const seen: unknown[] = [];
    setHooks(
      (ctx) => {
        seen.push(ctx.args);
        return { action: "modify-args", newArgs: { cmd: "ls -la" } };
      },
      (ctx) => {
        seen.push(ctx.args);
        return { action: "allow" };
      },
    );
    const result = await dispatchToolBeforeCall(baseCtx, { agentId: "a" });
    expect(result.decision).toEqual({ action: "allow" });
    expect(result.effectiveArgs).toEqual({ cmd: "ls -la" });
    expect(seen[0]).toEqual({ cmd: "ls" });
    expect(seen[1]).toEqual({ cmd: "ls -la" });
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tool.args_modified", tool: "bash" }),
    );
  });
});

describe("dispatchToolBeforeCall — require-approval", () => {
  it("short-circuits and emits tool.approval_required", async () => {
    const downstream = vi.fn();
    setHooks(
      () => ({
        action: "require-approval",
        approvalRequest: { kind: "slack", context: { channel: "#ops" } },
      }),
      downstream as NonNullable<PluginHooks["tool.beforeCall"]>,
    );
    const result = await dispatchToolBeforeCall(baseCtx, { agentId: "a" });
    expect(result.decision.action).toBe("require-approval");
    expect(downstream).not.toHaveBeenCalled();
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool.approval_required",
        approvalKind: "slack",
      }),
    );
  });
});

describe("dispatchToolBeforeCall — agentId fallback", () => {
  it("uses instanceSlug when agentId is omitted", async () => {
    setHook(() => ({ action: "deny", reason: "nope" }));
    await dispatchToolBeforeCall(baseCtx);
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: baseCtx.instanceSlug }),
    );
  });
});
