// src/dashboard/server.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Registry } from "../core/registry.js";
import type { ServerConnection } from "../server/connection.js";
import type { WizardAnswers } from "../core/config-generator.js";
import { HealthChecker } from "../core/health.js";
import { Lifecycle } from "../core/lifecycle.js";
import { Destroyer } from "../core/destroyer.js";
import { Provisioner } from "../core/provisioner.js";
import { PortAllocator } from "../core/port-allocator.js";
import { PairingManager } from "../core/pairing.js";
import { AgentSync, EDITABLE_FILES } from "../core/agent-sync.js";
import { Monitor } from "./monitor.js";
import { ClawPilotError, InstanceNotFoundError } from "../lib/errors.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";
import { PROVIDER_CATALOG } from "../lib/provider-catalog.js";
import type { ProviderInfo } from "../lib/provider-catalog.js";
import { readGatewayToken } from "../lib/env-reader.js";

// Resolve dist/ui/ relative to this bundle chunk.
// When bundled: this file is at <install>/dist/server-*.mjs
// so __dirname = <install>/dist/ and UI_DIST = <install>/dist/ui/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST =
  process.env["CLAW_PILOT_UI_DIST"] ?? path.resolve(__dirname, "ui");

// Minimal MIME type map for static asset serving
const MIME: Record<string, string> = {
  ".html": "text/html; charset=UTF-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export interface DashboardOptions {
  port: number;
  token: string;
  registry: Registry;
  conn: ServerConnection;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, token, registry, conn } = options;
  const app = new Hono();

  // Resolve XDG_RUNTIME_DIR once at startup for the current user
  const xdgRuntimeDir = await resolveXdgRuntimeDir(conn);

  const health = new HealthChecker(conn, registry, xdgRuntimeDir);
  const lifecycle = new Lifecycle(conn, registry, xdgRuntimeDir);
  const monitor = new Monitor(health);

  // Auth middleware for API routes
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // --- API routes ---

  app.get("/api/instances", async (c) => {
    const statuses = await health.checkAll();
    // Enrich each status with gatewayToken (parallel reads)
    const enriched = await Promise.all(
      statuses.map(async (s) => {
        const instance = registry.getInstance(s.slug);
        const gatewayToken = instance
          ? await readGatewayToken(conn, instance.state_dir)
          : null;
        return { ...s, gatewayToken };
      }),
    );
    return c.json(enriched);
  });

  app.get("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);
    const [status, gatewayToken] = await Promise.all([
      health.check(slug),
      readGatewayToken(conn, instance.state_dir),
    ]);
    return c.json({ instance, status, gatewayToken });
  });

  app.get("/api/instances/:slug/agents", (c) => {
    const slug = c.req.param("slug");
    const agents = registry.listAgents(slug);
    return c.json(agents);
  });

  // POST /api/instances/:slug/agents/sync — trigger a full agent workspace sync
  app.post("/api/instances/:slug/agents/sync", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    try {
      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance);
      return c.json({ synced: true, ...result });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Sync failed" },
        500,
      );
    }
  });

  // GET /api/instances/:slug/agents/builder — full builder payload (agents + links + file summaries)
  app.get("/api/instances/:slug/agents/builder", (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    const agents = registry.listAgents(slug);
    const links = registry.listAgentLinks(instance.id);

    // For each agent, attach a file summary (no content — content is fetched separately)
    const agentsWithFiles = agents.map((agent) => {
      const files = registry.listAgentFiles(agent.id).map((f) => ({
        filename: f.filename,
        content_hash: f.content_hash,
        size: f.content ? f.content.length : 0,
        updated_at: f.updated_at,
      }));
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        model: agent.model,
        workspace_path: agent.workspace_path,
        is_default: agent.is_default === 1,
        role: agent.role ?? null,
        tags: agent.tags ?? null,
        notes: agent.notes ?? null,
        synced_at: agent.synced_at ?? null,
        position_x: agent.position_x ?? null,
        position_y: agent.position_y ?? null,
        files,
      };
    });

    return c.json({
      instance: {
        slug: instance.slug,
        display_name: instance.display_name,
        port: instance.port,
        state: instance.state,
        default_model: instance.default_model,
      },
      agents: agentsWithFiles,
      links: links.map((l) => ({
        source_agent_id: l.source_agent_id,
        target_agent_id: l.target_agent_id,
        link_type: l.link_type,
      })),
    });
  });

  // PATCH /api/instances/:slug/agents/:agentId/position — persist canvas position
  app.patch("/api/instances/:slug/agents/:agentId/position", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    let body: { x: number; y: number };
    try {
      body = await c.req.json() as { x: number; y: number };
      if (typeof body.x !== "number" || typeof body.y !== "number") {
        return c.json({ error: "x and y must be numbers" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    registry.updateAgentPosition(agent.id, body.x, body.y);
    return c.json({ ok: true });
  });

  // PATCH /api/instances/:slug/agents/:agentId/spawn-links — update spawn targets in openclaw.json
  app.patch("/api/instances/:slug/agents/:agentId/spawn-links", async (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    let body: { targets: string[] };
    try {
      body = await c.req.json();
      if (!Array.isArray(body.targets) || !body.targets.every((t: unknown) => typeof t === "string")) {
        return c.json({ error: "targets must be an array of strings" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      // 1. Read and parse openclaw.json
      const configRaw = await conn.readFile(instance.config_path);
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const agentsConf = config["agents"] as Record<string, unknown> | undefined;

      // 2. Update the allowAgents array for the target agent
      // For "main": prefer agents.list[id=main] if it exists, otherwise fall back to agents.defaults
      const agentsList = (agentsConf?.["list"] ?? []) as Array<Record<string, unknown>>;
      const listEntry = agentsList.find((a) => a["id"] === agentId);

      if (listEntry) {
        // Agent has an explicit entry in agents.list — update there
        let subagents = listEntry["subagents"] as Record<string, unknown> | undefined;
        if (!subagents) {
          subagents = {};
          listEntry["subagents"] = subagents;
        }
        subagents["allowAgents"] = body.targets;
      } else if (agentId === "main") {
        // main with no list entry — update agents.defaults.subagents
        const defaults = agentsConf?.["defaults"] as Record<string, unknown> | undefined;
        if (defaults) {
          let subagents = defaults["subagents"] as Record<string, unknown> | undefined;
          if (!subagents) {
            subagents = {};
            defaults["subagents"] = subagents;
          }
          subagents["allowAgents"] = body.targets;
        }
      } else {
        return c.json({ error: `Agent '${agentId}' not found in config` }, 404);
      }

      // 3. Write back openclaw.json
      await conn.writeFile(instance.config_path, JSON.stringify(config, null, 2));

      // 4. Re-sync agents to update DB + links from the new config (before restart so it always succeeds)
      const agentSync = new AgentSync(conn, registry);
      const result = await agentSync.sync(instance);

      // 5. Restart the daemon fire-and-forget (don't wait for health — instance may be unhealthy)
      conn.execFile("systemctl", ["--user", "restart", instance.systemd_unit], {
        env: { XDG_RUNTIME_DIR: xdgRuntimeDir },
      }).catch(() => { /* best-effort restart */ });

      return c.json({
        ok: true,
        links: result.links.map((l) => ({
          source_agent_id: l.source_agent_id,
          target_agent_id: l.target_agent_id,
          link_type: l.link_type,
        })),
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to update spawn links" },
        500,
      );
    }
  });

  // GET /api/instances/:slug/agents/:agentId/files/:filename — fetch a single workspace file
  app.get("/api/instances/:slug/agents/:agentId/files/:filename", (c) => {
    const slug = c.req.param("slug");
    const agentId = c.req.param("agentId");
    const filename = c.req.param("filename");

    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    const agent = registry.getAgentByAgentId(instance.id, agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const file = registry.getAgentFileContent(agent.id, filename);
    if (!file) return c.json({ error: "File not found" }, 404);

    return c.json({
      filename: file.filename,
      content: file.content ?? "",
      content_hash: file.content_hash ?? "",
      updated_at: file.updated_at ?? "",
      editable: EDITABLE_FILES.has(filename),
    });
  });

  app.get("/api/instances/:slug/conversations", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);

    const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);

    try {
      const runsPath = `${instance.state_dir}/subagents/runs.json`;
      const raw = await conn.readFile(runsPath);
      const data = JSON.parse(raw) as {
        version: number;
        runs: Record<string, {
          createdAt: number;
          requesterDisplayKey: string;
          childSessionKey: string;
          label?: string;
          task: string;
          endedAt?: number;
          outcome?: string;
        }>;
      };

      const entries = Object.values(data.runs ?? {})
        .map((run) => ({
          timestamp: run.createdAt,
          from: run.requesterDisplayKey || "unknown",
          to: run.label || run.childSessionKey || "agent",
          message: run.task || "",
          type: "agent-agent" as const,
          status: run.endedAt
            ? run.outcome === "completed" ? "done" : "failed"
            : "running",
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });

  app.get("/api/instances/:slug/health", async (c) => {
    const slug = c.req.param("slug");
    try {
      const status = await health.check(slug);
      return c.json(status);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        500,
      );
    }
  });

  app.post("/api/instances/:slug/start", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.start(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err instanceof Error ? err.message : "Start failed" }, 500);
    }
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.stop(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err instanceof Error ? err.message : "Stop failed" }, 500);
    }
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    const slug = c.req.param("slug");
    try {
      await lifecycle.restart(slug);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err instanceof Error ? err.message : "Restart failed" }, 500);
    }
  });

  app.delete("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    try {
      const destroyer = new Destroyer(conn, registry, xdgRuntimeDir);
      await destroyer.destroy(slug);
      return c.json({ ok: true, slug });
    } catch (err) {
      if (err instanceof InstanceNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json(
        { error: err instanceof Error ? err.message : "Destroy failed" },
        500,
      );
    }
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, instances: registry.listInstances().length });
  });

  // GET /api/next-port — suggest next free port in the configured range
  app.get("/api/next-port", async (c) => {
    const server = registry.getLocalServer();
    if (!server) return c.json({ error: "Server not initialized. Run claw-pilot init first." }, 500);
    try {
      const portAllocator = new PortAllocator(registry, conn);
      const nextPort = await portAllocator.findFreePort(server.id);
      return c.json({ port: nextPort });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "No free port available" }, 500);
    }
  });

  // GET /api/providers — list available providers with their model catalogs
  app.get("/api/providers", async (c) => {
    const existing = registry.listInstances();
    let canReuseCredentials = false;
    let sourceInstance: string | null = null;

    // Start from the full catalog (deep copy to allow per-request mutation)
    const providers: ProviderInfo[] = PROVIDER_CATALOG.map((p) => ({ ...p, models: [...p.models] }));

    // Detect reuse capability from existing instance config
    if (existing.length > 0) {
      const source = existing[0]!;
      sourceInstance = source.slug;

      try {
        const raw = await conn.readFile(source.config_path);
        const cfg = JSON.parse(raw) as {
          models?: { providers?: Record<string, unknown> };
          auth?: { profiles?: Record<string, { provider?: string }> };
        };

        // Detect providers from models.providers block
        const cfgProviderIds = new Set(Object.keys(cfg.models?.providers ?? {}));

        // Also detect opencode from auth.profiles
        const profiles = cfg.auth?.profiles ?? {};
        for (const profile of Object.values(profiles)) {
          if (profile.provider === "opencode") cfgProviderIds.add("opencode");
        }

        if (cfgProviderIds.size > 0) {
          canReuseCredentials = true;
          // Mark matching providers as reusable (no key required)
          for (const p of providers) {
            if (cfgProviderIds.has(p.id)) {
              p.requiresKey = false;
              p.label = p.id === "opencode"
                ? `${p.label} (via ${source.slug})`
                : `${p.label} (reuse from ${source.slug})`;
              p.isDefault = true;
            }
          }
        }
      } catch {
        // Non-fatal: source config unreadable → fall through to defaults
      }
    }

    // Mark first provider as default if none marked yet
    if (!providers.some((p) => p.isDefault)) {
      providers[0]!.isDefault = true;
    }

    return c.json({ canReuseCredentials, sourceInstance, providers });
  });

  // POST /api/instances — provision a new instance
  app.post("/api/instances", async (c) => {
    const server = registry.getLocalServer();
    if (!server) return c.json({ error: "Server not initialized. Run claw-pilot init first." }, 500);

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Basic validation
    const slug = body["slug"];
    const port = body["port"];
    const defaultModel = body["defaultModel"];
    const provider = body["provider"];
    const apiKey   = body["apiKey"];

    if (typeof slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 2 || slug.length > 30) {
      return c.json({ error: "Invalid slug: must be 2-30 lowercase alphanumeric chars with hyphens" }, 400);
    }
    if (typeof port !== "number" || port < 1024 || port > 65535) {
      return c.json({ error: "Invalid port: must be 1024-65535" }, 400);
    }
    if (typeof defaultModel !== "string" || !defaultModel) {
      return c.json({ error: "defaultModel is required" }, 400);
    }
    if (typeof provider !== "string" || !provider) {
      return c.json({ error: "provider is required" }, 400);
    }
    if (typeof apiKey !== "string") {
      return c.json({ error: "apiKey must be a string (use '' for providers that need no key)" }, 400);
    }

    // Build WizardAnswers from simplified web form
    const rawAgents = Array.isArray(body["agents"]) ? body["agents"] : [];
    const agents: WizardAnswers["agents"] = rawAgents.length > 0
      ? (rawAgents as Array<{ id: string; name: string; model?: string; isDefault?: boolean }>)
      : [{ id: "main", name: "Main", isDefault: true }];

    // Ensure main agent is always present
    if (!agents.some((a) => a.id === "main" || a.isDefault)) {
      agents.unshift({ id: "main", name: "Main", isDefault: true });
    }

    const answers: WizardAnswers = {
      slug,
      displayName: typeof body["displayName"] === "string" && body["displayName"]
        ? body["displayName"]
        : slug.charAt(0).toUpperCase() + slug.slice(1),
      port,
      agents,
      defaultModel,
      provider,
      apiKey,
      telegram: { enabled: false },
      nginx:    { enabled: false },
      mem0:     { enabled: false },
    };

    try {
      const portAllocator = new PortAllocator(registry, conn);
      const provisioner = new Provisioner(conn, registry, portAllocator);
      const result = await provisioner.provision(answers, server.id);

      // Attempt device pairing bootstrap (non-fatal)
      try {
        const pairing = new PairingManager(conn, registry);
        await pairing.bootstrapDevicePairing(slug);
      } catch {
        // Pairing is best-effort — don't fail the whole request
      }

      return c.json(result, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Provisioning failed";
      if (err instanceof ClawPilotError && (
        err.code === "NO_EXISTING_INSTANCE" ||
        err.code === "ENV_READ_FAILED" ||
        err.code === "API_KEY_READ_FAILED"
      )) {
        return c.json({ error: msg }, 400);
      }
      return c.json({ error: msg }, 500);
    }
  });

  // --- Static file serving ---
  // Serve index.html with injected token (all non-asset routes → SPA)
  const serveIndex = async () => {
    const indexPath = path.join(UI_DIST, "index.html");
    let html = await fs.readFile(indexPath, "utf-8");
    const injection = `<script>window.__CP_TOKEN__=${JSON.stringify(token)};</script>`;
    html = html.replace("</head>", `${injection}\n</head>`);
    return html;
  };

  // SPA root
  app.get("/", async (c) => {
    try {
      return c.html(await serveIndex());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(`<!DOCTYPE html><html><head><title>Claw Pilot</title></head>
<body><h1>Claw Pilot Dashboard</h1>
<p>UI not built. Run <code>pnpm build:ui</code> in <code>${path.resolve(UI_DIST, "..")}</code></p>
<p><small>${msg}</small></p>
<p><a href="/api/instances">API: /api/instances</a></p></body></html>`);
    }
  });

  // Static assets — served by reading from absolute UI_DIST path
  app.get("/assets/*", async (c) => {
    const url = new URL(c.req.url, "http://localhost");
    const filePath = path.join(UI_DIST, url.pathname);
    // Prevent path traversal
    if (!filePath.startsWith(UI_DIST)) {
      return c.text("Forbidden", 403);
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = MIME[ext] ?? "application/octet-stream";
      return new Response(data, {
        headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
      });
    } catch {
      return c.text("Not found", 404);
    }
  });

  // SPA fallback for all other routes
  app.get("*", async (c) => {
    try {
      return c.html(await serveIndex());
    } catch {
      return c.redirect("/");
    }
  });

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port });

  // WebSocket server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wss = new WebSocketServer({ server: server as any });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const wsToken = url.searchParams.get("token");
    if (wsToken !== token) {
      ws.close(1008, "Unauthorized");
      return;
    }
    monitor.addClient(ws);
  });

  monitor.start();
}
