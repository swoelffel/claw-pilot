// src/runtime/engine/internal-api.ts
//
// Lightweight HTTP server for dashboard→runtime IPC.
// Uses node:http (NOT Hono) to keep the runtime dependency-free from the dashboard stack.

import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../../lib/logger.js";
import type { InstanceSlug } from "../types.js";

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
// InternalApiServer
// ---------------------------------------------------------------------------

export class InternalApiServer {
  private _server: http.Server | undefined;
  private readonly _port: number;
  private readonly _tokenBuffer: Buffer;
  private readonly _handlers: InternalApiHandlers;
  private readonly _slug: InstanceSlug;

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

  /** Start listening for HTTP requests. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        void this._handleRequest(req, res);
      });

      this._server.on("error", (err) => {
        logger.error("internal_api_listen_error", {
          event: "internal_api_listen_error",
          slug: this._slug,
          port: this._port,
          error: String(err),
        });
        reject(err);
      });

      this._server.listen(this._port, "127.0.0.1", () => {
        logger.info("internal_api_started", {
          event: "internal_api_started",
          slug: this._slug,
          port: this._port,
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
  // Request handling
  // ---------------------------------------------------------------------------

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 1. Auth check
    if (!this._authenticate(req)) {
      this._json(res, 401, { error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    // 2. Only POST allowed
    if (req.method !== "POST") {
      this._json(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    // 3. Parse body
    let body: unknown;
    try {
      body = await this._readBody(req);
    } catch (err) {
      logger.debug("internal_api_body_parse_failed", { error: String(err) });
      this._json(res, 400, { error: "Invalid JSON body", code: "INVALID_JSON" });
      return;
    }

    // 4. Route
    const url = req.url ?? "";
    try {
      if (url === "/internal/chat") {
        const result = await this._handlers.handleChat(body as ChatRequest);
        this._json(res, 200, result);
      } else if (url === "/internal/wake") {
        this._handlers.handleWake(body as WakeRequest);
        this._json(res, 200, { ok: true });
      } else if (url.startsWith("/internal/flows/") && url.endsWith("/run")) {
        // /internal/flows/:flowId/run
        const flowIdStr = url.slice("/internal/flows/".length, -"/run".length);
        const flowId = Number(flowIdStr);
        if (!Number.isFinite(flowId)) {
          this._json(res, 400, { error: "Invalid flow ID", code: "INVALID_FLOW_ID" });
          return;
        }
        const runId = this._handlers.handleFlowRun(flowId, body as FlowRunRequest);
        this._json(res, 202, { runId });
      } else if (url.startsWith("/internal/questions/") && url.endsWith("/answer")) {
        // /internal/questions/:questionId/answer
        const questionId = url.slice("/internal/questions/".length, -"/answer".length);
        const { answer } = body as { answer?: string };
        if (!answer || typeof answer !== "string") {
          this._json(res, 400, { error: "Missing answer", code: "MISSING_ANSWER" });
          return;
        }
        const resolved = this._handlers.handleQuestionAnswer(questionId, answer);
        this._json(res, 200, { ok: true, resolved });
      } else if (url.startsWith("/internal/sessions/") && url.endsWith("/abort")) {
        // /internal/sessions/:sessionId/abort
        const sessionId = url.slice("/internal/sessions/".length, -"/abort".length);
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
        url,
        error: msg,
      });
      this._json(res, 500, { error: msg, code: "INTERNAL_ERROR" });
    }
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
