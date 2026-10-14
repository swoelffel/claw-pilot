import type * as http from "node:http";
import { setImmediate as yieldToIO } from "node:timers/promises";
import type Database from "better-sqlite3";
import {
  latestExecutionEventId,
  listExecutionEventsAfter,
} from "../../core/repositories/execution-event-repository.js";
import { logger } from "../../lib/logger.js";
import { getBus } from "../bus/index.js";
import type { AnyEvent } from "../bus/index.js";
import type { InstanceSlug } from "../types.js";

const REPLAY_PAGE_SIZE = 1000;
const MAX_TRANSIENT_QUEUE_BYTES = 1024 * 1024;
const SSE_PING_INTERVAL_MS = 15_000;

interface EventStreamOptions {
  db: Database.Database;
  slug: InstanceSlug;
  cursor: number;
  sessionId?: string;
  types?: Set<string>;
}

interface TransientFrame {
  line: string;
  afterId: number;
  bytes: number;
}

/** Stream durable events in database order and retain bounded transient traffic. */
export function streamRuntimeEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: EventStreamOptions,
): void {
  new RuntimeEventStream(req, res, options).start();
}

class RuntimeEventStream {
  private _cursor = 0;
  private _replayThrough = 0;
  private _closed = false;
  private _running = false;
  private _sendRetry = true;
  private _dirty = true;
  private _queue: TransientFrame[] = [];
  private _queuedBytes = 0;
  private _unsubscribe: (() => void) | undefined;
  private _ping: ReturnType<typeof setInterval> | undefined;
  private _resume: (() => void) | undefined;

  constructor(
    private readonly _req: http.IncomingMessage,
    private readonly _res: http.ServerResponse,
    private readonly _options: EventStreamOptions,
  ) {}

  start(): void {
    this._req.on("close", this._cleanup);
    this._req.on("aborted", this._cleanup);
    this._res.on("close", this._cleanup);
    this._res.on("error", this._fail);

    // Persistence subscribes before the API starts. Subscribe before the snapshot
    // and first read: live durable notifications only wake the database reader,
    // so overlap with replay cannot reorder or duplicate SSE IDs.
    this._unsubscribe = getBus(this._options.slug).subscribeAll(this._onEvent);
    try {
      this._replayThrough = latestExecutionEventId(this._options.db, this._options.slug);
      // A cursor ahead of this log has no backlog, but must still accept live
      // events (for example after reconnecting to a freshly restored registry).
      this._cursor =
        Number.isSafeInteger(this._options.cursor) && this._options.cursor >= 0
          ? Math.min(this._options.cursor, this._replayThrough)
          : this._replayThrough;
      this._res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
    } catch (err) {
      this._fail(err);
      return;
    }
    this._ping = setInterval(() => {
      // A blocked or replaying stream already has data in flight. Do not queue
      // pings behind it or bypass the writer's backpressure.
      if (!this._running) this._enqueue(":ping\n\n");
    }, SSE_PING_INTERVAL_MS);
    void this._pump();
  }

  private _onEvent = (event: AnyEvent): void => {
    if (this._closed) return;
    const { sessionId, types } = this._options;
    if (types && !types.has(event.type)) return;
    const payload = event.payload as Record<string, unknown>;
    if (sessionId && payload.sessionId && payload.sessionId !== sessionId) return;

    const eventId = (event as typeof event & { eventId?: number }).eventId;
    if (eventId !== undefined) {
      if (eventId <= this._cursor) return;
      this._dirty = true;
      if (!this._running) void this._pump();
    } else {
      this._enqueue(
        `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`,
      );
    }
  };

  private _enqueue(line: string): void {
    if (this._closed) return;
    const bytes = Buffer.byteLength(line);
    if (this._queuedBytes + bytes > MAX_TRANSIENT_QUEUE_BYTES) {
      // Transient events cannot be fetched from the durable log. Disconnect a
      // slow consumer rather than retaining an unbounded in-memory live queue.
      this._fail(new Error("SSE transient queue overflow"));
      return;
    }
    try {
      // A text delta must precede later durable completion events, even when
      // replay or backpressure delays its write. Only transient payloads need
      // buffering; the durable boundary orders them against database pages.
      this._queue.push({
        line,
        afterId: latestExecutionEventId(this._options.db, this._options.slug),
        bytes,
      });
    } catch (err) {
      this._fail(err);
      return;
    }
    this._queuedBytes += bytes;
    this._dirty = true;
    if (!this._running) void this._pump();
  }

  private async _pump(): Promise<void> {
    this._running = true;
    try {
      if (this._sendRetry) {
        this._sendRetry = false;
        await this._write("retry: 3000\n\n");
      }
      while (!this._closed) {
        this._dirty = false;
        const throughId =
          this._queue[0]?.afterId ?? latestExecutionEventId(this._options.db, this._options.slug);
        if (this._cursor < throughId && (await this._replayPage(throughId))) continue;
        const transient = this._queue[0];
        if (transient && transient.afterId <= this._cursor && !this._closed) {
          this._queue.shift();
          this._queuedBytes -= transient.bytes;
          await this._write(transient.line);
          continue;
        }
        // An arrival during any await sets dirty; an arrival after becoming
        // idle restarts the reader. Both paths resume from the emitted cursor.
        if (!this._dirty) break;
      }
    } catch (err) {
      this._fail(err);
    } finally {
      this._running = false;
    }
  }

  private async _replayPage(throughId: number): Promise<boolean> {
    const { db, slug, sessionId, types } = this._options;
    const page =
      types?.size === 0
        ? []
        : listExecutionEventsAfter(db, slug, this._cursor, {
            ...(sessionId ? { sessionId } : {}),
            ...(types ? { types } : {}),
            limit: REPLAY_PAGE_SIZE,
            throughId,
          });
    for (const event of page) {
      if (this._closed) return false;
      await this._write(
        `id: ${event.id}\ndata: ${JSON.stringify({
          type: event.event_type,
          payload: JSON.parse(event.payload_json) as unknown,
          timestamp: event.created_at,
          eventId: event.id,
          ...(event.id <= this._replayThrough ? { replayed: true } : {}),
        })}\n\n`,
      );
      this._cursor = event.id;
    }
    if (page.length === 0) {
      // Matching filters can skip every row up to the captured boundary. Advance
      // internally so a transient frame at that boundary is not stuck forever.
      this._cursor = Math.max(this._cursor, throughId);
      return false;
    }
    // Yield between bounded pages so other requests and bus publishers can run
    // even when the socket accepts the entire page immediately.
    await yieldToIO();
    return true;
  }

  private async _write(line: string): Promise<void> {
    if (this._closed || this._res.destroyed) return;
    if (this._res.write(line) || this._closed) return;
    await new Promise<void>((resolve) => {
      const resume = (): void => {
        this._res.off("drain", resume);
        this._resume = undefined;
        resolve();
      };
      this._resume = resume;
      this._res.once("drain", resume);
    });
  }

  private _fail = (error: unknown): void => {
    logger.warn("internal_api_event_stream_failed", {
      slug: this._options.slug,
      error: String(error),
    });
    this._cleanup();
    this._res.destroy();
  };

  private _cleanup = (): void => {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._ping);
    this._unsubscribe?.();
    this._resume?.();
    this._queue = [];
    this._queuedBytes = 0;
  };
}
