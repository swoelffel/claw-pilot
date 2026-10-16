/** HMAC-authenticated inbound trigger admission, outside dashboard session auth. */
import { isIP } from "node:net";
// cspell:ignore conninfo
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import {
  createTriggerRun,
  findRunByIdempotencyKey,
  findRunByPayloadHash,
  getFlowTrigger,
  getFlowTriggerByWebhookSlug,
  hasActiveTriggerRun,
  touchTriggerLastFired,
  updateTriggerRun,
  type FlowTriggerRow,
} from "../../core/repositories/flow-trigger-repository.js";
import { getFlowDefinition } from "../../core/repositories/flow-repository.js";
import { canRunWorkflowUnattended } from "../../core/repositories/workflow-governance-repository.js";
import { emitAudit } from "../../core/audit/emitter.js";
import { getSecretProvider } from "../../core/secrets/index.js";
import {
  hashPayload,
  isIpAllowed,
  verifyHmacSignature,
} from "../../runtime/triggers/webhook-verifier.js";
import { logger } from "../../lib/logger.js";

/** Runtime must link this trigger run before executing the first flow step. */
export type WebhookRuntimeStarter = (
  instanceSlug: string,
  flowId: number,
  triggerDetail: string,
  triggerRunId: number,
) => number | Promise<number>;
export interface WebhookRouteOptions {
  runtimeStarter?: WebhookRuntimeStarter;
  /** Only explicit transport peers may supply forwarded client addresses. */
  trustedProxyIps?: readonly string[];
}

const MAX_BODY = 64 * 1024;
const SLUG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function fail(trigger: FlowTriggerRow, reason: string): void {
  emitAudit({
    kind: "trigger.failed",
    triggerId: trigger.id,
    flowId: trigger.flow_id,
    reason,
    source: "webhook",
  });
}

/** Bounded streaming read also covers chunked bodies without Content-Length. */
async function readBody(c: Context): Promise<string | Response> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return c.json({ code: "BODY_TOO_LARGE", error: "Maximum webhook body is 64 KiB" }, 413);
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (err) {
    logger.debug("trigger_body_invalid", { error: String(err) });
    return c.json({ code: "INVALID_BODY", error: "Invalid UTF-8 body" }, 400);
  } finally {
    reader.releaseLock();
  }
}

function clientIp(c: Context, trusted: readonly string[]): string {
  let peer = "unknown";
  try {
    peer = getConnInfo(c).remote.address ?? peer;
  } catch (err) {
    logger.debug("trigger_peer_unavailable", { error: String(err) });
  }
  peer = peer.replace(/^::ffff:/, "");
  if (!trusted.includes(peer)) return peer;
  // Walk from the trusted end; an attacker-controlled leftmost address is never authoritative.
  const chain = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  for (let i = chain.length - 1; i >= 0; i--) {
    const address = chain[i]!;
    if (!isIP(address)) return "unknown";
    if (!trusted.includes(address)) return address;
  }
  return peer;
}

function allowsIp(trigger: FlowTriggerRow, ip: string): boolean {
  if (!trigger.ip_allowlist) return true;
  try {
    const list: unknown = JSON.parse(trigger.ip_allowlist);
    return Array.isArray(list) && list.every((x) => typeof x === "string") && isIpAllowed(ip, list);
  } catch (err) {
    logger.warn("trigger_invalid_allowlist", { triggerId: trigger.id, error: String(err) });
    return false;
  }
}

