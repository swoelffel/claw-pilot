import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../db/schema.js";
import { createSession } from "../session.js";
import { createAssistantMessage } from "../message.js";
import { createPart, listParts, updatePartState } from "../part.js";
import {
  expireOrphanedQuestion,
  expireOrphanedQuestions,
  QUESTION_EXPIRED_CONTENT,
} from "../question-recovery.js";

const INSTANCE_SLUG = "question-recovery";

function seedInstance(db: Database.Database, slug: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO servers (hostname, openclaw_home) VALUES ('localhost', '/opt/openclaw')",
  ).run();
  const server = db.prepare("SELECT id FROM servers LIMIT 1").get() as { id: number };
  db.prepare(
    `INSERT INTO instances (server_id, slug, port, config_path, state_dir, systemd_unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    server.id,
    slug,
    slug === INSTANCE_SLUG ? 19001 : 19002,
    `/tmp/${slug}-config.json`,
    `/tmp/${slug}-state`,
    `claw-${slug}.service`,
  );
}

function createQuestion(
  db: Database.Database,
  slug: string,
  toolCallId: string,
  state?: "completed" | "error",
): string {
  const session = createSession(db, { instanceSlug: slug, agentId: "main" });
  const message = createAssistantMessage(db, { sessionId: session.id, agentId: "main" });
  const part = createPart(db, {
    messageId: message.id,
    type: "tool_call",
    metadata: JSON.stringify({ toolCallId, toolName: "question", args: { question: "Ready?" } }),
  });
  if (state) updatePartState(db, part.id, state, "existing result");
  return message.id;
}

describe("question restart recovery", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    seedInstance(db, INSTANCE_SLUG);
    seedInstance(db, "other-instance");
  });

  afterEach(() => db.close());

  it("expires unresolved question calls for the restarted instance only", () => {
    const staleMessageId = createQuestion(db, INSTANCE_SLUG, "q-stale");
    const completedMessageId = createQuestion(db, INSTANCE_SLUG, "q-complete", "completed");
    const otherMessageId = createQuestion(db, "other-instance", "q-other");

    expect(expireOrphanedQuestions(db, INSTANCE_SLUG)).toBe(1);
    expect(listParts(db, staleMessageId)[0]).toMatchObject({
      state: "error",
      content: QUESTION_EXPIRED_CONTENT,
    });
    expect(listParts(db, completedMessageId)[0]).toMatchObject({
      state: "completed",
      content: "existing result",
    });
    expect(listParts(db, otherMessageId)[0]?.state).toBeUndefined();
  });

  it("expires only the requested orphaned question", () => {
    const firstMessageId = createQuestion(db, INSTANCE_SLUG, "q-first");
    const secondMessageId = createQuestion(db, INSTANCE_SLUG, "q-second");

    expect(expireOrphanedQuestion(db, INSTANCE_SLUG, "q-second")).toBe(true);
    expect(listParts(db, firstMessageId)[0]?.state).toBeUndefined();
    expect(listParts(db, secondMessageId)[0]?.state).toBe("error");
    expect(expireOrphanedQuestion(db, INSTANCE_SLUG, "q-missing")).toBe(false);
  });
});
