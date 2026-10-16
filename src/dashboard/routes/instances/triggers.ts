// src/dashboard/routes/instances/triggers.ts
//
// CRUD routes for flow triggers (TRIGGER-001 + TRIGGER-001b instance-scope).
//
// All routes mount under `/api/instances/:slug/triggers/...` and are guarded
// by the existing dashboard auth middleware + `instanceMiddleware`. The
// public webhook endpoint (`/webhooks/triggers/:instanceSlug/:slug`) lives in
// `../webhooks.ts` and is intentionally outside the `/api/*` namespace.
//
// Routes:
//   GET    /api/instances/:slug/triggers                       — list (filters)
//   POST   /api/instances/:slug/triggers                       — create
//   GET    /api/instances/:slug/triggers/:id                   — detail + last 10 runs
//   PUT    /api/instances/:slug/triggers/:id                   — patch metadata
//   DELETE /api/instances/:slug/triggers/:id                   — delete (+ secret cleanup)
//   POST   /api/instances/:slug/triggers/:id/rotate-secret     — fresh HMAC secret
//   GET    /api/instances/:slug/triggers/:id/secret-reveal     — read once (rate-limited)
//   POST   /api/instances/:slug/triggers/:id/fire              — manual fire-now
//   GET    /api/instances/:slug/triggers/:id/runs              — paginated run history
//
// Cross-instance access is rejected with 404 — a trigger that belongs to
// another instance must not leak its existence.

import { isIP } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Cron } from "croner";
import type { Context, Hono } from "hono";
import type { RouteDeps } from "../../route-deps.js";
import { apiError } from "../../route-deps.js";
import { logger } from "../../../lib/logger.js";
import { getPermissionChecker, permission } from "../../middleware/permission.js";
import { ACTIONS } from "../../middleware/permission-actions.js";
import { getSecretProvider, secretProvider } from "../../../core/secrets/index.js";
import {
  createFlowTrigger,
  deleteFlowTrigger,
  getFlowTrigger,
  listFlowTriggers,
  listTriggerRuns,
  updateFlowTrigger,
  type FlowTriggerKind,
  type FlowTriggerRow,
} from "../../../core/repositories/flow-trigger-repository.js";
import { emitAudit } from "../../../core/audit/emitter.js";
import { getFlowDefinition } from "../../../core/repositories/flow-repository.js";
import { getInstanceContext } from "../_instance-middleware.js";

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

function validNetwork(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (extra !== undefined || !address) return false;
  const family = isIP(address);
  return (
    family !== 0 &&
    (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)))
  );
}
const IpAllowlist = z
  .array(z.string().min(1).max(64).refine(validNetwork, "Invalid IP address or CIDR"))
  .max(32);

const KindSchema = z.enum(["cron", "webhook"]);