async function authorize(
  c: Context,
  trigger: FlowTriggerRow,
  body: string,
  key: string | null,
): Promise<boolean> {
  const signature = c.req.header("x-clawpilot-signature") ?? "";
  let signedBody = body;
  let header = signature;
  if (trigger.webhook_signature_version === 2) {
    const timestamp = c.req.header("x-clawpilot-timestamp") ?? "";
    if (
      !/^\d{1,12}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !key ||
      !/^[\x21-\x7e]{1,128}$/.test(key) ||
      !signature.startsWith("v2=")
    )
      return false;
    signedBody = `${timestamp}.${key}.${body}`;
    header = `sha256=${signature.slice(3)}`;
  }
  try {
    const secret = await getSecretProvider().get(trigger.webhook_secret_ref!);
    return verifyHmacSignature(secret, signedBody, header);
  } catch (err) {
    logger.warn("trigger_secret_unavailable", { triggerId: trigger.id, error: String(err) });
    return false;
  }
}

async function defaultRuntimeStarter(
  instanceSlug: string,
  flowId: number,
  triggerDetail: string,
  triggerRunId: number,
): Promise<number> {
  const { callRuntimeApi } = await import("./_internal-api-client.js");
  const result = await callRuntimeApi<{ runId: number }>(
    instanceSlug,
    `/internal/flows/${flowId}/run`,
    { triggerType: "webhook", triggerDetail, triggerRunId },
    { timeoutMs: 10_000 },
  );
  return result.runId;
}

/** Check, deduplicate and reserve synchronously under SQLite's writer lock. */
function reserve(
  c: Context,
  deps: RouteDeps,
  snapshot: FlowTriggerRow,
  body: string,
  key: string | null,
  ip: string,
): number | Response {
  return deps.db
    .transaction(() => {
      const trigger = getFlowTrigger(deps.db, snapshot.id);
      if (
        !trigger ||
        trigger.enabled !== 1 ||
        trigger.webhook_revoked_at ||
        trigger.webhook_secret_ref !== snapshot.webhook_secret_ref
      ) {
        return c.json({ code: "WEBHOOK_REVOKED", error: "Webhook configuration changed" }, 403);
      }
      const flow = getFlowDefinition(deps.db, trigger.flow_id);
      if (!flow || flow.instance_slug !== trigger.instance_slug)
        return c.json({ code: "NOT_FOUND", error: "Flow not found" }, 404);
      if (!flow.enabled || trigger.webhook_slug !== snapshot.webhook_slug || !allowsIp(trigger, ip))
        return c.json(
          { code: "CONFIGURATION_CHANGED", error: "Webhook or flow configuration changed" },
          403,
        );
      const governance = canRunWorkflowUnattended(deps.db, trigger.flow_id);
      if (!governance.allowed)
        return c.json({ code: "WORKFLOW_NOT_APPROVED", error: governance.reason }, 403);
      const payloadHash = hashPayload(body);
      const prior = key
        ? findRunByIdempotencyKey(deps.db, trigger.id, key)
        : findRunByPayloadHash(deps.db, trigger.id, payloadHash);
      if (prior) {
        if (key && prior.payload_hash !== payloadHash)
          return c.json(
            { code: "IDEMPOTENCY_CONFLICT", error: "Event key already used for another payload" },
            409,
          );
        emitAudit({
          kind: "trigger.deduped",
          triggerId: trigger.id,
          method: key ? "idempotency_key" : "payload_hash",
        });
        return c.json(
          {
            deduped: true,
            runId: prior.id,
            priorRunId: prior.id,
            flowRunId: prior.flow_run_id,
            status: prior.status,
          },
          200,
        );
      }
      if (!trigger.allow_concurrent && hasActiveTriggerRun(deps.db, trigger.id)) {
        return c.json(
          { skipped: true, code: "CONCURRENT_RUN", reason: "concurrent_run_active" },
          409,
        );
      }
      return createTriggerRun(deps.db, {
        triggerId: trigger.id,
        status: "pending",
        payload: body,
        payloadHash,
        sourceIp: ip,
        ...(key ? { idempotencyKey: key } : {}),
      }).id;
    })
    .immediate();
}

