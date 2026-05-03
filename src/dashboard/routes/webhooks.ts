// src/dashboard/routes/webhooks.ts
//
// Inbound webhook endpoint for TRIGGER-001 —
//   POST /webhooks/triggers/:instanceSlug/:slug.
//
// Mounted OUTSIDE `/api/*` so the dashboard auth middleware does not gate it
// — webhook auth is HMAC-SHA256 (`X-ClawPilot-Signature: sha256=<hex>`) with
// an optional IP allowlist. The instance segment scopes the lookup so the
// same `:slug` may exist in different instances without collision.
//
// Pipeline:
//   1. Resolve trigger by webhook slug (404/503 on missing/disabled).
//   2. Read raw body once for HMAC + hashing.
//   3. Resolve secret via `getSecretProvider()` and verify HMAC.
//   4. Optional IP allowlist (CIDR or exact).
//   5. Idempotency: `Idempotency-Key` header → 24h window;
//      otherwise SHA-256(body) → 5min window.
//   6. Concurrency lock unless `allow_concurrent`.
//   7. Insert run row (`pending`) → start flow → mark `succeeded` + flow run id.
//   8. Sliding-window rate limit 60 req/min/slug, in-memory.
//
// All errors are audited (`trigger.failed`); successful fires emit
// `trigger.fired`; idempotency hits emit `trigger.deduped`.

import type { Context, Hono } from "hono";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { RouteDeps } from "../route-deps.js";
import {
  createTriggerRun,
  findRunByIdempotencyKey,
  findRunByPayloadHash,
  getFlowTriggerByWebhookSlug,
  hasActiveTriggerRun,
  touchTriggerLastFired,
  updateTriggerRun,
  type FlowTriggerRow,
} from "../../core/repositories/flow-trigger-repository.js";
import { emitAudit } from "../../core/audit/emitter.js";
import { getSecretProvider } from "../../core/secrets/index.js";
import {
  hashPayload,
  isIpAllowed,
  verifyHmacSignature,
} from "../../runtime/triggers/webhook-verifier.js";
import { logger } from "../../lib/logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Starts a flow run for a webhook fire. Returns the flow run id. */
export type WebhookRuntimeStarter = (
  instanceSlug: string,
  flowId: number,
  triggerDetail: string,
) => number | Promise<number>;

