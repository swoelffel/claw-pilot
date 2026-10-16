/** Real HTTP admission → separate daemon process → first step briefing and completion. */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "tsdown";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initDatabase } from "../db/schema.js";
import { Registry } from "../core/registry.js";
import { createFlowDefinition, getFlowRun } from "../core/repositories/flow-repository.js";
import { createFlowTrigger, getTriggerRun } from "../core/repositories/flow-trigger-repository.js";
import {
  ENV_PROVIDER_BRAND,
  registerSecretProvider,
  resetSecretProvider,
  type SecretProvider,
} from "../core/secrets/index.js";
import { registerWebhookRoutes } from "../dashboard/routes/webhooks.js";
import type { RouteDeps } from "../dashboard/route-deps.js";

const secret = "fixture-shared-webhook-secret";
let db: ReturnType<typeof initDatabase>, daemon: ChildProcess, server: ReturnType<typeof serve>;
let dataDir: string, buildDir: string, baseUrl: string, flowId: number, triggerId: number;
let briefing = "";
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "webhook-ipc-"));
  buildDir = mkdtempSync(join(process.cwd(), "node_modules/.webhook-daemon-"));
  const dbPath = join(dataDir, "registry.db");
  db = initDatabase(dbPath);
  const registry = new Registry(db),
    host = registry.upsertLocalServer("fixture", dataDir);
  registry.createInstance({
    serverId: host.id,
    slug: "webhook-ipc",
    port: 18789,
    configPath: dataDir,
    stateDir: dataDir,
    systemdUnit: "fixture",
  });
  flowId = createFlowDefinition(db, {
    instanceSlug: "webhook-ipc",
    name: "webhook-flow",
    stepsJson: JSON.stringify([
      {
        id: "first",
        agentId: "pilot",
        prompt: "External value {{trigger.payload.value}} mapped {{trigger.mapped.answer}}",
      },
    ]),
  }).id;
  db.prepare(
    "UPDATE rt_flow_definitions SET lifecycle = 'ACTIVE', validation_status = 'VALID' WHERE id = ?",
  ).run(flowId);
  triggerId = createFlowTrigger(db, {
    instanceSlug: "webhook-ipc",
    flowId,
    kind: "webhook",
    name: "incoming",
    webhookSlug: "incoming",
    webhookSecretRef: "fixture",
    signatureVersion: 2,
    inputMapping: '[{"from":"$.value","to":"answer"}]',
  }).id;
  await build({
    entry: ["src/e2e/helpers/webhook-daemon.ts"],
    outDir: buildDir,
    config: false,
    format: "esm",
    dts: false,
    target: "node22",
    outExtensions: () => ({ js: ".mjs" }),
  });
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      if (!address || typeof address === "string") throw new Error("Missing port");
      s.close(() => resolve(address.port));
    });
  });
  daemon = fork(join(buildDir, "webhook-daemon.mjs"), [dbPath, String(port)], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const messages: unknown[] = [];
  daemon.on("message", (message) => {
    messages.push(message);
    const m = message as { type: string; text?: string };
    if (m.type === "briefing") briefing = m.text ?? "";
  });
  let daemonError = "";
  daemon.stderr?.on("data", (data) => {
    daemonError += String(data);
  });
  await vi.waitFor(
    () => {
      if (daemon.exitCode !== null) throw new Error(daemonError);
      expect(messages.some((m) => (m as { type: string }).type === "ready")).toBe(true);
    },
    { timeout: 10_000 },
  );
  resetSecretProvider();
  const provider: SecretProvider = {
    kind: "fixture",
    get: async () => secret,
    has: async () => true,
  };
  (provider as unknown as Record<symbol, unknown>)[ENV_PROVIDER_BRAND] = true;
  registerSecretProvider(provider);
  const app = new Hono();
  registerWebhookRoutes(app, { db, registry } as unknown as RouteDeps, {
    runtimeStarter: async (instanceSlug, id, triggerDetail, triggerRunId) => {
      expect(instanceSlug).toBe("webhook-ipc");
      const response = await fetch(`http://127.0.0.1:${port}/internal/flows/${id}/run`, {
        method: "POST",
        headers: { authorization: "Bearer webhook-test-ipc", "content-type": "application/json" },
        body: JSON.stringify({ triggerType: "webhook", triggerDetail, triggerRunId }),
      });
      if (!response.ok) throw new Error(await response.text());
      return ((await response.json()) as { runId: number }).runId;
    },
  });
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await vi.waitFor(() => expect(server.address()).toBeTruthy());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 20_000);
afterAll(async () => {
  daemon?.disconnect();
  if (daemon) await vi.waitFor(() => expect(daemon.exitCode).toBe(0), { timeout: 5000 });
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  db?.close();
  resetSecretProvider();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});
it("delivers first-step payload across IPC and holds concurrency until daemon completion", async () => {
  const body = '{"value":42}',
    timestamp = String(Math.floor(Date.now() / 1000));
  async function send(key: string) {
    return fetch(`${baseUrl}/webhooks/triggers/webhook-ipc/incoming`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clawpilot-timestamp": timestamp,
        "idempotency-key": key,
        "x-clawpilot-signature": `v2=${createHmac("sha256", secret).update(`${timestamp}.${key}.${body}`).digest("hex")}`,
      },
      body,
    });
  }
  const first = await send("first");
  expect(first.status).toBe(202);
  const admitted = (await first.json()) as { runId: number; flowRunId: number };
  await expect.poll(() => briefing).toContain("External value 42 mapped 42");
  expect(getTriggerRun(db, admitted.runId)).toMatchObject({
    trigger_id: triggerId,
    status: "running",
  });
  expect((await send("second")).status).toBe(409);
  daemon.send({ type: "complete" });
  await expect.poll(() => getFlowRun(db, admitted.flowRunId)?.status).toBe("completed");
  expect(getTriggerRun(db, admitted.runId)?.status).toBe("succeeded");
  const duplicate = await send("first");
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toMatchObject({ priorRunId: admitted.runId });
});
