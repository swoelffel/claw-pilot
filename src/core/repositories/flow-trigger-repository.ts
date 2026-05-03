// src/core/repositories/flow-trigger-repository.ts
//
// Repository for flow triggers (TRIGGER-001) — CRUD on `rt_flow_triggers`
// and execution history on `rt_flow_trigger_runs`.
//
// Triggers schedule flow runs via cron expressions or HMAC-signed inbound
// webhooks. The `rt_flow_trigger_runs` table doubles as the concurrency
// lock: an active row in ('pending','running') for a given trigger blocks
// further fires unless `allow_concurrent` is set.

import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowTriggerKind = "cron" | "webhook";

export type FlowTriggerRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "deduped"
  | "skipped_concurrent";

export interface FlowTriggerRow {
  id: number;
  org_id: string | null;
  instance_slug: string;
  flow_id: number;
  owner_user_id: number | null;
  kind: FlowTriggerKind;
  name: string;
  enabled: number;
  allow_concurrent: number;
  cron_expr: string | null;
  cron_tz: string | null;
  webhook_slug: string | null;
  webhook_secret_ref: string | null;
  ip_allowlist: string | null;
  input_mapping: string | null;
  default_input: string | null;
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
}

export interface FlowTriggerRunRow {
  id: number;
  org_id: string | null;
  trigger_id: number;
  flow_run_id: number | null;
  status: FlowTriggerRunStatus;
  fired_at: string;
  finished_at: string | null;
  payload: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  source_ip: string | null;
  error: string | null;
}

export interface CreateFlowTriggerInput {
  instanceSlug: string;
  flowId: number;
  ownerUserId?: number | null;
  kind: FlowTriggerKind;
  name: string;
  enabled?: boolean;
  allowConcurrent?: boolean;
  cronExpr?: string | null;
  cronTz?: string | null;
  webhookSlug?: string | null;
  webhookSecretRef?: string | null;
  ipAllowlist?: string | null;
  inputMapping?: string | null;
  defaultInput?: string | null;
}

export interface UpdateFlowTriggerInput {
  name?: string;
  enabled?: boolean;
  allowConcurrent?: boolean;
  cronExpr?: string | null;
  cronTz?: string | null;
  webhookSlug?: string | null;
  webhookSecretRef?: string | null;
  ipAllowlist?: string | null;
  inputMapping?: string | null;
  defaultInput?: string | null;
  ownerUserId?: number | null;
}

export interface CreateTriggerRunInput {
  triggerId: number;
  status: FlowTriggerRunStatus;
  payload?: string | null;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
  sourceIp?: string | null;
}

// ---------------------------------------------------------------------------
// Triggers CRUD
// ---------------------------------------------------------------------------