export interface WebhookRouteOptions {
  /**
   * Override the runtime starter (test injection). Defaults to the
   * `/internal/flows/:id/run` HTTP call against the runtime daemon.
   */
  runtimeStarter?: WebhookRuntimeStarter;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SLUG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SlugSchema = z.string().regex(SLUG_RE);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAllowlist(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch (err) {
    logger.warn("trigger_webhook_allowlist_parse_failed", {
      event: "trigger_webhook_allowlist_parse_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function getClientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
}

function emitFail(trigger: FlowTriggerRow, reason: string): void {
  emitAudit({
    kind: "trigger.failed",
    triggerId: trigger.id,
    flowId: trigger.flow_id,
    reason,
    source: "webhook",
  });
}

function checkRate(buckets: Map<string, number[]>, key: string): boolean {
  const now = Date.now();
  let timestamps = buckets.get(key);
  if (!timestamps) {
    timestamps = [];
    buckets.set(key, timestamps);
  }
  while (timestamps.length > 0 && now - timestamps[0]! >= RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Default runtime starter — POST to runtime daemon
// ---------------------------------------------------------------------------

async function defaultRuntimeStarter(
  instanceSlug: string,
  flowId: number,
  triggerDetail: string,
): Promise<number> {
  const { callRuntimeApi } = await import("./_internal-api-client.js");
  const result = await callRuntimeApi<{ runId: number }>(
    instanceSlug,
    `/internal/flows/${flowId}/run`,
    { triggerType: "webhook", triggerDetail },
  );
  return result.runId;
}

// ---------------------------------------------------------------------------
// Handler stages — each returns a Response when terminating, otherwise a
// continuation value (`null` typically meaning "ok, keep going").
// ---------------------------------------------------------------------------

interface VerifiedRequest {
  trigger: FlowTriggerRow;
  body: string;
  payloadHash: string;
  clientIp: string;
  idemKey: string | null;
}

/** Resolve the trigger row by (instance, slug); 404/503/500 on bad states. */
function resolveTrigger(
  c: Context,
  db: Database.Database,
  instanceSlug: string,
  slug: string,
): FlowTriggerRow | Response {
  const trigger = getFlowTriggerByWebhookSlug(db, instanceSlug, slug);
  if (!trigger) return c.json({ error: "Webhook not found", code: "NOT_FOUND" }, 404);
  if (trigger.enabled !== 1) return c.json({ error: "Webhook disabled", code: "DISABLED" }, 503);
  if (trigger.kind !== "webhook" || !trigger.webhook_secret_ref) {
    return c.json({ error: "Webhook not configured", code: "NOT_CONFIGURED" }, 500);
  }
  return trigger;
}

/** HMAC + IP allowlist enforcement. Returns the verified shape or a Response. */
async function authorizeRequest(
  c: Context,
  trigger: FlowTriggerRow,
  body: string,
): Promise<{ clientIp: string } | Response> {
  const sig = c.req.header("x-clawpilot-signature");
  if (!sig) {
    emitFail(trigger, "missing_signature");
    return c.json({ error: "Missing signature", code: "UNAUTHORIZED" }, 401);
  }

  let secret: string;
  try {
    secret = await getSecretProvider().get(trigger.webhook_secret_ref!);
  } catch (err) {
    logger.error("trigger_webhook_secret_missing", {
      event: "trigger_webhook_secret_missing",
      triggerId: trigger.id,
      secretRef: trigger.webhook_secret_ref,
      error: err instanceof Error ? err.message : String(err),
    });
    emitFail(trigger, "secret_unavailable");
    return c.json({ error: "Webhook misconfigured", code: "MISCONFIGURED" }, 500);
  }

  if (!verifyHmacSignature(secret, body, sig)) {
    emitFail(trigger, "hmac_mismatch");
    return c.json({ error: "Invalid signature", code: "UNAUTHORIZED" }, 401);
  }

  const allowlist = parseAllowlist(trigger.ip_allowlist);
  const clientIp = getClientIp(c.req.raw.headers);
  if (allowlist && !isIpAllowed(clientIp, allowlist)) {
    emitFail(trigger, "ip_not_allowed");
    return c.json({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  return { clientIp };
}

/** Idempotency / dedup. Returns a Response on hit, null otherwise. */
function checkDedup(c: Context, db: Database.Database, ctx: VerifiedRequest): Response | null {
  if (ctx.idemKey) {
    const prior = findRunByIdempotencyKey(db, ctx.trigger.id, ctx.idemKey);
    if (prior) return recordDedup(c, db, ctx, prior.id, "idempotency_key");
  } else {
    const prior = findRunByPayloadHash(db, ctx.trigger.id, ctx.payloadHash);
    if (prior) return recordDedup(c, db, ctx, prior.id, "payload_hash");
  }
  return null;
}

function recordDedup(
  c: Context,
  db: Database.Database,
  ctx: VerifiedRequest,
  priorRunId: number,
  method: "idempotency_key" | "payload_hash",
): Response {
  const dup = createTriggerRun(db, {
    triggerId: ctx.trigger.id,
    status: "deduped",
    payload: ctx.body,
    ...(ctx.idemKey ? { idempotencyKey: ctx.idemKey } : {}),
    payloadHash: ctx.payloadHash,
    sourceIp: ctx.clientIp,
  });
  emitAudit({ kind: "trigger.deduped", triggerId: ctx.trigger.id, method });
  return c.json({ deduped: true, runId: dup.id, priorRunId }, 200);
}

/** Concurrency lock check. Returns a Response on rejection, null otherwise. */
function checkConcurrency(
  c: Context,
  db: Database.Database,
  ctx: VerifiedRequest,
): Response | null {
  if (ctx.trigger.allow_concurrent === 1) return null;
  if (!hasActiveTriggerRun(db, ctx.trigger.id)) return null;

  const skipped = createTriggerRun(db, {
    triggerId: ctx.trigger.id,
    status: "skipped_concurrent",
    payload: ctx.body,
    ...(ctx.idemKey ? { idempotencyKey: ctx.idemKey } : {}),
    payloadHash: ctx.payloadHash,
    sourceIp: ctx.clientIp,
  });
  emitAudit({
    kind: "trigger.failed",
    triggerId: ctx.trigger.id,
    flowId: ctx.trigger.flow_id,
    reason: "skipped_concurrent",
    source: "webhook",
  });
  return c.json({ skipped: true, reason: "concurrent_run_active", runId: skipped.id }, 202);
}

/** Happy path — start the flow run and record the result. */
async function startRun(
  c: Context,
  db: Database.Database,
  ctx: VerifiedRequest,
  slug: string,
  runtimeStarter: WebhookRuntimeStarter,
): Promise<Response> {
  const run = createTriggerRun(db, {
    triggerId: ctx.trigger.id,
    status: "pending",
    payload: ctx.body,
    ...(ctx.idemKey ? { idempotencyKey: ctx.idemKey } : {}),
    payloadHash: ctx.payloadHash,
    sourceIp: ctx.clientIp,
  });

  try {
    const detail = JSON.stringify({
      slug,
      triggerId: ctx.trigger.id,
      triggerRunId: run.id,
      payloadPreview: ctx.body.slice(0, 200),
    });
    const flowRunId = await runtimeStarter(ctx.trigger.instance_slug, ctx.trigger.flow_id, detail);
    updateTriggerRun(db, run.id, {
      status: "succeeded",
      flowRunId,
      finishedAt: new Date().toISOString(),
    });
    touchTriggerLastFired(db, ctx.trigger.id);
    emitAudit({
      kind: "trigger.fired",
      triggerId: ctx.trigger.id,
      flowId: ctx.trigger.flow_id,
      instanceSlug: ctx.trigger.instance_slug,
      source: "webhook",
    });
    return c.json({ runId: run.id, flowRunId }, 202);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("trigger_webhook_start_failed", {
      event: "trigger_webhook_start_failed",
      slug,
      triggerId: ctx.trigger.id,
      error: reason,
    });
    updateTriggerRun(db, run.id, {
      status: "failed",
      error: reason,
      finishedAt: new Date().toISOString(),
    });
    emitAudit({
      kind: "trigger.failed",
      triggerId: ctx.trigger.id,
      flowId: ctx.trigger.flow_id,
      reason,
      source: "webhook",
    });
    return c.json({ error: "Failed to start flow run", code: "FLOW_START_FAILED" }, 500);
  }
}

async function readBody(c: Context, slug: string): Promise<string | Response> {
  try {
    return await c.req.text();
  } catch (err) {
    logger.warn("trigger_webhook_body_read_failed", {
      event: "trigger_webhook_body_read_failed",
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "Invalid body", code: "INVALID_BODY" }, 400);
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerWebhookRoutes(
  app: Hono,
  deps: RouteDeps,
  options: WebhookRouteOptions = {},
): void {
  const { db } = deps;
  const runtimeStarter = options.runtimeStarter ?? defaultRuntimeStarter;
  const buckets = new Map<string, number[]>();

  app.post("/webhooks/triggers/:instanceSlug/:slug", async (c) => {
    const instanceSlugCheck = SlugSchema.safeParse(c.req.param("instanceSlug"));
    if (!instanceSlugCheck.success) {
      return c.json({ error: "Invalid instance slug", code: "INVALID_SLUG" }, 400);
    }
    const slugCheck = SlugSchema.safeParse(c.req.param("slug"));
    if (!slugCheck.success) {
      return c.json({ error: "Invalid slug", code: "INVALID_SLUG" }, 400);
    }
    const instanceSlug = instanceSlugCheck.data;
    const slug = slugCheck.data;

    const rateKey = `${instanceSlug}:${slug}`;
    if (!checkRate(buckets, rateKey)) {
      return c.json({ error: "Too many requests", code: "RATE_LIMITED" }, 429);
    }

    const triggerOrRes = resolveTrigger(c, db, instanceSlug, slug);
    if (triggerOrRes instanceof Response) return triggerOrRes;

    const bodyOrRes = await readBody(c, slug);
    if (bodyOrRes instanceof Response) return bodyOrRes;
    const body = bodyOrRes;

    const authResult = await authorizeRequest(c, triggerOrRes, body);
    if (authResult instanceof Response) return authResult;

    const verified: VerifiedRequest = {
      trigger: triggerOrRes,
      body,
      payloadHash: hashPayload(body),
      clientIp: authResult.clientIp,
      idemKey: c.req.header("idempotency-key") ?? null,
    };

    const dedupRes = checkDedup(c, db, verified);
    if (dedupRes) return dedupRes;

    const concRes = checkConcurrency(c, db, verified);
    if (concRes) return concRes;

    return startRun(c, db, verified, slug, runtimeStarter);
  });
}
