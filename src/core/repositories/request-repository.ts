import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type DeliveryStatus =
  | "pending"
  | "result_persisted"
  | "delivered"
  | "acknowledged"
  | "delivery_failed";

export interface RequestRow {
  id: string;
  trace_id: string;
  parent_request_id: string | null;
  instance_slug: string;
  session_id: string | null;
  agent_id: string | null;
  task_id: number | null;
  source: string;
  idempotency_key: string | null;
  delivery_status: DeliveryStatus;
  result_message_id: string | null;
  artifact_refs_json: string | null;
  error_code: string | null;
  error_message: string | null;
  org_id: string | null;
  created_at: string;
  result_persisted_at: string | null;
  delivered_at: string | null;
  acknowledged_at: string | null;
  updated_at: string;
  execution_status?: string | null;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface CreateRequestInput {
  instanceSlug: string;
  source: string;
  requestId?: string;
  traceId?: string;
  parentRequestId?: string;
  idempotencyKey?: string;
  sessionId?: string;
  agentId?: string;
  taskId?: number;
}

/** Atomically create a request or return the prior request for an idempotency key. */
export function createOrGetRequest(
  db: Database.Database,
  input: CreateRequestInput,
): { request: RequestRow; created: boolean } {
  const id = input.requestId ?? randomUUID();
  const traceId = input.traceId ?? id;
  const insert = db.prepare(`INSERT INTO rt_requests
    (id, trace_id, parent_request_id, instance_slug, session_id, agent_id, task_id, source,
     idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`);
  const result = insert.run(
    id,
    traceId,
    input.parentRequestId ?? null,
    input.instanceSlug,
    input.sessionId ?? null,
    input.agentId ?? null,
    input.taskId ?? null,
    input.source,
    input.idempotencyKey ?? null,
  );
  const request =
    getRequest(db, id) ??
    (input.idempotencyKey
      ? findRequestByIdempotencyKey(db, input.instanceSlug, input.source, input.idempotencyKey)
      : undefined);
  if (!request) throw new Error("Failed to create or recover request identity");
  return { request, created: result.changes === 1 };
}

export function getRequest(db: Database.Database, id: string): RequestRow | undefined {
  return db.prepare("SELECT * FROM rt_requests WHERE id = ?").get(id) as RequestRow | undefined;
}

export function findRequestByIdempotencyKey(
  db: Database.Database,
  instanceSlug: string,
  source: string,
  key: string,
): RequestRow | undefined {
  return db
    .prepare(
      "SELECT * FROM rt_requests WHERE instance_slug = ? AND source = ? AND idempotency_key = ?",
    )
    .get(instanceSlug, source, key) as RequestRow | undefined;
}

export function attachRequestContext(
  db: Database.Database,
  id: string,
  context: { sessionId: string; agentId: string },
): void {
  db.prepare(
    `UPDATE rt_requests SET session_id = COALESCE(session_id, ?),
    agent_id = COALESCE(agent_id, ?), updated_at = datetime('now') WHERE id = ?`,
  ).run(context.sessionId, context.agentId, id);
}

export function persistRequestResult(
  db: Database.Database,
  id: string,
  result: { messageId: string; artifactRefs?: unknown[] },
): void {
  db.prepare(
    `UPDATE rt_requests SET delivery_status = 'result_persisted', result_message_id = ?,
    artifact_refs_json = ?, error_code = NULL, error_message = NULL,
    result_persisted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(result.messageId, JSON.stringify(result.artifactRefs ?? []), id);
}

export function markRequestDelivered(db: Database.Database, id: string): void {
  db.prepare(
    `UPDATE rt_requests SET delivery_status = 'delivered', delivered_at = datetime('now'),
    error_code = NULL, error_message = NULL, updated_at = datetime('now')
    WHERE id = ? AND delivery_status IN ('result_persisted','delivery_failed','delivered')`,
  ).run(id);
}

export function acknowledgeRequest(db: Database.Database, id: string): RequestRow | undefined {
  db.prepare(
    `UPDATE rt_requests SET delivery_status = 'acknowledged',
    acknowledged_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND delivery_status IN ('delivered','acknowledged')`,
  ).run(id);
  return getRequest(db, id);
}

export function markRequestDeliveryFailed(db: Database.Database, id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error && "code" in error ? String(error.code) : "DELIVERY_FAILED";
  db.prepare(
    `UPDATE rt_requests SET delivery_status = 'delivery_failed', error_code = ?,
    error_message = ?, updated_at = datetime('now')
    WHERE id = ? AND delivery_status IN ('result_persisted','delivered','delivery_failed')`,
  ).run(code, message.slice(0, 2000), id);
}

export function listRequests(
  db: Database.Database,
  instanceSlug: string,
  options: { taskId?: number; limit?: number } = {},
): RequestRow[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  if (options.taskId !== undefined) {
    return db
      .prepare(
        `SELECT r.*,
          (SELECT e.status FROM rt_executions e WHERE e.request_id = r.id
           ORDER BY e.accepted_at DESC, e.rowid DESC LIMIT 1) AS execution_status,
          COALESCE((SELECT SUM(e.cost_usd) FROM rt_executions e WHERE e.request_id = r.id), 0) AS cost_usd,
          COALESCE((SELECT SUM(e.input_tokens) FROM rt_executions e WHERE e.request_id = r.id), 0) AS input_tokens,
          COALESCE((SELECT SUM(e.output_tokens) FROM rt_executions e WHERE e.request_id = r.id), 0) AS output_tokens
        FROM rt_requests r WHERE r.instance_slug = ? AND r.task_id = ?
        ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
      )
      .all(instanceSlug, options.taskId, limit) as RequestRow[];
  }
  return db
    .prepare(
      `SELECT r.*,
        (SELECT e.status FROM rt_executions e WHERE e.request_id = r.id
         ORDER BY e.accepted_at DESC, e.rowid DESC LIMIT 1) AS execution_status,
        COALESCE((SELECT SUM(e.cost_usd) FROM rt_executions e WHERE e.request_id = r.id), 0) AS cost_usd,
        COALESCE((SELECT SUM(e.input_tokens) FROM rt_executions e WHERE e.request_id = r.id), 0) AS input_tokens,
        COALESCE((SELECT SUM(e.output_tokens) FROM rt_executions e WHERE e.request_id = r.id), 0) AS output_tokens
      FROM rt_requests r WHERE r.instance_slug = ?
      ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(instanceSlug, limit) as RequestRow[];
}
