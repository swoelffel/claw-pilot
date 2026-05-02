// src/dashboard/routes/triggers.ts
//
// CRUD routes for flow triggers (TRIGGER-001 — PR 3/3).
//
// All routes mount under `/api/triggers/...` and are guarded by the existing
// dashboard auth middleware. The public webhook endpoint
// (`/webhooks/triggers/:slug`) lives in `webhooks.ts` and is intentionally
// outside the `/api/*` namespace.
//
// Routes:
//   GET    /api/triggers                           — list (filters)
//   POST   /api/triggers                           — create
//   GET    /api/triggers/:id                       — detail + last 10 runs
//   PUT    /api/triggers/:id                       — patch metadata
//   DELETE /api/triggers/:id                       — delete (+ secret cleanup)
//   POST   /api/triggers/:id/rotate-secret         — generate fresh HMAC secret
//   GET    /api/triggers/:id/secret-reveal         — read once (rate-limited)
//   POST   /api/triggers/:id/fire                  — manual fire-now
//   GET    /api/triggers/:id/runs                  — paginated run history

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Cron } from "croner";
import type { Context, Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { logger } from "../../lib/logger.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";
import { getSecretProvider, secretProvider } from "../../core/secrets/index.js";
import {
  createFlowTrigger,
  deleteFlowTrigger,
  getFlowTrigger,
  listFlowTriggers,
  listTriggerRuns,
  updateFlowTrigger,
  type FlowTriggerKind,
  type FlowTriggerRow,
} from "../../core/repositories/flow-trigger-repository.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_SLUG_RE = /^[a-z0-9-]{3,64}$/;
const SECRET_KEY_PREFIX = "TRIGGER_WEBHOOK_SECRET:";
const REVEAL_RATE_MAX = 3;
const REVEAL_RATE_WINDOW_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const InputMappingEntry = z.object({
  from: z.string().min(1).max(256),
  to: z.string().min(1).max(64),
});

const InputMappingArray = z.array(InputMappingEntry).max(64);

const KindSchema = z.enum(["cron", "webhook"]);

const CreateBaseSchema = z.object({
  instanceSlug: z.string().min(1).max(128),
  flowId: z.number().int().positive(),
  ownerUserId: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  kind: KindSchema,
  enabled: z.boolean().optional(),
  allowConcurrent: z.boolean().optional(),
  // cron-only
  cronExpr: z.string().min(1).max(128).optional(),
  cronTz: z.string().min(1).max(64).optional(),
  // webhook-only
  webhookSlug: z.string().regex(WEBHOOK_SLUG_RE).optional(),
  webhookSecret: z.string().min(16).max(256).optional(),
  ipAllowlist: z.array(z.string().min(1).max(64)).max(32).optional(),
  // mapping
  inputMapping: InputMappingArray.optional(),
  defaultInput: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  allowConcurrent: z.boolean().optional(),
  cronExpr: z.string().min(1).max(128).optional(),
  cronTz: z.string().min(1).max(64).nullable().optional(),
  webhookSlug: z.string().regex(WEBHOOK_SLUG_RE).optional(),
  ipAllowlist: z.array(z.string().min(1).max(64)).max(32).nullable().optional(),
  inputMapping: InputMappingArray.nullable().optional(),
  defaultInput: z.record(z.string(), z.unknown()).nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidCron(expr: string): boolean {
  try {
    const job = new Cron(expr, { paused: true });
    job.stop();
    return true;
  } catch (err) {
    logger.debug("trigger_cron_validation_failed", {
      event: "trigger_cron_validation_failed",
      expr,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

function secretKeyFor(slug: string): string {
  return `${SECRET_KEY_PREFIX}${slug}`;
}

function parseIdParam(c: HonoContext): number | null {
  const raw = c.req.param("id");
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function serializeRow(row: FlowTriggerRow): Record<string, unknown> {
  return {
    id: row.id,
    orgId: row.org_id,
    instanceSlug: row.instance_slug,
    flowId: row.flow_id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled === 1,
    allowConcurrent: row.allow_concurrent === 1,
    cronExpr: row.cron_expr,
    cronTz: row.cron_tz,
    webhookSlug: row.webhook_slug,
    webhookSecretRef: row.webhook_secret_ref,
    ipAllowlist: row.ip_allowlist ? safeParseJson(row.ip_allowlist) : null,
    inputMapping: row.input_mapping ? safeParseJson(row.input_mapping) : null,
    defaultInput: row.default_input ? safeParseJson(row.default_input) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastFiredAt: row.last_fired_at,
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn("trigger_json_parse_failed", {
      event: "trigger_json_parse_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function getClientIp(c: HonoContext): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const first = (fwd as string).split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

interface RateBucket {
  timestamps: number[];
}

function checkReveal(buckets: Map<string, RateBucket>, key: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  while (bucket.timestamps.length > 0 && now - bucket.timestamps[0]! >= REVEAL_RATE_WINDOW_MS) {
    bucket.timestamps.shift();
  }
  if (bucket.timestamps.length >= REVEAL_RATE_MAX) return false;
  bucket.timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleList(c: HonoContext, deps: RouteDeps): Response {
  const instanceSlug = c.req.query("instanceSlug");
  const flowIdQ = c.req.query("flowId");
  const kindQ = c.req.query("kind");
  const enabledQ = c.req.query("enabled");

  const opts: Parameters<typeof listFlowTriggers>[1] = {};
  if (instanceSlug) opts.instanceSlug = instanceSlug;
  if (flowIdQ) {
    const n = Number(flowIdQ);
    if (Number.isInteger(n)) opts.flowId = n;
  }
  if (kindQ === "cron" || kindQ === "webhook") opts.kind = kindQ as FlowTriggerKind;
  if (enabledQ === "true") opts.enabledOnly = true;

  const rows = listFlowTriggers(deps.db, opts);
  return c.json(rows.map(serializeRow));
}

type CreateData = z.infer<typeof CreateBaseSchema>;

/** Validate kind-specific required fields. Returns an error message or null. */
function validateCreatePayload(data: CreateData): string | null {
  if (data.kind === "cron") {
    if (!data.cronExpr) return "cron triggers require cronExpr";
    if (!isValidCron(data.cronExpr)) return `__cron__:${data.cronExpr}`;
    return null;
  }
  if (!data.webhookSlug) return "webhook triggers require webhookSlug";
  if (!data.webhookSecret) return "webhook triggers require webhookSecret";
  return null;
}

/** Build the createFlowTrigger input from validated body data. */
function buildCreateInput(
  data: CreateData,
  webhookSecretRef: string | null,
): Parameters<typeof createFlowTrigger>[1] {
  return {
    instanceSlug: data.instanceSlug,
    flowId: data.flowId,
    ...(data.ownerUserId !== undefined ? { ownerUserId: data.ownerUserId } : {}),
    kind: data.kind,
    name: data.name,
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    ...(data.allowConcurrent !== undefined ? { allowConcurrent: data.allowConcurrent } : {}),
    ...(data.cronExpr !== undefined ? { cronExpr: data.cronExpr } : {}),
    ...(data.cronTz !== undefined ? { cronTz: data.cronTz } : {}),
    ...(data.webhookSlug !== undefined ? { webhookSlug: data.webhookSlug } : {}),
    ...(webhookSecretRef !== null ? { webhookSecretRef } : {}),
    ...(data.ipAllowlist !== undefined ? { ipAllowlist: JSON.stringify(data.ipAllowlist) } : {}),
    ...(data.inputMapping !== undefined ? { inputMapping: JSON.stringify(data.inputMapping) } : {}),
    ...(data.defaultInput !== undefined ? { defaultInput: JSON.stringify(data.defaultInput) } : {}),
  };
}

/** Persist the webhook secret if needed. Returns the ref or null. Throws on failure. */
async function persistWebhookSecret(data: CreateData): Promise<string | null> {
  if (data.kind !== "webhook" || !data.webhookSlug || !data.webhookSecret) return null;
  const ref = secretKeyFor(data.webhookSlug);
  await getSecretProvider().set!(ref, data.webhookSecret);
  return ref;
}

async function handleCreate(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateBaseSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const data = parsed.data;

  const validationError = validateCreatePayload(data);
  if (validationError) {
    if (validationError.startsWith("__cron__:")) {
      return apiError(
        c,
        400,
        "INVALID_CRON",
        `Invalid cron expression: ${validationError.slice("__cron__:".length)}`,
      );
    }
    return apiError(c, 400, "INVALID_BODY", validationError);
  }

  let webhookSecretRef: string | null;
  try {
    webhookSecretRef = await persistWebhookSecret(data);
  } catch (err) {
    logger.error("trigger_secret_persist_failed", {
      event: "trigger_secret_persist_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError(c, 500, "SECRET_PERSIST_FAILED", "Failed to persist webhook secret");
  }

  let row: FlowTriggerRow;
  try {
    row = createFlowTrigger(deps.db, buildCreateInput(data, webhookSecretRef));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("trigger_create_failed", { event: "trigger_create_failed", error: reason });
    return apiError(c, 400, "CREATE_FAILED", reason);
  }

  deps.triggerScheduler?.reload(row.id);
  logger.info("trigger_created", { event: "trigger_created", triggerId: row.id, kind: row.kind });
  return c.json(serializeRow(row), 201);
}

function handleDetail(c: HonoContext, deps: RouteDeps): Response {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getFlowTrigger(deps.db, id);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  const runs = listTriggerRuns(deps.db, id, { limit: 10 });
  return c.json({ ...serializeRow(row), runs });
}

type UpdateData = z.infer<typeof UpdateSchema>;

/** Translate the validated update payload into a repository patch. */
function buildUpdatePatch(d: UpdateData): Parameters<typeof updateFlowTrigger>[2] {
  const patch: Parameters<typeof updateFlowTrigger>[2] = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.enabled !== undefined) patch.enabled = d.enabled;
  if (d.allowConcurrent !== undefined) patch.allowConcurrent = d.allowConcurrent;
  if (d.cronExpr !== undefined) patch.cronExpr = d.cronExpr;
  if (d.cronTz !== undefined) patch.cronTz = d.cronTz ?? null;
  if (d.webhookSlug !== undefined) patch.webhookSlug = d.webhookSlug;
  if (d.ipAllowlist !== undefined) {
    patch.ipAllowlist = d.ipAllowlist === null ? null : JSON.stringify(d.ipAllowlist);
  }
  if (d.inputMapping !== undefined) {
    patch.inputMapping = d.inputMapping === null ? null : JSON.stringify(d.inputMapping);
  }
  if (d.defaultInput !== undefined) {
    patch.defaultInput = d.defaultInput === null ? null : JSON.stringify(d.defaultInput);
  }
  if (d.ownerUserId !== undefined) patch.ownerUserId = d.ownerUserId;
  return patch;
}

/** Whether the patch touches any cron-scheduling-relevant field. */
function patchNeedsReload(d: UpdateData): boolean {
  return (
    d.enabled !== undefined ||
    d.cronExpr !== undefined ||
    d.cronTz !== undefined ||
    d.allowConcurrent !== undefined
  );
}

async function handleUpdate(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  if (!getFlowTrigger(deps.db, id)) {
    return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 400, "INVALID_BODY", parsed.error.message);
  const d = parsed.data;

  if (d.cronExpr !== undefined && !isValidCron(d.cronExpr)) {
    return apiError(c, 400, "INVALID_CRON", `Invalid cron expression: ${d.cronExpr}`);
  }

  const updated = updateFlowTrigger(deps.db, id, buildUpdatePatch(d));
  if (!updated) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);

  if (patchNeedsReload(d)) deps.triggerScheduler?.reload(id);

  logger.info("trigger_updated", { event: "trigger_updated", triggerId: id });
  return c.json(serializeRow(updated));
}

async function handleDelete(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const existing = getFlowTrigger(deps.db, id);
  if (!existing) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);

  // Best-effort secret cleanup. Most providers don't expose delete; we
  // overwrite with empty string when possible — failure is logged, not fatal.
  if (existing.kind === "webhook" && existing.webhook_secret_ref) {
    try {
      const provider = getSecretProvider();
      if (provider.set) await provider.set(existing.webhook_secret_ref, "");
    } catch (err) {
      logger.warn("trigger_secret_cleanup_failed", {
        event: "trigger_secret_cleanup_failed",
        triggerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  deleteFlowTrigger(deps.db, id);
  deps.triggerScheduler?.reload(id);
  logger.info("trigger_deleted", { event: "trigger_deleted", triggerId: id });
  return new Response(null, { status: 204 });
}

async function handleRotateSecret(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getFlowTrigger(deps.db, id);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  if (row.kind !== "webhook" || !row.webhook_slug) {
    return apiError(c, 400, "NOT_WEBHOOK", "Only webhook triggers have secrets");
  }
  const newSecret = generateSecret();
  const ref = row.webhook_secret_ref ?? secretKeyFor(row.webhook_slug);
  try {
    await getSecretProvider().set!(ref, newSecret);
  } catch (err) {
    logger.error("trigger_rotate_failed", {
      event: "trigger_rotate_failed",
      triggerId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError(c, 500, "ROTATE_FAILED", "Failed to rotate secret");
  }
  if (!row.webhook_secret_ref) {
    updateFlowTrigger(deps.db, id, { webhookSecretRef: ref });
  }
  logger.info("trigger_secret_rotated", { event: "trigger_secret_rotated", triggerId: id });
  return c.json({ secret: newSecret, secretRef: ref });
}

function makeRevealHandler(buckets: Map<string, RateBucket>) {
  return async function handleRevealSecret(c: HonoContext, deps: RouteDeps): Promise<Response> {
    const id = parseIdParam(c);
    if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
    const row = getFlowTrigger(deps.db, id);
    if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
    if (row.kind !== "webhook" || !row.webhook_secret_ref) {
      return apiError(c, 400, "NOT_WEBHOOK", "Only webhook triggers have secrets");
    }
    const ip = getClientIp(c);
    if (!checkReveal(buckets, ip)) {
      return apiError(c, 429, "RATE_LIMITED", "Too many reveal attempts");
    }
    const user = c.get("user") as { id: string } | undefined;
    let secret: string;
    try {
      // Use the proxy so the H6 audit emission (`secret.access`) fires.
      secret = await secretProvider.get(row.webhook_secret_ref, {
        audit: true,
        by: user?.id ?? "system",
      });
    } catch (err) {
      logger.error("trigger_reveal_failed", {
        event: "trigger_reveal_failed",
        triggerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return apiError(c, 500, "REVEAL_FAILED", "Failed to read secret");
    }
    return c.json({ secret });
  };
}

async function handleFire(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getFlowTrigger(deps.db, id);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  if (!deps.triggerScheduler) {
    return apiError(c, 503, "SCHEDULER_UNAVAILABLE", "Scheduler not wired");
  }
  // Fire-and-forget; the scheduler creates its own run row.
  void deps.triggerScheduler.fire(id).catch((err: unknown) => {
    logger.error("trigger_fire_unhandled", {
      event: "trigger_fire_unhandled",
      triggerId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  logger.info("trigger_fire_requested", { event: "trigger_fire_requested", triggerId: id });
  return c.json({ accepted: true, triggerId: id }, 202);
}

function handleListRuns(c: HonoContext, deps: RouteDeps): Response {
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  if (!getFlowTrigger(deps.db, id)) {
    return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  }
  const limitQ = c.req.query("limit");
  const offsetQ = c.req.query("offset");
  const limit = Math.min(Math.max(Number(limitQ ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(offsetQ ?? 0) || 0, 0);
  const runs = listTriggerRuns(deps.db, id, { limit, offset });
  return c.json({ runs, limit, offset });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTriggerRoutes(app: Hono, deps: RouteDeps): void {
  const triggerKind = { kind: "trigger" } as const;
  const triggerId = { kind: "trigger", id: (c: Context) => c.req.param("id") } as const;
  const revealBuckets = new Map<string, RateBucket>();
  const reveal = makeRevealHandler(revealBuckets);

  app.get(
    "/api/triggers",
    permission({ action: ACTIONS.TRIGGER_LIST, resource: triggerKind }),
    (c) => handleList(c, deps),
  );
  app.post(
    "/api/triggers",
    permission({ action: ACTIONS.TRIGGER_CREATE, resource: triggerKind }),
    async (c) => handleCreate(c, deps),
  );
  app.get(
    "/api/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_READ, resource: triggerId }),
    (c) => handleDetail(c, deps),
  );
  app.put(
    "/api/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_UPDATE, resource: triggerId }),
    async (c) => handleUpdate(c, deps),
  );
  app.delete(
    "/api/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_DELETE, resource: triggerId }),
    async (c) => handleDelete(c, deps),
  );
  app.post(
    "/api/triggers/:id/rotate-secret",
    permission({ action: ACTIONS.TRIGGER_ROTATE_SECRET, resource: triggerId }),
    async (c) => handleRotateSecret(c, deps),
  );
  app.get(
    "/api/triggers/:id/secret-reveal",
    permission({ action: ACTIONS.TRIGGER_REVEAL_SECRET, resource: triggerId }),
    async (c) => reveal(c, deps),
  );
  app.post(
    "/api/triggers/:id/fire",
    permission({ action: ACTIONS.TRIGGER_FIRE, resource: triggerId }),
    async (c) => handleFire(c, deps),
  );
  app.get(
    "/api/triggers/:id/runs",
    permission({ action: ACTIONS.TRIGGER_RUNS_LIST, resource: triggerId }),
    (c) => handleListRuns(c, deps),
  );
}
