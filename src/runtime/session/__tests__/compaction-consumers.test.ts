import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import { RuntimeConfigSchema } from "../../config/index.js";
import { initAgentRegistry, resetAgentRegistry } from "../../agent/index.js";
import { getOrCreatePermanentSession } from "../session.js";
import { createAssistantMessage, listMessagesFromCompaction } from "../message.js";
import { createPart } from "../part.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { buildBriefing } from "../../flow/briefing.js";

let db: Database.Database;
const config = RuntimeConfigSchema.parse({
  agents: [
    { id: "main", name: "Main", model: "anthropic/claude-sonnet-4-6", persistence: "permanent" },
  ],
});
beforeEach(() => {
  db = initDatabase(":memory:");
  db.prepare("INSERT INTO servers (hostname, openclaw_home) VALUES ('test', '/tmp')").run();
  db.prepare(
    `INSERT INTO instances
    (server_id, slug, port, config_path, state_dir, systemd_unit)
    VALUES (1, 'test', 19010, '/tmp/config', '/tmp/state', 'test.service')`,
  ).run();
  initAgentRegistry(config.agents);
});
afterEach(() => {
  db.close();
  resetAgentRegistry();
});

describe("compaction consumers", () => {
  it("uses the same latest summary for history and system prompt when timestamps tie", async () => {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug: "test",
      agentId: "main",
      channel: "web",
    });
    let latestId = "";
    for (const content of ["Old standing goals", "New standing goals"]) {
      const message = createAssistantMessage(db, { sessionId: session.id, isCompaction: true });
      createPart(db, { messageId: message.id, type: "compaction", content });
      latestId = message.id;
    }
    db.prepare("UPDATE rt_messages SET created_at = '2026-10-06T10:00:00.000Z'").run();

    expect(listMessagesFromCompaction(db, session.id).map((m) => m.id)).toEqual([latestId]);
    const prompt = await buildSystemPrompt({
      instanceSlug: "test",
      agentConfig: config.agents[0]!,
      channel: "web",
      workDir: undefined,
      runtimeConfig: config,
      db,
      sessionId: session.id,
    });
    expect(prompt).toContain("New standing goals");
    expect(prompt).not.toContain("Old standing goals");
  });

  it("includes the summary in a flow briefing after compaction", () => {
    const session = getOrCreatePermanentSession(db, {
      instanceSlug: "test",
      agentId: "main",
      channel: "web",
    });
    const message = createAssistantMessage(db, { sessionId: session.id, isCompaction: true });
    createPart(db, {
      messageId: message.id,
      type: "compaction",
      content: "Preserve the standing goals",
    });

    const briefing = buildBriefing(db, {
      instanceSlug: "test",
      agentId: "main",
      flowName: "Continuity",
      depSitreps: [],
      step: {
        id: "continue",
        agentId: "main",
        prompt: "Continue work",
        dependsOn: [],
        briefing: { includeLastN: 1 },
      },
    });
    expect(briefing).toContain("Preserve the standing goals");
  });
});
