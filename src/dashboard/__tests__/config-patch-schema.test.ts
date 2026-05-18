import { describe, it, expect } from "vitest";
import { RuntimeConfigPatchSchema } from "../routes/instances/config-schemas.js";

describe("RuntimeConfigPatchSchema — agents array", () => {
  const baseAgent = { id: "agent-a" };

  it("accepts agentToAgent", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, agentToAgent: { enabled: true } }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts isDefault", () => {
    const r = RuntimeConfigPatchSchema.safeParse({ agents: [{ ...baseAgent, isDefault: false }] });
    expect(r.success).toBe(true);
  });

  it("accepts persistence=permanent", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, persistence: "permanent" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts systemPrompt", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, systemPrompt: "You are..." }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts systemPromptFile", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, systemPromptFile: "SOUL.md" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts permissions array", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [
        {
          ...baseAgent,
          permissions: [{ permission: "bash", pattern: "*", action: "allow" }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts inheritWorkspace", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, inheritWorkspace: true }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts skillUrls as URL array", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, skillUrls: ["https://example.com/skill.md"] }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts promptMode=subagent", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, promptMode: "subagent" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown fields (schema is still strict)", () => {
    const r = RuntimeConfigPatchSchema.safeParse({
      agents: [{ ...baseAgent, bogusField: 123 }],
    });
    expect(r.success).toBe(false);
  });
});