/** Create a new flow trigger. */
export function createFlowTrigger(
  db: Database.Database,
  input: CreateFlowTriggerInput,
): FlowTriggerRow {
  validateKindFields(input.kind, {
    cronExpr: input.cronExpr,
    webhookSlug: input.webhookSlug,
    webhookSecretRef: input.webhookSecretRef,
  });

  const result = db
    .prepare(
      `INSERT INTO rt_flow_triggers (
         instance_slug, flow_id, owner_user_id, kind, name,
         enabled, allow_concurrent,
         cron_expr, cron_tz,
         webhook_slug, webhook_secret_ref, ip_allowlist,
         input_mapping, default_input
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.instanceSlug,
      input.flowId,
      input.ownerUserId ?? null,
      input.kind,
      input.name,
      input.enabled === false ? 0 : 1,
      input.allowConcurrent ? 1 : 0,
      input.cronExpr ?? null,
      input.cronTz ?? null,
      input.webhookSlug ?? null,
      input.webhookSecretRef ?? null,
      input.ipAllowlist ?? null,
      input.inputMapping ?? null,
      input.defaultInput ?? null,
    );

  const row = getFlowTrigger(db, Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to create flow trigger");
  return row;
}

/** Fetch a trigger by id. */
export function getFlowTrigger(db: Database.Database, id: number): FlowTriggerRow | null {
  const row = db.prepare("SELECT * FROM rt_flow_triggers WHERE id = ?").get(id) as
    | FlowTriggerRow
    | undefined;
  return row ?? null;
}

/**
 * Fetch a webhook trigger by its (instance, slug) pair.
 *
 * Uniqueness on `webhook_slug` is scoped to `instance_slug` (v41), so the
 * lookup must include both segments. A bare slug match would silently leak
 * a different instance's trigger.
 */
export function getFlowTriggerByWebhookSlug(
  db: Database.Database,
  instanceSlug: string,
  slug: string,
): FlowTriggerRow | null {
  const row = db
    .prepare("SELECT * FROM rt_flow_triggers WHERE instance_slug = ? AND webhook_slug = ?")
    .get(instanceSlug, slug) as FlowTriggerRow | undefined;
  return row ?? null;
}

/** List triggers for an instance. */
export function listFlowTriggers(
  db: Database.Database,
  opts: {
    instanceSlug?: string;
    flowId?: number;
    kind?: FlowTriggerKind;
    enabledOnly?: boolean;
  } = {},
): FlowTriggerRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.instanceSlug) {
    where.push("instance_slug = ?");
    args.push(opts.instanceSlug);
  }
  if (opts.flowId !== undefined) {
    where.push("flow_id = ?");
    args.push(opts.flowId);
  }
  if (opts.kind) {
    where.push("kind = ?");
    args.push(opts.kind);
  }
  if (opts.enabledOnly) {
    where.push("enabled = 1");
  }
  const sql =
    "SELECT * FROM rt_flow_triggers" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY id ASC";
  return db.prepare(sql).all(...args) as FlowTriggerRow[];
}

/** Patch a trigger. Only fields present in `input` are updated. */
export function updateFlowTrigger(
  db: Database.Database,
  id: number,
  input: UpdateFlowTriggerInput,
): FlowTriggerRow | null {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    args.push(input.name);
  }
  if (input.enabled !== undefined) {
    sets.push("enabled = ?");
    args.push(input.enabled ? 1 : 0);
  }
  if (input.allowConcurrent !== undefined) {
    sets.push("allow_concurrent = ?");
    args.push(input.allowConcurrent ? 1 : 0);
  }
  if (input.cronExpr !== undefined) {
    sets.push("cron_expr = ?");
    args.push(input.cronExpr);
  }
  if (input.cronTz !== undefined) {
    sets.push("cron_tz = ?");
    args.push(input.cronTz);
  }
  if (input.webhookSlug !== undefined) {
    sets.push("webhook_slug = ?");
    args.push(input.webhookSlug);
  }
  if (input.webhookSecretRef !== undefined) {
    sets.push("webhook_secret_ref = ?");
    args.push(input.webhookSecretRef);
  }
  if (input.ipAllowlist !== undefined) {
    sets.push("ip_allowlist = ?");
    args.push(input.ipAllowlist);
  }
  if (input.inputMapping !== undefined) {
    sets.push("input_mapping = ?");
    args.push(input.inputMapping);
  }
  if (input.defaultInput !== undefined) {
    sets.push("default_input = ?");
    args.push(input.defaultInput);
  }
  if (input.ownerUserId !== undefined) {
    sets.push("owner_user_id = ?");
    args.push(input.ownerUserId);
  }
  if (sets.length === 0) return getFlowTrigger(db, id);

  sets.push("updated_at = datetime('now')");
  args.push(id);
  db.prepare(`UPDATE rt_flow_triggers SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return getFlowTrigger(db, id);
}

/** Delete a trigger (cascades to its trigger runs). */
export function deleteFlowTrigger(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM rt_flow_triggers WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Update `last_fired_at` to now. */
export function touchTriggerLastFired(db: Database.Database, id: number): void {
  db.prepare("UPDATE rt_flow_triggers SET last_fired_at = datetime('now') WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Trigger runs (history + lock)
// ---------------------------------------------------------------------------

/** Insert a trigger run record. Returns the created row. */
export function createTriggerRun(
  db: Database.Database,
  input: CreateTriggerRunInput,
): FlowTriggerRunRow {
  const result = db
    .prepare(
      `INSERT INTO rt_flow_trigger_runs (
         trigger_id, status, payload, idempotency_key, payload_hash, source_ip
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.triggerId,
      input.status,
      input.payload ?? null,
      input.idempotencyKey ?? null,
      input.payloadHash ?? null,
      input.sourceIp ?? null,
    );
  const row = getTriggerRun(db, Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to create trigger run");
  return row;
}

/** Fetch a trigger run by id. */
export function getTriggerRun(db: Database.Database, id: number): FlowTriggerRunRow | null {
  const row = db.prepare("SELECT * FROM rt_flow_trigger_runs WHERE id = ?").get(id) as
    | FlowTriggerRunRow
    | undefined;
  return row ?? null;
}

/** Update a trigger run's status (and optional metadata). */
export function updateTriggerRun(
  db: Database.Database,
  id: number,
  patch: {
    status?: FlowTriggerRunStatus;
    flowRunId?: number | null;
    finishedAt?: string | null;
    error?: string | null;
  },
): FlowTriggerRunRow | null {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.flowRunId !== undefined) {
    sets.push("flow_run_id = ?");
    args.push(patch.flowRunId);
  }
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = ?");
    args.push(patch.finishedAt);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    args.push(patch.error);
  }
  if (sets.length === 0) return getTriggerRun(db, id);
  args.push(id);
  db.prepare(`UPDATE rt_flow_trigger_runs SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return getTriggerRun(db, id);
}

/** List runs for a trigger, newest first. */
export function listTriggerRuns(
  db: Database.Database,
  triggerId: number,
  opts: { limit?: number; offset?: number } = {},
): FlowTriggerRunRow[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return db
    .prepare(
      "SELECT * FROM rt_flow_trigger_runs WHERE trigger_id = ? ORDER BY fired_at DESC, id DESC LIMIT ? OFFSET ?",
    )
    .all(triggerId, limit, offset) as FlowTriggerRunRow[];
}

/** True iff at least one run is in 'pending' or 'running' for the trigger. */
export function hasActiveTriggerRun(db: Database.Database, triggerId: number): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM rt_flow_trigger_runs WHERE trigger_id = ? AND status IN ('pending','running') LIMIT 1",
    )
    .get(triggerId);
  return !!row;
}

/**
 * Look up an existing run by idempotency key within `windowSeconds`.
 * Returns null when no match — the caller should treat that as
 * "first time, proceed". Returns the matching row otherwise — the
 * caller should mark the new request as `deduped`.
 */
export function findRunByIdempotencyKey(
  db: Database.Database,
  triggerId: number,
  idempotencyKey: string,
  windowSeconds = 24 * 3600,
): FlowTriggerRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM rt_flow_trigger_runs
       WHERE trigger_id = ? AND idempotency_key = ?
         AND fired_at >= datetime('now', ?)
       ORDER BY fired_at DESC LIMIT 1`,
    )
    .get(triggerId, idempotencyKey, `-${windowSeconds} seconds`) as FlowTriggerRunRow | undefined;
  return row ?? null;
}

/** Look up an existing run by payload hash within `windowSeconds`. */
export function findRunByPayloadHash(
  db: Database.Database,
  triggerId: number,
  payloadHash: string,
  windowSeconds = 5 * 60,
): FlowTriggerRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM rt_flow_trigger_runs
       WHERE trigger_id = ? AND payload_hash = ?
         AND fired_at >= datetime('now', ?)
       ORDER BY fired_at DESC LIMIT 1`,
    )
    .get(triggerId, payloadHash, `-${windowSeconds} seconds`) as FlowTriggerRunRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateKindFields(
  kind: FlowTriggerKind,
  fields: {
    cronExpr: string | null | undefined;
    webhookSlug: string | null | undefined;
    webhookSecretRef: string | null | undefined;
  },
): void {
  if (kind === "cron") {
    if (!fields.cronExpr) {
      throw new Error("cron triggers require a `cronExpr`");
    }
  } else {
    if (!fields.webhookSlug) {
      throw new Error("webhook triggers require a `webhookSlug`");
    }
    if (!fields.webhookSecretRef) {
      throw new Error("webhook triggers require a `webhookSecretRef`");
    }
  }
}
