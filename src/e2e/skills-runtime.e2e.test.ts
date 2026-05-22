// src/e2e/skills-runtime.e2e.test.ts
//
// SKILLS-003 — End-to-end safety net for the DB-skill → runtime path.
//
// Exercises the full wiring: create a structured skill via the dashboard HTTP
// API, assign it to an agent via the HTTP API, then build a system prompt
// with a real `SkillLoader` constructed from the test DB and assert that the
// `<available_skills>` block contains the assigned skill.
//
// This proves the chain {routes → repository → SkillLoader → mergeSkillSources
// → buildSkillsBlock} is intact at the HTTP boundary.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { startTestServer, type TestContext } from "./helpers/test-server.js";
import { seedAdmin, seedLocalServer, seedInstance } from "./helpers/seed.js";
import { SkillLoader } from "../runtime/session/skill-loader.js";
import { buildSkillsBlock } from "../runtime/session/system-prompt.js";
import { disposeBus } from "../runtime/bus/index.js";
import type { Json } from "./helpers/types.js";
import type { RuntimeAgentConfig } from "../runtime/config/index.js";

const MINIMAL_RUNTIME_JSON = JSON.stringify(
  { defaultModel: "anthropic/claude-3-5-haiku-20241022", agents: [] },
  null,
  2,
);

const SLUG = "skills-runtime-e2e";
const AGENT_ID = "pilot";

describe("Skills runtime wiring — E2E", () => {
  let ctx: TestContext;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await startTestServer();
    await seedAdmin(ctx.db);
    const serverId = seedLocalServer(ctx.registry);
    seedInstance(ctx.registry, serverId, { slug: SLUG, port: 18870, state: "stopped" });
    ctx.conn.files.set(`/home/test/.openclaw-${SLUG}/runtime.json`, MINIMAL_RUNTIME_JSON);

    // Create the agent that the skill will be assigned to.
    const agentRes = await ctx.client.withBearer().post(`/api/instances/${SLUG}/agents`, {
      agentSlug: AGENT_ID,
      name: "Pilot",
      role: "assistant",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    if (agentRes.status !== 201) {
      throw new Error(`createAgent failed: ${agentRes.status} ${await agentRes.text()}`);
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-003-e2e-"));
  });

  afterAll(async () => {
    disposeBus(SLUG);
    await ctx.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a skill via HTTP, assigns it to an agent, and surfaces it in the runtime prompt", async () => {
    // 1. Create a blank skill via the dashboard API.
    const createRes = await ctx.client.withBearer().post(`/api/instances/${SLUG}/skills`, {
      mode: "blank",
      name: "hello-world",
      description: "Greet the user",
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as Json;
    const skillId: string = createBody.id;
    expect(typeof skillId).toBe("string");

    // 2. Assign the skill to the agent via HTTP.
    const assignRes = await ctx.client
      .withBearer()
      .post(`/api/instances/${SLUG}/skills/${skillId}/agents/${AGENT_ID}`);
    expect(assignRes.status).toBe(204);

    // 3. Build a system prompt using a real SkillLoader backed by the test DB.
    const loader = new SkillLoader(ctx.db, SLUG);
    try {
      const agentConfig: RuntimeAgentConfig = {
        id: AGENT_ID,
        name: "Pilot",
        model: "anthropic/claude-3-5-haiku-20241022",
        permissions: [],
        maxSteps: 20,
        allowSubAgents: false,
        toolProfile: "executor",
        isDefault: false,
      };

      const block = await buildSkillsBlock(tmpDir, agentConfig, "hi", loader);

      // 4. Assert the <available_skills> block contains the DB skill.
      expect(block).toBeDefined();
      expect(block).toContain("<available_skills>");
      expect(block).toContain('name="hello-world"');
      expect(block).toContain('description="Greet the user"');
    } finally {
      loader.dispose();
    }
  });
});
