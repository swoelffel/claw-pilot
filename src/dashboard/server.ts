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
import { Monitor } from "./monitor.js";
import { ClawPilotError, InstanceNotFoundError } from "../lib/errors.js";
import { resolveXdgRuntimeDir } from "../lib/xdg.js";

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

interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  isDefault?: boolean;
  defaultModel: string;
  models: string[];
}

/**
 * Provider catalog — kept in sync with OpenClaw model registry.
 * Source: src/openclaw/node_modules/@mariozechner/pi-ai/dist/models.generated.js
 * OpenClaw version reference: 2026.2.14
 * Update this catalog on each OpenClaw release (see docs/OPENCLAW-COMPAT.md).
 */
const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    requiresKey: true,
    defaultModel: "anthropic/claude-sonnet-4-6",
    models: [
      "anthropic/claude-opus-4-6",
      "anthropic/claude-opus-4-5",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-haiku-4-5",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    requiresKey: true,
    defaultModel: "openai/gpt-5.1-codex",
    models: [
      "openai/gpt-5.2",
      "openai/gpt-5.1-codex",
      "openai/gpt-5.1",
      "openai/gpt-5",
      "openai/gpt-4.1",
      "openai/o3",
      "openai/o4-mini",
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    requiresKey: true,
    defaultModel: "google/gemini-3-pro-preview",
    models: [
      "google/gemini-3-pro-preview",
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    requiresKey: true,
    defaultModel: "mistral/mistral-large-latest",
    models: [
      "mistral/mistral-large-latest",
    ],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    requiresKey: true,
    defaultModel: "xai/grok-4",
    models: [
      "xai/grok-4",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    requiresKey: true,
    defaultModel: "openrouter/auto",
    models: [
      "openrouter/auto",
    ],
  },
  {
    id: "opencode",
    label: "OpenCode Zen (no key)",
    requiresKey: false,
    defaultModel: "opencode/claude-opus-4-6",
    models: [
      "opencode/gpt-5.1-codex",
      "opencode/claude-opus-4-6",
      "opencode/claude-opus-4-5",
      "opencode/gemini-3-pro",
      "opencode/gpt-5.1-codex-mini",
      "opencode/gpt-5.1",
      "opencode/glm-4.7",
      "opencode/gemini-3-flash",
      "opencode/gpt-5.2",
    ],
  },
];

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
    return c.json(statuses);
  });

  app.get("/api/instances/:slug", async (c) => {
    const slug = c.req.param("slug");
    const instance = registry.getInstance(slug);
    if (!instance) return c.json({ error: "Not found" }, 404);
    const status = await health.check(slug);
    return c.json({ instance, status });
  });

  app.get("/api/instances/:slug/agents", (c) => {
    const slug = c.req.param("slug");
    const agents = registry.listAgents(slug);
    return c.json(agents);
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
    await lifecycle.start(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/stop", async (c) => {
    await lifecycle.stop(c.req.param("slug"));
    return c.json({ ok: true });
  });

  app.post("/api/instances/:slug/restart", async (c) => {
    await lifecycle.restart(c.req.param("slug"));
    return c.json({ ok: true });
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
