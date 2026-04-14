// src/runtime/engine/internal-api.ts
//
// Lightweight HTTP server for dashboard→runtime IPC.
// Uses node:http (NOT Hono) to keep the runtime dependency-free from the dashboard stack.

import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { MAX_PORT_RETRIES } from "../../lib/platform.js";
import type { InstanceSlug } from "../types.js";
import {
  getBus,
  PermissionReplied,
  SystemStateChanged,
  WorkspaceFileChanged,
} from "../bus/index.js";
import type { EventDef } from "../bus/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Handler called by the internal API for each supported endpoint. */
export interface InternalApiHandlers {
  /** Synchronous chat — returns full response. */
  handleChat(body: ChatRequest): Promise<ChatResponse>;
  /** Fire-and-forget agent wake. */
  handleWake(body: WakeRequest): void;
  /** Start a flow run — returns run ID. */
  handleFlowRun(flowId: number, body: FlowRunRequest): number;
  /** Abort an active session. */
  handleAbort(sessionId: string): boolean;
  /** Resolve a pending question from the question tool. */
  handleQuestionAnswer(questionId: string, answer: string): boolean;
}

export interface ChatRequest {
  message: string;
  agentId?: string;
  sessionId?: string;
  model?: string;
  files?: Array<{ name: string; mimeType: string; data: string }>;
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  text: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  steps: number;
  /**
   * True when the prompt loop is suspended on a pending `question` tool call.
   * The UI should not clear its "busy" status on this response — the loop
   * is still running in the background and will complete once the user
   * answers the question. SSE events deliver live updates meanwhile.
   */
  pendingQuestion?: boolean;
}

export interface WakeRequest {
  agentId: string;
  messageText: string;
}

export interface FlowRunRequest {
  triggerType?: string;
  triggerDetail?: string;
}

// ---------------------------------------------------------------------------
// Publishable event whitelist (dashboard → runtime via HTTP)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PUBLISHABLE_EVENTS: Record<string, EventDef<string, any>> = {
  "permission.replied": PermissionReplied,
  "system.state.changed": SystemStateChanged,
  "workspace.file.changed": WorkspaceFileChanged,
};

// ---------------------------------------------------------------------------
// SSE constants
// ---------------------------------------------------------------------------

const SSE_PING_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// InternalApiServer
// ---------------------------------------------------------------------------

export class InternalApiServer {
  private _server: http.Server | undefined;
  private readonly _port: number;
  private readonly _tokenBuffer: Buffer;
  private readonly _handlers: InternalApiHandlers;
  private readonly _slug: InstanceSlug;
  private _boundPort: number | undefined;

  constructor(options: {
    port: number;
    token: string;
    slug: InstanceSlug;
    handlers: InternalApiHandlers;
  }) {
    this._port = options.port;
    this._tokenBuffer = Buffer.from(options.token, "utf8");
    this._handlers = options.handlers;
    this._slug = options.slug;
  }

  /** Actual port after start(). May differ from constructor port if a retry was needed. */
  get boundPort(): number {
    return this._boundPort ?? this._port;
  }