/** Register the public webhook endpoint; mutations use dashboard permissions separately. */
export function registerWebhookRoutes(
  app: Hono,
  deps: RouteDeps,
  options: WebhookRouteOptions = {},
): void {
  const starter = options.runtimeStarter ?? defaultRuntimeStarter;
  const trusted =
    options.trustedProxyIps ??
    (process.env["CLAW_PILOT_TRUSTED_PROXY_IPS"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isIP(x));
  const buckets = new Map<string, number[]>();
  app.post("/webhooks/triggers/:instanceSlug/:slug", async (c) => {
    const instance = c.req.param("instanceSlug"),
      slug = c.req.param("slug");
    if (!SLUG_RE.test(instance) || !SLUG_RE.test(slug))
      return c.json({ code: "INVALID_SLUG", error: "Invalid slug" }, 400);
    const trigger = getFlowTriggerByWebhookSlug(deps.db, instance, slug);
    if (!trigger) return c.json({ code: "NOT_FOUND", error: "Webhook not found" }, 404);
    const now = Date.now(),
      bucketKey = `${instance}:${slug}`;
    if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value!);
    const times = (buckets.get(bucketKey) ?? []).filter((t) => now - t < 60_000);
    buckets.set(bucketKey, times);
    if (times.length >= 60)
      return c.json({ code: "RATE_LIMITED", error: "Too many requests" }, 429);
    times.push(now);
    if (!trigger.enabled) return c.json({ code: "DISABLED", error: "Webhook disabled" }, 503);
    if (trigger.kind !== "webhook" || !trigger.webhook_secret_ref)
      return c.json({ code: "NOT_CONFIGURED", error: "Webhook not configured" }, 503);
    const body = await readBody(c);
    if (body instanceof Response) return body;
    const key = c.req.header("idempotency-key") ?? null;
    if (key && !/^[\x21-\x7e]{1,128}$/.test(key))
      return c.json({ code: "INVALID_EVENT_KEY", error: "Invalid event key" }, 400);
    if (!(await authorize(c, trigger, body, key))) {
      fail(trigger, "invalid_signature");
      return c.json({ code: "UNAUTHORIZED", error: "Invalid or expired signature" }, 401);
    }
    const ip = clientIp(c, trusted);
    if (!allowsIp(trigger, ip)) {
      fail(trigger, "ip_not_allowed");
      return c.json({ code: "FORBIDDEN", error: "IP not allowed" }, 403);
    }
    try {
      JSON.parse(body);
    } catch (err) {
      logger.debug("trigger_json_invalid", { error: String(err) });
      return c.json({ code: "INVALID_JSON", error: "Invalid JSON" }, 400);
    }
    const runId = reserve(c, deps, trigger, body, key, ip);
    if (runId instanceof Response) return runId;
    try {
      const flowRunId = await starter(
        instance,
        trigger.flow_id,
        JSON.stringify({ triggerId: trigger.id, triggerRunId: runId }),
        runId,
      );
      // A real daemon owns running/terminal status. Test or alternate starters may only return an ID.
      updateTriggerRun(deps.db, runId, { flowRunId });
      deps.db
        .prepare(
          "UPDATE rt_flow_trigger_runs SET status = 'running' WHERE id = ? AND status = 'pending'",
        )
        .run(runId);
      touchTriggerLastFired(deps.db, trigger.id);
      emitAudit({
        kind: "trigger.fired",
        triggerId: trigger.id,
        flowId: trigger.flow_id,
        instanceSlug: instance,
        source: "webhook",
      });
      return c.json({ runId, flowRunId }, 202);
    } catch (err) {
      logger.error("trigger_webhook_start_failed", { triggerId: trigger.id, error: String(err) });
      // An ambiguous IPC error must not release a reservation whose flow may already run.
      fail(trigger, "flow_start_unconfirmed");
      return c.json(
        {
          code: "FLOW_START_UNCONFIRMED",
          error: "Flow admission could not be confirmed; inspect trigger history",
          runId,
        },
        503,
      );
    }
  });
}
