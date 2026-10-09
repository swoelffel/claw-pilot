import type Database from "better-sqlite3";
export interface ExecutionEventRow {
  id: number;
  request_id: string;
  execution_id: string | null;
  trace_id: string;
  instance_slug: string;
  session_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
}
export function appendExecutionEvent(
  db: Database.Database,
  x: Omit<ExecutionEventRow, "id" | "created_at" | "payload_json"> & { payload: unknown },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO rt_execution_events(request_id,execution_id,trace_id,instance_slug,session_id,event_type,payload_json)VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        x.request_id,
        x.execution_id,
        x.trace_id,
        x.instance_slug,
        x.session_id,
        x.event_type,
        JSON.stringify(x.payload),
      ).lastInsertRowid,
  );
}
export function listExecutionEventsAfter(
  db: Database.Database,
  slug: string,
  id: number,
  f: { sessionId?: string; types?: Set<string>; limit?: number } = {},
): ExecutionEventRow[] {
  const w = ["instance_slug=?", "id>?"];
  const a: unknown[] = [slug, id];
  if (f.sessionId) {
    w.push("(session_id IS NULL OR session_id=?)");
    a.push(f.sessionId);
  }
  if (f.types?.size) {
    w.push(`event_type IN (${[...f.types].map(() => "?").join(",")})`);
    a.push(...f.types);
  }
  a.push(Math.min(f.limit ?? 1000, 5000));
  return db
    .prepare(`SELECT * FROM rt_execution_events WHERE ${w.join(" AND ")} ORDER BY id LIMIT ?`)
    .all(...a) as ExecutionEventRow[];
}
