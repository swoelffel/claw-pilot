import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../schema.js";
import { createSession } from "../../runtime/session/session.js";
import {
  createAssistantMessage,
  createUserMessage,
  getMessage,
  listMessagesFromCompaction,
  countMessagesSinceLastCompaction,
} from "../../runtime/session/message.js";
import { createPart } from "../../runtime/session/part.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-compaction-migration-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("compaction marker migration", () => {
  it("repairs valid legacy summaries without changing content, and survives reopening", () => {
    const dbPath = path.join(tmpDir, "registry.db");
    const legacy = initDatabase(dbPath);
    legacy.prepare("INSERT INTO servers (hostname, openclaw_home) VALUES ('test', '/tmp')").run();
    legacy
      .prepare(
        `INSERT INTO instances
      (server_id, slug, port, config_path, state_dir, systemd_unit)
      VALUES (1, 'test', 19010, '/tmp/config', '/tmp/state', 'test.service')`,
      )
      .run();
    const session = createSession(legacy, {
      instanceSlug: "test",
      agentId: "main",
      channel: "web",
    });
    const original = createUserMessage(legacy, { sessionId: session.id, text: "Old history" });
    const notification = createUserMessage(legacy, {
      sessionId: session.id,
      text: "Notification added during legacy summarization",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const summary = createAssistantMessage(legacy, { sessionId: session.id });
    createPart(legacy, {
      messageId: summary.id,
      type: "compaction",
      content: "Keep these goals",
      metadata: JSON.stringify({ compactedMessageCount: 1 }),
    });
    const followUp = createUserMessage(legacy, {
      sessionId: session.id,
      text: "Continue",
      createdAt: new Date(summary.createdAt.getTime() + 1).toISOString(),
    });
    const empty = createAssistantMessage(legacy, { sessionId: session.id });
    createPart(legacy, { messageId: empty.id, type: "compaction", content: " \n\t" });
    const user = createUserMessage(legacy, { sessionId: session.id, text: "Not a summary" });
    createPart(legacy, { messageId: user.id, type: "compaction", content: "User content" });
    const invalid = createAssistantMessage(legacy, { sessionId: session.id });
    createPart(legacy, {
      messageId: invalid.id,
      type: "compaction",
      content: "Unverifiable summary",
      metadata: JSON.stringify({ compactedMessageCount: 9999 }),
    });
    const partsSql =
      "SELECT id, message_id, type, state, content, sort_order, created_at, updated_at FROM rt_parts ORDER BY id";
    const parts = legacy.prepare(partsSql).all();
    const messageCount = legacy.prepare("SELECT count(*) AS n FROM rt_messages").get();
    legacy.prepare("UPDATE schema_version SET version = 45").run();
    legacy.close();

    for (let reopen = 0; reopen < 2; reopen++) {
      const upgraded = initDatabase(dbPath);
      try {
        expect(getMessage(upgraded, summary.id)?.isCompaction).toBe(true);
        expect(getMessage(upgraded, empty.id)?.isCompaction).toBe(false);
        expect(getMessage(upgraded, user.id)?.isCompaction).toBe(false);
        expect(getMessage(upgraded, invalid.id)?.isCompaction).toBe(false);
        const history = listMessagesFromCompaction(upgraded, session.id);
        expect(history[0]?.id).toBe(summary.id);
        expect(history.map((m) => m.id)).toContain(followUp.id);
        expect(history.map((m) => m.id)).toContain(notification.id);
        expect(countMessagesSinceLastCompaction(upgraded, session.id)).toBe(history.length - 1);
        expect(upgraded.prepare(partsSql).all()).toEqual(parts);
        const part = upgraded
          .prepare("SELECT metadata FROM rt_parts WHERE message_id = ?")
          .get(summary.id) as { metadata: string };
        expect(JSON.parse(part.metadata)).toEqual({
          compactedMessageCount: 1,
          cutoffMessageId: original.id,
        });
        expect(upgraded.prepare("SELECT count(*) AS n FROM rt_messages").get()).toEqual(
          messageCount,
        );
      } finally {
        upgraded.close();
      }
    }
  });
});
