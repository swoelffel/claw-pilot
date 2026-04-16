// src/runtime/flow/__tests__/step-extension-tool.test.ts
//
// Unit tests for the factory-created `request_step_extension` tool.

import { describe, it, expect } from "vitest";
import { createStepExtensionTool } from "../step-extension-tool.js";
import type { FlowStepState } from "../step-extension-tool.js";
import type { Tool } from "../../tool/tool.js";

function makeCtx(): Tool.Context {
  return {
    sessionId: "test-session",
    messageId: "test-msg",
    agentId: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
  };
}

describe("createStepExtensionTool", () => {
  it("grants the requested number of additional steps", async () => {
    const state: FlowStepState = { effectiveMaxSteps: 50, hardCap: 100 };
    const tool = createStepExtensionTool(state);
    const def = await tool.init();

    const result = await def.execute(
      { reason: "Need to finish edits", additionalSteps: 20 },
      makeCtx(),
    );

    expect(state.effectiveMaxSteps).toBe(70);
    expect(result.title).toContain("+20");
    expect(result.output).toContain("70");
  });

  it("clamps granted steps at the hard cap", async () => {
    const state: FlowStepState = { effectiveMaxSteps: 90, hardCap: 100 };
    const tool = createStepExtensionTool(state);
    const def = await tool.init();

    const result = await def.execute({ reason: "Almost done", additionalSteps: 30 }, makeCtx());

    expect(state.effectiveMaxSteps).toBe(100);
    expect(result.title).toContain("+10");
    expect(result.output).toContain("100");
  });

  it("denies extension when hard cap is already reached", async () => {
    const state: FlowStepState = { effectiveMaxSteps: 100, hardCap: 100 };
    const tool = createStepExtensionTool(state);
    const def = await tool.init();

    const result = await def.execute({ reason: "Please more", additionalSteps: 10 }, makeCtx());

    expect(state.effectiveMaxSteps).toBe(100);
    expect(result.title).toContain("denied");
    expect(result.output).toContain("complete_step");
  });

  it("defaults additionalSteps to 20 when omitted", async () => {
    const state: FlowStepState = { effectiveMaxSteps: 50, hardCap: 100 };
    const tool = createStepExtensionTool(state);
    const def = await tool.init();

    await def.execute(
      // @ts-expect-error — relies on Zod default
      { reason: "More work" },
      makeCtx(),
    );

    expect(state.effectiveMaxSteps).toBe(70);
  });

  it("mutates the shared state object (same reference the stopWhen reads)", async () => {
    const state: FlowStepState = { effectiveMaxSteps: 50, hardCap: 200 };
    const tool = createStepExtensionTool(state);
    const def = await tool.init();

    // Simulate 3 successive extension requests
    await def.execute({ reason: "r1", additionalSteps: 20 }, makeCtx());
    expect(state.effectiveMaxSteps).toBe(70);

    await def.execute({ reason: "r2", additionalSteps: 30 }, makeCtx());
    expect(state.effectiveMaxSteps).toBe(100);

    await def.execute({ reason: "r3", additionalSteps: 50 }, makeCtx());
    expect(state.effectiveMaxSteps).toBe(150);

    await def.execute({ reason: "r4", additionalSteps: 50 }, makeCtx());
    expect(state.effectiveMaxSteps).toBe(200); // capped
  });

  it("tool id is exactly 'request_step_extension'", () => {
    const state: FlowStepState = { effectiveMaxSteps: 50, hardCap: 100 };
    const tool = createStepExtensionTool(state);
    expect(tool.id).toBe("request_step_extension");
  });
});