  /** Start listening for HTTP requests, retrying on EADDRINUSE. */
  async start(): Promise<void> {
    for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
      const candidatePort = this._port + attempt;
      try {
        await this._tryBind(candidatePort);
        this._boundPort = candidatePort;
        if (attempt > 0) {
          logger.warn("internal_api_port_retry", {
            event: "internal_api_port_retry",
            slug: this._slug,
            requestedPort: this._port,
            boundPort: candidatePort,
            attempts: attempt + 1,
          });
        }
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
          continue;
        }
        throw err;
      }
    }
  }

  /** Attempt to bind the HTTP server on the given port. */
  private _tryBind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        void this._handleRequest(req, res);
      });

      this._server.on("error", (err) => {
        logger.error("internal_api_listen_error", {
          event: "internal_api_listen_error",
          slug: this._slug,
          port,
          error: String(err),
        });
        reject(err);
      });

      this._server.listen(port, "127.0.0.1", () => {
        logger.info("internal_api_started", {
          event: "internal_api_started",
          slug: this._slug,
          port,
        });
        resolve();
      });
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._server) {
        resolve();
        return;
      }
      this._server.close(() => {
        logger.info("internal_api_stopped", {
          event: "internal_api_stopped",
          slug: this._slug,
        });
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Request handling — method-aware routing
  // ---------------------------------------------------------------------------

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 1. Auth check
    if (!this._authenticate(req)) {
      this._json(res, 401, { error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const url = req.url ?? "";
    const pathname = url.split("?")[0]!;

    // 2. GET routes (no body parsing)
    if (req.method === "GET") {
      if (pathname === "/internal/events/stream") {
        this._handleEventStream(req, res);
        return;
      }
      this._json(res, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }

    // 3. POST routes
    if (req.method !== "POST") {
      this._json(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    // 4. Parse body
    let body: unknown;
    try {
      body = await this._readBody(req);
    } catch (err) {
      logger.debug("internal_api_body_parse_failed", { error: String(err) });
      this._json(res, 400, { error: "Invalid JSON body", code: "INVALID_JSON" });
      return;
    }

    // 5. Route POST endpoints
    await this._routePost(pathname, body, res);
  }

  // ---------------------------------------------------------------------------
  // POST route dispatch
  // ---------------------------------------------------------------------------

  private async _routePost(
    pathname: string,
    body: unknown,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      if (pathname === "/internal/chat") {
        const result = await this._handlers.handleChat(body as ChatRequest);
        this._json(res, 200, result);
      } else if (pathname === "/internal/wake") {
        this._handlers.handleWake(body as WakeRequest);
        this._json(res, 200, { ok: true });
      } else if (pathname === "/internal/events/publish") {
        this._handleEventPublish(body, res);
      } else if (pathname.startsWith("/internal/flows/") && pathname.endsWith("/run")) {
        const flowIdStr = pathname.slice("/internal/flows/".length, -"/run".length);
        const flowId = Number(flowIdStr);
        if (!Number.isFinite(flowId)) {
          this._json(res, 400, { error: "Invalid flow ID", code: "INVALID_FLOW_ID" });
          return;
        }
        const runId = this._handlers.handleFlowRun(flowId, body as FlowRunRequest);
        this._json(res, 202, { runId });
      } else if (pathname.startsWith("/internal/questions/") && pathname.endsWith("/answer")) {
        const questionId = pathname.slice("/internal/questions/".length, -"/answer".length);
        const { answer } = body as { answer?: string };
        if (!answer || typeof answer !== "string") {
          this._json(res, 400, { error: "Missing answer", code: "MISSING_ANSWER" });
          return;
        }
        const resolved = this._handlers.handleQuestionAnswer(questionId, answer);
        this._json(res, 200, { ok: true, resolved });
      } else if (pathname.startsWith("/internal/sessions/") && pathname.endsWith("/abort")) {
        const sessionId = pathname.slice("/internal/sessions/".length, -"/abort".length);
        const aborted = this._handlers.handleAbort(sessionId);
        this._json(res, 200, { ok: true, aborted });
      } else {
        this._json(res, 404, { error: "Not found", code: "NOT_FOUND" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("internal_api_handler_error", {
        event: "internal_api_handler_error",
        slug: this._slug,
        url: pathname,
        error: msg,
      });
      this._json(res, 500, { error: msg, code: "INTERNAL_ERROR" });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /internal/events/stream — SSE stream from daemon bus
  // ---------------------------------------------------------------------------

  private _handleEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    const sessionId = parsedUrl.searchParams.get("sessionId") ?? undefined;
    const typesRaw = parsedUrl.searchParams.get("types") ?? undefined;
    const typesFilter = typesRaw
      ? new Set(
          typesRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        )
      : null;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Hint browser reconnect delay
    res.write("retry: 3000\n\n");

    const bus = getBus(this._slug);
    let cleaned = false;

    const unsub = bus.subscribeAll((event) => {
      if (cleaned) return;

      // Optional type filter
      if (typesFilter && !typesFilter.has(event.type)) return;

      // Optional sessionId filter (skip for instance-scoped events without sessionId)
      if (sessionId) {
        const payload = event.payload as Record<string, unknown>;
        if (payload.sessionId && payload.sessionId !== sessionId) return;
      }

      const line = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
      res.write(line);
    });

    const pingInterval = setInterval(() => {
      if (!cleaned) res.write(":ping\n\n");
    }, SSE_PING_INTERVAL_MS);

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(pingInterval);
      unsub();
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  // ---------------------------------------------------------------------------
  // POST /internal/events/publish — dashboard→runtime event relay
  // ---------------------------------------------------------------------------

  private _handleEventPublish(body: unknown, res: http.ServerResponse): void {
    const { type, payload } = body as { type?: string; payload?: Record<string, unknown> };
    if (!type || typeof type !== "string") {
      this._json(res, 400, { error: "Missing event type", code: "MISSING_EVENT_TYPE" });
      return;
    }

    const eventDef = PUBLISHABLE_EVENTS[type];
    if (!eventDef) {
      this._json(res, 400, {
        error: `Event type "${type}" is not publishable`,
        code: "UNKNOWN_EVENT_TYPE",
      });
      return;
    }

    const bus = getBus(this._slug);
    bus.publish(eventDef, payload ?? {});
    this._json(res, 200, { ok: true });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _authenticate(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) return false;
    const tokenBuf = Buffer.from(auth.slice(7), "utf8");
    if (tokenBuf.length !== this._tokenBuffer.length) return false;
    return timingSafeEqual(tokenBuf, this._tokenBuffer);
  }

  private _readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw || raw.trim() === "") {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw) as unknown);
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  private _json(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}
