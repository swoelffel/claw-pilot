// src/runtime/flow/__tests__/context-providers.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerFlowContextProvider,
  unregisterFlowContextProvider,
  collectFlowContext,
  interpolateTemplate,
  _resetFlowContextProvidersForTests,
  type FlowContextProvider,
} from "../context-providers.js";
import type { FlowStepDef } from "../types.js";
import type { InstanceSlug, AgentId } from "../../types.js";

const baseStep: FlowStepDef = {
  id: "step-1",
  agentId: "agent-1",
  prompt: "do work",
};

const baseArgs = {
  instanceSlug: "test" as InstanceSlug,
  agentId: "agent-1" as AgentId,
  flowName: "flow",
  step: baseStep,
  runId: 42,
};

describe("flow-context-providers registry", () => {
  beforeEach(() => {
    _resetFlowContextProvidersForTests();
  });

  it("returns empty context when no providers are registered", () => {
    expect(collectFlowContext(baseArgs)).toEqual({});
  });

  it("merges output of every registered provider under its name", () => {
    const provA: FlowContextProvider = () => ({ a: 1 });
    const provB: FlowContextProvider = () => ({ b: "hello" });
    registerFlowContextProvider("alpha", provA);
    registerFlowContextProvider("beta", provB);
    expect(collectFlowContext(baseArgs)).toEqual({
      alpha: { a: 1 },
      beta: { b: "hello" },
    });
  });

  it("re-registering replaces silently", () => {
    registerFlowContextProvider("p", () => ({ v: 1 }));
    registerFlowContextProvider("p", () => ({ v: 2 }));
    expect(collectFlowContext(baseArgs)).toEqual({ p: { v: 2 } });
  });

  it("unregister removes provider", () => {
    registerFlowContextProvider("p", () => ({ v: 1 }));
    expect(unregisterFlowContextProvider("p")).toBe(true);
    expect(unregisterFlowContextProvider("p")).toBe(false);
    expect(collectFlowContext(baseArgs)).toEqual({});
  });

  it("rejects invalid provider names", () => {
    expect(() => registerFlowContextProvider("", () => ({}))).toThrow();
    expect(() => registerFlowContextProvider("1bad", () => ({}))).toThrow();
    expect(() => registerFlowContextProvider("with space", () => ({}))).toThrow();
  });

  it("isolates failing providers without aborting collection", () => {
    registerFlowContextProvider("good", () => ({ v: 1 }));
    registerFlowContextProvider("bad", () => {
      throw new Error("boom");
    });
    const ctx = collectFlowContext(baseArgs);
    expect(ctx.good).toEqual({ v: 1 });
    expect(ctx.bad).toEqual({});
  });

  it("forwards step + run identifiers to providers", () => {
    let captured: unknown = null;
    registerFlowContextProvider("spy", (a) => {
      captured = a;
      return {};
    });
    collectFlowContext(baseArgs);
    expect(captured).toMatchObject({
      instanceSlug: "test",
      agentId: "agent-1",
      flowName: "flow",
      runId: 42,
      step: { id: "step-1" },
    });
  });
});

describe("interpolateTemplate", () => {
  it("returns input unchanged when no tags present", () => {
    expect(interpolateTemplate("plain text", { x: 1 })).toBe("plain text");
  });

  it("substitutes top-level keys", () => {
    expect(interpolateTemplate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("resolves nested paths", () => {
    expect(
      interpolateTemplate("PR #{{trigger.payload.number}}", {
        trigger: { payload: { number: 42 } },
      }),
    ).toBe("PR #42");
  });

  it("preserves unknown paths verbatim", () => {
    expect(interpolateTemplate("hi {{missing}}", {})).toBe("hi {{missing}}");
    expect(interpolateTemplate("hi {{a.b.c}}", { a: { b: {} } })).toBe("hi {{a.b.c}}");
  });

  it("renders arrays comma-joined", () => {
    expect(interpolateTemplate("tags: {{tags}}", { tags: ["a", "b", "c"] })).toBe("tags: a, b, c");
  });

  it("tolerates whitespace inside tags", () => {
    expect(interpolateTemplate("hi {{  name  }}", { name: "x" })).toBe("hi x");
  });

  it("ignores tags whose path begins with a digit", () => {
    expect(interpolateTemplate("hi {{1bad}}", { "1bad": "y" })).toBe("hi {{1bad}}");
  });

  it("treats null/undefined leaves as missing", () => {
    expect(interpolateTemplate("v={{x}}", { x: null })).toBe("v={{x}}");
    expect(interpolateTemplate("v={{x}}", { x: undefined })).toBe("v={{x}}");
  });
});
