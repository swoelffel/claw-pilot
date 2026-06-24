// ui/src/services/session-activity-store.ts
//
// Per-instance, ref-counted store for live "agent is working" indicators.
//
// Subscribes to the runtime's bus via the existing SSE endpoint
// (/api/instances/:slug/events/stream) with a type filter, and projects the
// filtered event stream into a Map<sessionId, SessionActivityState>.
//
// Any UI component that knows a task's `sessionId` can observe whether an
// agent is actively running against that session and, if so, whether it is
// currently executing a specific tool.
//
// Design notes:
// - ONE EventSource per instance slug, shared by all subscribers (ref-counted).
// - Exponential backoff reconnect (mirrors live-stream-widget pattern).
// - A client-side stale sweep purges stuck entries after STALE_MS if the
//   terminal event was somehow missed over the wire — the UI never gets
//   wedged on a phantom "thinking" state.

import { getToken } from "./auth-state.js";
import { getEventsStreamUrl } from "../api.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SessionActivityState =
  | { kind: "thinking"; since: number; lastActivityAt: number }
  | { kind: "tool"; toolName: string; since: number; lastActivityAt: number };

export type SessionActivityListener = (state: SessionActivityState | undefined) => void;

export interface SessionActivityStore {
  /** Current state for a session, or undefined if the session is not active. */
  get(sessionId: string): SessionActivityState | undefined;
  /**
   * Subscribe to state changes for a specific session id. The listener is
   * invoked on every change (including transitions to/from undefined).
   * Returns an unsubscribe function.
   */
  subscribe(sessionId: string, listener: SessionActivityListener): () => void;
}

// ---------------------------------------------------------------------------
// Internal: per-slug store implementation
// ---------------------------------------------------------------------------

/** Bus event types we care about — keep in sync with src/runtime/bus/events.ts. */
const EVENT_TYPES = ["session.status", "tool.call.started", "tool.call.ended"] as const;

/** Purge entries idle for longer than this. Safety net for missed terminal events. */
const STALE_MS = 30_000;

/** Frequency of the stale sweep. */
const SWEEP_INTERVAL_MS = 5_000;

/** Reconnect backoff bounds. */
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

interface RawEvent {
  type: string;
  payload?: {
    sessionId?: string;
    status?: "idle" | "busy" | "retry";
    toolName?: string;
  };
}

class SessionActivityStoreImpl implements SessionActivityStore {
  private readonly _states = new Map<string, SessionActivityState>();
  private readonly _listeners = new Map<string, Set<SessionActivityListener>>();

  private _es: EventSource | null = null;
  private _reconnectDelay = RECONNECT_INITIAL_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _sweepTimer: ReturnType<typeof setInterval> | null = null;
  private _closed = false;

  constructor(private readonly _slug: string) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get(sessionId: string): SessionActivityState | undefined {
    return this._states.get(sessionId);
  }

