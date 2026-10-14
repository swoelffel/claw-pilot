import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
export type OperationState =
  | "not_started"
  | "active"
  | "completed"
  | "failed_safely"
  | "uncertain"
  | "requires_review";
export type IdempotencyMode = "read_only" | "idempotent" | "unsafe";
export interface OperationRow {
  id: string;
  request_id: string;
  execution_id: string | null;
  operation_type: string;
  resource: string | null;
  state: OperationState;
  idempotency_mode: IdempotencyMode;
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}
export const canAutomaticallyRetry = (o: Pick<OperationRow, "state" | "idempotency_mode">) =>
  o.state === "failed_safely" && o.idempotency_mode !== "unsafe";
export function createOperation(
  db: Database.Database,
  x: {
    requestId: string;
    executionId?: string;
    operationType: string;
    resource?: string;
    idempotencyMode?: IdempotencyMode;
  },
): OperationRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO rt_operations(id,request_id,execution_id,operation_type,resource,idempotency_mode)VALUES(?,?,?,?,?,?)`,
  ).run(
    id,
    x.requestId,
    x.executionId ?? null,
    x.operationType,
    x.resource ?? null,
    x.idempotencyMode ?? "unsafe",
  );
  return db.prepare("SELECT * FROM rt_operations WHERE id=?").get(id) as OperationRow;
}
export function startOperation(db: Database.Database, id: string) {
  db.prepare(
    `UPDATE rt_operations SET state='active',attempt=attempt+1,started_at=datetime('now'),updated_at=datetime('now')WHERE id=? AND state IN('not_started','failed_safely')`,
  ).run(id);
}
export function finishOperation(
  db: Database.Database,
  id: string,
  state: Exclude<OperationState, "not_started" | "active">,
  e?: { code?: string; message?: string },
) {
  db.prepare(
    `UPDATE rt_operations SET state=?,error_code=?,error_message=?,completed_at=datetime('now'),updated_at=datetime('now')WHERE id=? AND state='active'`,
  ).run(state, e?.code ?? null, e?.message?.slice(0, 2000) ?? null, id);
}