// `instanceSlug` is supplied by the path; if a body still includes it (legacy
// clients), it is silently ignored — the path value always wins.
const CreateBaseSchema = z.object({
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
  webhookSecret: z
    .string()
    .min(16)
    .max(256)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u)
    .refine((value) => value.trim() === value, "Secret must not have surrounding whitespace")
    .optional(),
  ipAllowlist: IpAllowlist.optional(),
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
  ipAllowlist: IpAllowlist.nullable().optional(),
  inputMapping: InputMappingArray.nullable().optional(),
  defaultInput: z.record(z.string(), z.unknown()).nullable().optional(),
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

function newSecretKey(): string {
  return `${SECRET_KEY_PREFIX}${randomUUID()}`;
}

function parseIdParam(c: HonoContext): number | null {
  const raw = c.req.param("id");
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Fetch a trigger and ensure it belongs to the current instance scope.
 * Returns the row, or null if missing / cross-instance.
 */
function getScopedTrigger(
  db: RouteDeps["db"],
  id: number,
  instanceSlug: string,
): FlowTriggerRow | null {
  const row = getFlowTrigger(db, id);
  if (!row || row.instance_slug !== instanceSlug) return null;
  return row;
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
    signatureVersion: row.webhook_signature_version,
    secretRevoked: row.webhook_revoked_at !== null,
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
  const { slug: instanceSlug } = getInstanceContext(c);
  const flowIdQ = c.req.query("flowId");
  const kindQ = c.req.query("kind");
  const enabledQ = c.req.query("enabled");

  const opts: Parameters<typeof listFlowTriggers>[1] = { instanceSlug };
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
  instanceSlug: string,
  data: CreateData,
  webhookSecretRef: string | null,
): Parameters<typeof createFlowTrigger>[1] {
  return {
    instanceSlug,
    flowId: data.flowId,
    ...(data.ownerUserId !== undefined ? { ownerUserId: data.ownerUserId } : {}),
    signatureVersion: data.kind === "webhook" ? 2 : 1,
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
  const ref = newSecretKey();
  await getSecretProvider().set!(ref, data.webhookSecret);
  return ref;
}

async function handleCreate(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug: instanceSlug } = getInstanceContext(c);
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

  const flow = getFlowDefinition(deps.db, data.flowId);
  if (!flow || flow.instance_slug !== instanceSlug) {
    return apiError(c, 404, "NOT_FOUND", "Flow not found in this instance");
  }
  // Ownership is attribution to the authenticated creator, never caller-selected delegation.
  const creatorId = Number(c.get("user")?.id);
  data.ownerUserId = Number.isInteger(creatorId) && creatorId > 0 ? creatorId : undefined;

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
    row = createFlowTrigger(deps.db, buildCreateInput(instanceSlug, data, webhookSecretRef));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("trigger_create_failed", { event: "trigger_create_failed", error: reason });
    if (webhookSecretRef) await clearUnusedSecret(deps, webhookSecretRef);
    return apiError(c, 400, "CREATE_FAILED", "Could not create trigger");
  }

  deps.triggerScheduler?.reload(row.id);
  logger.info("trigger_created", { event: "trigger_created", triggerId: row.id, kind: row.kind });
  return c.json(serializeRow(row), 201);
}

async function handleDetail(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getScopedTrigger(deps.db, id, instanceSlug);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  const runs = listTriggerRuns(deps.db, id, { limit: 10 });
  const checker = getPermissionChecker();
  const decisions = await Promise.all(
    [
      ACTIONS.TRIGGER_REVEAL_SECRET,
      ACTIONS.TRIGGER_ROTATE_SECRET,
      ACTIONS.TRIGGER_REVOKE_SECRET,
    ].map((action) =>
      checker.check({
        user: c.get("user"),
        action,
        resource: { kind: "trigger", id: String(id) },
        attributes: { slug: instanceSlug },
      }),
    ),
  );
  return c.json({
    ...serializeRow(row),
    runs,
    secretPermissions: {
      reveal: decisions[0]!.allow,
      rotate: decisions[1]!.allow,
      revoke: decisions[2]!.allow,
    },
  });
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
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  if (!getScopedTrigger(deps.db, id, instanceSlug)) {
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
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const existing = getScopedTrigger(deps.db, id, instanceSlug);
  if (!existing) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);

  // Best-effort secret cleanup. Most providers don't expose delete; we
  // overwrite with empty string when possible — failure is logged, not fatal.
  if (existing.kind === "webhook" && existing.webhook_secret_ref) {
    try {
      const provider = getSecretProvider();
      if (provider.set) await clearUnusedSecret(deps, existing.webhook_secret_ref, id);
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

/** Erase only unreferenced material; legacy references may be shared across instances. */
async function clearUnusedSecret(deps: RouteDeps, ref: string, excludingId = -1): Promise<void> {
  const inUse = deps.db
    .prepare("SELECT 1 FROM rt_flow_triggers WHERE webhook_secret_ref = ? AND id != ? LIMIT 1")
    .get(ref, excludingId);
  if (inUse) return;
  try {
    await getSecretProvider().set?.(ref, "");
  } catch (err) {
    logger.warn("trigger_secret_cleanup_failed", { error: String(err) });
  }
}

async function handleRevokeSecret(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getScopedTrigger(deps.db, id, instanceSlug);
  if (!row) return apiError(c, 404, "NOT_FOUND", "Trigger not found");
  if (row.kind !== "webhook")
    return apiError(c, 400, "NOT_WEBHOOK", "Only webhook triggers have secrets");
  // Persist the admission gate before any asynchronous provider access.
  const previousTime = row.webhook_revoked_at ? Date.parse(row.webhook_revoked_at) : 0;
  const revokedAt = new Date(
    Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0),
  ).toISOString();
  updateFlowTrigger(deps.db, id, { revokedAt });
  emitAudit({
    kind: "trigger.secret_mutation",
    action: "revoke",
    triggerId: id,
    instanceSlug,
    by: c.get("user").id,
  });
  return c.json({ revoked: true });
}

async function handleRotateSecret(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getScopedTrigger(deps.db, id, instanceSlug);
  if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
  if (row.kind !== "webhook" || !row.webhook_slug) {
    return apiError(c, 400, "NOT_WEBHOOK", "Only webhook triggers have secrets");
  }
  const newSecret = generateSecret();
  const ref = newSecretKey();
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
  const stillExists = getScopedTrigger(deps.db, id, instanceSlug);
  if (!stillExists) {
    await clearUnusedSecret(deps, ref);
    return apiError(c, 404, "NOT_FOUND", "Trigger deleted during rotation");
  }
  if (
    stillExists.webhook_secret_ref !== row.webhook_secret_ref ||
    stillExists.webhook_revoked_at !== row.webhook_revoked_at
  ) {
    await clearUnusedSecret(deps, ref);
    return apiError(
      c,
      409,
      "SECRET_CHANGED",
      "Secret changed during rotation; retry from current state",
    );
  }
  updateFlowTrigger(deps.db, id, { webhookSecretRef: ref, revokedAt: null });
  if (row.webhook_secret_ref) await clearUnusedSecret(deps, row.webhook_secret_ref);
  emitAudit({
    kind: "trigger.secret_mutation",
    action: "rotate",
    triggerId: id,
    instanceSlug,
    by: c.get("user").id,
  });
  logger.info("trigger_secret_rotated", { event: "trigger_secret_rotated", triggerId: id });
  c.header("Cache-Control", "no-store");
  return c.json({ secret: newSecret, secretRef: ref });
}

function makeRevealHandler(buckets: Map<string, RateBucket>) {
  return async function handleRevealSecret(c: HonoContext, deps: RouteDeps): Promise<Response> {
    const { slug: instanceSlug } = getInstanceContext(c);
    const id = parseIdParam(c);
    if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
    const row = getScopedTrigger(deps.db, id, instanceSlug);
    if (!row) return apiError(c, 404, "NOT_FOUND", `Trigger not found: ${id}`);
    if (row.kind !== "webhook" || !row.webhook_secret_ref) {
      return apiError(c, 400, "NOT_WEBHOOK", "Only webhook triggers have secrets");
    }
    if (row.webhook_revoked_at) return apiError(c, 409, "SECRET_REVOKED", "Webhook secret revoked");
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
    const latest = getScopedTrigger(deps.db, id, instanceSlug);
    if (
      !latest ||
      latest.webhook_revoked_at ||
      latest.webhook_secret_ref !== row.webhook_secret_ref
    )
      return apiError(c, 409, "SECRET_CHANGED", "Secret changed while reading");
    c.header("Cache-Control", "no-store");
    return c.json({ secret });
  };
}

async function handleFire(c: HonoContext, deps: RouteDeps): Promise<Response> {
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  const row = getScopedTrigger(deps.db, id, instanceSlug);
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
  const { slug: instanceSlug } = getInstanceContext(c);
  const id = parseIdParam(c);
  if (id === null) return apiError(c, 400, "INVALID_ID", "Invalid trigger id");
  if (!getScopedTrigger(deps.db, id, instanceSlug)) {
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
  const attr = (c: HonoContext) => ({ slug: c.req.param("slug") });
  const revealBuckets = new Map<string, RateBucket>();
  const reveal = makeRevealHandler(revealBuckets);

  app.get(
    "/api/instances/:slug/triggers",
    permission({ action: ACTIONS.TRIGGER_LIST, resource: triggerKind, attributes: attr }),
    (c) => handleList(c, deps),
  );
  app.post(
    "/api/instances/:slug/triggers",
    permission({ action: ACTIONS.TRIGGER_CREATE, resource: triggerKind, attributes: attr }),
    async (c) => handleCreate(c, deps),
  );
  app.get(
    "/api/instances/:slug/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_READ, resource: triggerId, attributes: attr }),
    (c) => handleDetail(c, deps),
  );
  app.put(
    "/api/instances/:slug/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_UPDATE, resource: triggerId, attributes: attr }),
    async (c) => handleUpdate(c, deps),
  );
  app.delete(
    "/api/instances/:slug/triggers/:id",
    permission({ action: ACTIONS.TRIGGER_DELETE, resource: triggerId, attributes: attr }),
    async (c) => handleDelete(c, deps),
  );
  app.post(
    "/api/instances/:slug/triggers/:id/revoke-secret",
    permission({ action: ACTIONS.TRIGGER_REVOKE_SECRET, resource: triggerId, attributes: attr }),
    async (c) => handleRevokeSecret(c, deps),
  );
  app.post(
    "/api/instances/:slug/triggers/:id/rotate-secret",
    permission({ action: ACTIONS.TRIGGER_ROTATE_SECRET, resource: triggerId, attributes: attr }),
    async (c) => handleRotateSecret(c, deps),
  );
  app.get(
    "/api/instances/:slug/triggers/:id/secret-reveal",
    permission({ action: ACTIONS.TRIGGER_REVEAL_SECRET, resource: triggerId, attributes: attr }),
    async (c) => reveal(c, deps),
  );
  app.post(
    "/api/instances/:slug/triggers/:id/fire",
    permission({ action: ACTIONS.TRIGGER_FIRE, resource: triggerId, attributes: attr }),
    async (c) => handleFire(c, deps),
  );
  app.get(
    "/api/instances/:slug/triggers/:id/runs",
    permission({ action: ACTIONS.TRIGGER_RUNS_LIST, resource: triggerId, attributes: attr }),
    (c) => handleListRuns(c, deps),
  );
}
