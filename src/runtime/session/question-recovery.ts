/**
 * Recovery helpers for question tool calls whose in-memory resolver was lost.
 *
 * Question prompts are persisted as rt_parts, but the Promise that resumes the
 * prompt loop lives only in the runtime process. After a restart, every
 * unresolved question for that instance is therefore orphaned and cannot be
 * answered. Marking it as an error makes that fact durable and unlocks the UI.
 */

import type Database from "better-sqlite3";
import type { InstanceSlug } from "../types.js";

export const QUESTION_EXPIRED_CONTENT =
  "Question expired because the runtime restarted before it was answered. Ask the agent to continue.";

function expireWhere(
  db: Database.Database,
  instanceSlug: InstanceSlug | string,
  questionId?: string,
): number {
  const now = new Date().toISOString();
  const questionFilter =
    questionId === undefined ? "" : "AND json_extract(p.metadata, '$.toolCallId') = ?";
  const params =
    questionId === undefined
      ? [QUESTION_EXPIRED_CONTENT, now, instanceSlug]
      : [QUESTION_EXPIRED_CONTENT, now, instanceSlug, questionId];

  const result = db
    .prepare(
      `UPDATE rt_parts
       SET state = 'error', content = ?, updated_at = ?
       WHERE id IN (
         SELECT p.id
         FROM rt_parts p
         JOIN rt_messages m ON m.id = p.message_id
         JOIN rt_sessions s ON s.id = m.session_id
         WHERE s.instance_slug = ?
           AND p.type = 'tool_call'
           AND p.state IS NULL
           AND json_valid(p.metadata)
           AND json_extract(p.metadata, '$.toolName') = 'question'
           ${questionFilter}
       )`,
    )
    .run(...params);

  return result.changes;
}

/** Expire every unresolved question left by a previous runtime process. */
export function expireOrphanedQuestions(
  db: Database.Database,
  instanceSlug: InstanceSlug | string,
): number {
  return expireWhere(db, instanceSlug);
}

/** Expire one persisted question after the runtime reports that it is unknown. */
export function expireOrphanedQuestion(
  db: Database.Database,
  instanceSlug: InstanceSlug | string,
  questionId: string,
): boolean {
  return expireWhere(db, instanceSlug, questionId) > 0;
}