  subscribe(sessionId: string, listener: SessionActivityListener): () => void {
    let set = this._listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this._listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      const s = this._listeners.get(sessionId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this._listeners.delete(sessionId);
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle (called by acquire/release)
  // -------------------------------------------------------------------------

  open(): void {
    if (this._closed) return;
    this._openStream();
    this._sweepTimer = setInterval(() => this._sweepStale(), SWEEP_INTERVAL_MS);
  }

  close(): void {
    this._closed = true;
    this._closeStream();
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
    // Notify any lingering listeners that their sessions are no longer tracked.
    for (const [sessionId, listeners] of this._listeners) {
      this._states.delete(sessionId);
      for (const l of listeners) l(undefined);
    }
    this._listeners.clear();
    this._states.clear();
  }

  // -------------------------------------------------------------------------
  // SSE plumbing
  // -------------------------------------------------------------------------

  private _openStream(): void {
    this._closeStream();
    if (this._closed) return;

    const base = getEventsStreamUrl(this._slug, { type: [...EVENT_TYPES] });
    // EventSource cannot set Authorization headers — the dashboard accepts
    // ?token=<bearer> as a timing-safe fallback (see registerAuthMiddleware).
    const token = getToken();
    const url = token
      ? `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : base;

    const es = new EventSource(url);
    this._es = es;

    es.onopen = () => {
      this._reconnectDelay = RECONNECT_INITIAL_MS;
    };

    es.onmessage = (ev: MessageEvent) => {
      let raw: RawEvent;
      try {
        raw = JSON.parse(ev.data as string) as RawEvent;
      } catch {
        return;
      }
      this._ingest(raw);
    };

    es.onerror = () => {
      this._closeStream();
      this._scheduleReconnect();
    };
  }

  private _closeStream(): void {
    if (this._es) {
      this._es.close();
      this._es = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this._closed || this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(this._reconnectDelay * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openStream();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Event → state projection
  // -------------------------------------------------------------------------

  private _ingest(raw: RawEvent): void {
    const sessionId = raw.payload?.sessionId;
    if (!sessionId) return;

    const now = Date.now();
    const prev = this._states.get(sessionId);

    switch (raw.type) {
      case "session.status": {
        const status = raw.payload?.status;
        if (status === "idle") {
          if (prev) {
            this._states.delete(sessionId);
            this._emit(sessionId, undefined);
          }
          return;
        }
        // busy / retry → thinking (unless a tool call is currently in-flight)
        if (prev?.kind === "tool") {
          // Keep the tool phase — only refresh the liveness timestamp.
          const next: SessionActivityState = { ...prev, lastActivityAt: now };
          this._states.set(sessionId, next);
          this._emit(sessionId, next);
          return;
        }
        const next: SessionActivityState = {
          kind: "thinking",
          since: prev?.since ?? now,
          lastActivityAt: now,
        };
        this._states.set(sessionId, next);
        this._emit(sessionId, next);
        return;
      }

      case "tool.call.started": {
        const toolName = raw.payload?.toolName ?? "tool";
        const next: SessionActivityState = {
          kind: "tool",
          toolName,
          since: now,
          lastActivityAt: now,
        };
        this._states.set(sessionId, next);
        this._emit(sessionId, next);
        return;
      }

      case "tool.call.ended": {
        // Tool ended — return to "thinking" (the prompt loop is still running
        // until session.status=idle). If we never saw the corresponding start,
        // fall through to thinking anyway.
        const next: SessionActivityState = {
          kind: "thinking",
          since: now,
          lastActivityAt: now,
        };
        this._states.set(sessionId, next);
        this._emit(sessionId, next);
        return;
      }
    }
  }

  private _emit(sessionId: string, state: SessionActivityState | undefined): void {
    const set = this._listeners.get(sessionId);
    if (!set) return;
    for (const l of set) l(state);
  }

  private _sweepStale(): void {
    const cutoff = Date.now() - STALE_MS;
    for (const [sessionId, state] of this._states) {
      if (state.lastActivityAt < cutoff) {
        this._states.delete(sessionId);
        this._emit(sessionId, undefined);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ref-counted registry
// ---------------------------------------------------------------------------

interface Entry {
  store: SessionActivityStoreImpl;
  refCount: number;
}

const _registry = new Map<string, Entry>();

/**
 * Acquire the shared store for a given instance slug. Pair every call with
 * exactly one `releaseSessionActivityStore(slug)` to release the reference.
 * The underlying EventSource opens on first acquire and closes on last release.
 */
export function acquireSessionActivityStore(slug: string): SessionActivityStore {
  let entry = _registry.get(slug);
  if (!entry) {
    const store = new SessionActivityStoreImpl(slug);
    store.open();
    entry = { store, refCount: 0 };
    _registry.set(slug, entry);
  }
  entry.refCount += 1;
  return entry.store;
}

/** Release a reference acquired by `acquireSessionActivityStore(slug)`. */
export function releaseSessionActivityStore(slug: string): void {
  const entry = _registry.get(slug);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.store.close();
    _registry.delete(slug);
  }
}

// ---------------------------------------------------------------------------
// Test-only export
// ---------------------------------------------------------------------------

/** @internal — exposed for unit tests. Do not use in production code. */
export const __testing = {
  /** Construct an impl WITHOUT opening an EventSource — safe under Node/vitest. */
  create(slug: string): SessionActivityStoreImpl {
    return new SessionActivityStoreImpl(slug);
  },
  ingest(store: SessionActivityStoreImpl, raw: RawEvent): void {
    // @ts-expect-error -- test-only access to private projection method
    store._ingest(raw);
  },
  sweepStale(store: SessionActivityStoreImpl): void {
    // @ts-expect-error -- test-only access to private sweep method
    store._sweepStale();
  },
  STALE_MS,
  SWEEP_INTERVAL_MS,
};
