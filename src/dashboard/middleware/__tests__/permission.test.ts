import { describe, expect, it, beforeEach } from "vitest";
import {
  registerPermissionChecker,
  resetPermissionChecker,
  getPermissionChecker,
  type PermissionChecker,
  type PermissionContext,
} from "../permission.js";

describe("permission checker registry", () => {
  beforeEach(() => {
    resetPermissionChecker();
  });

  it("defaults to NullPermissionChecker that allows everything", async () => {
    const ctx: PermissionContext = {
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "agent.create",
      resource: { kind: "agent" },
    };
    const decision = await getPermissionChecker().check(ctx);
    expect(decision).toEqual({ allow: true });
  });

  it("dispatches to the registered checker", async () => {
    const calls: PermissionContext[] = [];
    const checker: PermissionChecker = {
      async check(ctx) {
        calls.push(ctx);
        return { allow: false, reason: "nope" };
      },
    };
    registerPermissionChecker(checker);
    const ctx: PermissionContext = {
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "agent.delete",
      resource: { kind: "agent", id: "a42" },
    };
    const decision = await getPermissionChecker().check(ctx);
    expect(decision).toEqual({ allow: false, reason: "nope" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(ctx);
  });

  it("throws on double registration", () => {
    const checker: PermissionChecker = {
      async check() {
        return { allow: true };
      },
    };
    registerPermissionChecker(checker);
    expect(() => registerPermissionChecker(checker)).toThrow(/already registered/i);
  });

  it("resetPermissionChecker restores NullPermissionChecker", async () => {
    registerPermissionChecker({
      async check() {
        return { allow: false, reason: "x" };
      },
    });
    resetPermissionChecker();
    const decision = await getPermissionChecker().check({
      user: { id: "u1", username: "alice", role: "admin", source: "session" },
      action: "x",
      resource: { kind: "y" },
    });
    expect(decision).toEqual({ allow: true });
  });
});
