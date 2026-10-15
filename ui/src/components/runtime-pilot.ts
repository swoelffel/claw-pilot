// ui/src/components/runtime-pilot.ts
// cp-runtime-pilot — Runtime Pilot orchestrator.
// Replaces cp-runtime-chat with a rich agent piloting interface:
// - Full message history with parts (tool calls, reasoning, subtasks, compaction)
// - Context panel (token gauge, tools, agent info, system prompt, event log)
// - All bus events forwarded via enriched SSE stream
// - Auto-detects permanent session on load (no first-message required)
// - Quasi real-time: SSE + polling fallback + visibilitychange refresh + SSE auto-reconnect
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  PilotMessage,
  SessionContext,
  PilotBusEvent,
  RuntimeSession,
  TimelineFilters,
} from "../types.js";
import { DEFAULT_TIMELINE_FILTERS } from "../types.js";
import {
  postRuntimeChat,
  abortSession,
  getRuntimeChatStreamUrl,
  fetchSessionMessages,
  fetchSessionContext,
  fetchRuntimeSessions,
  fetchRuntimeRequests,
} from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";
import { debugSse, debugChat, debugRender, debugApi } from "../services/debug.js";
import "./pilot/pilot-header.js";
import "./pilot/pilot-messages.js";
import "./pilot/pilot-input.js";
import "./pilot/pilot-context-panel.js";
import "./pilot/pilot-filter-bar.js";
import "./cp-start-cta.js";

// Extended status machine — `thinking` (reasoning stream) and `tool` (tool call
// in flight) are derived from delta events to give the user fine-grained feedback.
type PilotStatus = "idle" | "loading" | "sending" | "thinking" | "tool" | "streaming" | "error";

/** Max events kept in the ring buffer */
const MAX_EVENTS = 100;

/** Polling interval when SSE is healthy (fallback for missed events) */
const POLL_INTERVAL_MS = 10_000;

/** SSE reconnect backoff: initial delay, multiplier, max delay */
const SSE_RECONNECT_INITIAL_MS = 1_000;
const SSE_RECONNECT_MULTIPLIER = 2;
const SSE_RECONNECT_MAX_MS = 30_000;

@localized()
@customElement("cp-runtime-pilot")
export class RuntimePilot extends LitElement {
  static override styles = [
    tokenStyles,
    errorBannerStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--bg-surface);
      }

      /* Two-column layout: messages | context panel */
      .pilot-body {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      /* Left column: messages + input */
      .pilot-main {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      /* Flex constraints from parent — more reliable cross-browser than :host */
      .pilot-main > cp-pilot-messages {
        flex: 1 1 0%;
        min-height: 0;
        overflow: hidden;
      }
      .pilot-main > cp-pilot-input {
        flex-shrink: 0;
      }

      /* Error banner */
      .error-banner {
        margin: 0 12px 8px;
        flex-shrink: 0;
      }

      .recovery-info {
        color: var(--state-info);
        border-color: color-mix(in srgb, var(--state-info) 25%, transparent);
        background: color-mix(in srgb, var(--state-info) 8%, transparent);
      }

      /* Top navigation bar: back button + slug + agent tabs */
      .nav-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        min-height: 48px;
        flex-shrink: 0;
        background: var(--bg-surface);
        border-bottom: 1px solid var(--bg-border);
        overflow-x: auto;
      }

      .nav-back {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 13px;
        cursor: pointer;
        padding: 4px 0;
        font-family: inherit;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: color 0.15s;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .nav-back:hover {
        color: var(--text-primary);
      }

      .nav-sep {
        color: var(--bg-border);
        font-size: 14px;
        user-select: none;
        flex-shrink: 0;
      }

      .nav-slug {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 160px;
        flex-shrink: 0;
      }

      /* Agent tabs — inline in the nav bar */
      .agent-tabs {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
        overflow-x: auto;
      }

      .agent-tab {
        padding: 3px 10px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-family: var(--font-mono);
        cursor: pointer;
        border: 1px solid transparent;
        background: none;
        color: var(--text-muted);
        white-space: nowrap;
        transition: color 0.1s;
      }

      .agent-tab.active {
        background: var(--bg-hover);
        border-color: var(--bg-border);
        color: var(--text-primary);
        font-weight: 600;
      }

      .agent-tab:hover:not(.active) {
        color: var(--text-secondary);
      }
    `,
  ];

  // ── Public properties ─────────────────────────────────────────────────────

  @property({ type: String }) slug = "";
  /**
   * sessionId of the permanent session to pilot.
   * If empty, the component auto-detects the primary persistent session.
   */
  @property({ type: String }) sessionId = "";

  // ── Internal state ────────────────────────────────────────────────────────

  @state() private _status: PilotStatus = "idle";
  @state() private _error = "";
  @state() private _recoveryState: "" | "RECONNECTING" | "RESULT_READY" | "NEEDS_ATTENTION" = "";
  @state() private _messages: PilotMessage[] = [];
  @state() private _hasMore = false;
  @state() private _streamingText = "";
  @state() private _streamingReasoning = "";
  @state() private _streamingReasoningPartId: string | null = null;
  @state() private _currentToolName: string | null = null;
  @state() private _streamingAgentId = "";
  /** Assistant message id currently being streamed. While set, the matching
   * persisted entry is hidden from the timeline to avoid a double-render
   * (the live streaming bubble already shows the in-flight content). */
  @state() private _streamingMessageId: string | null = null;
  @state() private _context: SessionContext | null = null;
  @state() private _panelOpen = true;
  @state() private _filters: TimelineFilters = RuntimePilot._loadFilters();
  @state() private _events: PilotBusEvent[] = [];
  @state() private _permanentSessions: RuntimeSession[] = [];
  @state() private _subagentResults: Record<
    string,
    { text?: string; steps?: number; tokens?: { input: number; output: number }; model?: string }
  > = {};

  // ── Timeline filter helpers ──────────────────────────────────────────────

  private static _loadFilters(): TimelineFilters {
    try {
      const raw = localStorage.getItem("cp-pilot-timeline-filters");
      if (raw) return { ...DEFAULT_TIMELINE_FILTERS, ...(JSON.parse(raw) as TimelineFilters) };
    } catch {
      /* ignore corrupt localStorage */
    }
    return { ...DEFAULT_TIMELINE_FILTERS };
  }

  private _onFilterChange(e: CustomEvent<TimelineFilters>): void {
    this._filters = e.detail;
    try {
      localStorage.setItem("cp-pilot-timeline-filters", JSON.stringify(this._filters));
    } catch {
      /* ignore quota errors */
    }
  }

  private _eventSource: EventSource | null = null;
  private _activeSessionId = "";
  private _scopeVersion = 0;
  private _activityVersion = 0;
  private _activeRequestId = "";
  private _settledRequestId = "";

  /** Ignore work started for an old instance, session, or component attachment. */
  private _captureScope(): () => boolean {
    const version = this._scopeVersion;
    const slug = this.slug;
    const sessionId = this._activeSessionId;
    return () =>
      version === this._scopeVersion && slug === this.slug && sessionId === this._activeSessionId;
  }

  private _finishActivity(): void {
    this._activityVersion += 1;
    this._streamingText = "";
    this._streamingReasoning = "";
    this._streamingReasoningPartId = null;
    this._currentToolName = null;
    this._streamingMessageId = null;
    this._status = "idle";
  }

  // SSE reconnect state
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _sseConnected = false;
  private _lastEventId = "";

  // Polling fallback
  private _pollInterval: ReturnType<typeof setInterval> | null = null;

  // visibilitychange listener (stored to remove on disconnect)
  private _onVisibilityChange: (() => void) | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();

    // Refresh when the tab becomes visible again
    this._onVisibilityChange = () => {
      if (document.visibilityState === "visible" && this._activeSessionId) {
        void this._refreshMessages();
        // Reopen SSE if it dropped while the tab was hidden
        if (!this._sseConnected) {
          this._scheduleReconnect(0);
        }
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    if (this.slug) {
      void this._init();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardown();
    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if ((changed.has("slug") || changed.has("sessionId")) && this.slug) {
      void this._init();
    }
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    this._teardown();
    const version = this._scopeVersion;
    this._status = "loading";
    this._error = "";
    this._lastEventId = "";
    this._recoveryState = "";
    this._activeRequestId = "";
    this._settledRequestId = "";
    this._messages = [];
    this._hasMore = false;
    this._streamingText = "";
    this._streamingReasoning = "";
    this._streamingReasoningPartId = null;
    this._currentToolName = null;
    this._streamingAgentId = "";
    this._streamingMessageId = null;
    this._subagentResults = {};
    this._events = [];
    this._context = null;
    this._activeSessionId = "";
    this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;

    // 1. Resolve the session ID — prop takes priority, otherwise auto-detect
    const resolvedId = this.sessionId || (await this._detectPermanentSession());
    if (version !== this._scopeVersion) return;

    if (resolvedId) {
      this._activeSessionId = resolvedId;
      await Promise.all([this._loadMessages(), this._loadContext()]);
      if (version !== this._scopeVersion) return;
      this._openStream();
      this._startPolling();
    } else {
      // No permanent session yet — show empty state, wait for first send
      this._status = "idle";
      // Still open the SSE stream so we catch session.created when first message is sent
      this._openStream();
    }
  }

  /**
   * Auto-detect the primary persistent session for this instance.
   * Returns the session ID if found, otherwise undefined.
   */
  private async _detectPermanentSession(): Promise<string | undefined> {
    const isCurrent = this._captureScope();
    try {
      const sessions: RuntimeSession[] = await fetchRuntimeSessions(this.slug, {
        includeInternal: true,
      });
      if (!isCurrent()) return undefined;
      const sorted = sessions
        .filter((s) => s.persistent && s.state === "active")
        .sort((a, b) => {
          if (a.agentIsDefault !== b.agentIsDefault) return a.agentIsDefault ? -1 : 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      this._permanentSessions = sorted;
      return sorted[0]?.id;
    } catch {
      return undefined;
    }
  }

  private _switchSession(sessionId: string): void {
    if (sessionId === this._activeSessionId) return;
    this.sessionId = sessionId;
    // updated() will re-run _init() when sessionId changes
  }

  // ── Message loading (with pagination) ────────────────────────────────────

  private async _loadMessages(before?: string): Promise<void> {
    if (!this._activeSessionId) return;
    const isCurrent = this._captureScope();
    debugApi("runtime-pilot fetchSessionMessages loadMessages", {
      sessionId: this._activeSessionId,
      before,
    });
    try {
      const { messages, hasMore } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 50,
        ...(before ? { before } : {}),
      });

      if (!isCurrent()) return;
      if (before) {
        // Prepend older messages
        this._messages = [...messages, ...this._messages];
      } else {
        this._messages = messages;
      }
      this._hasMore = hasMore;

      if (this._status === "loading") {
        this._status = "idle";
      }
    } catch (err) {
      if (!isCurrent()) return;
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to load messages";
    }
  }

  private async _loadMore(): Promise<void> {
    if (!this._hasMore || this._messages.length === 0) return;
    const firstId = this._messages[0]?.id;
    await this._loadMessages(firstId);
  }

  /** Reconcile durable execution state after missed events, using reads only. */
  private async _refreshMessages(): Promise<void> {
    if (!this._activeSessionId) return;
    const isCurrent = this._captureScope();
    const activity = this._activityVersion;
    const stillCurrent = () => isCurrent() && activity === this._activityVersion;
    try {
      const [requests, { messages }] = await Promise.all([
        fetchRuntimeRequests(this.slug, {
          sessionId: this._activeSessionId,
          limit: 1,
        }),
        fetchSessionMessages(this.slug, this._activeSessionId, { limit: 20 }),
      ]);
      if (!stillCurrent()) return;
      const latest = requests[0];
      this._mergeMessages(messages);
      // A previous execution can already be terminal while the current POST is
      // still being accepted. Only its preassigned request ID may settle it.
      if (
        this._activeRequestId &&
        this._settledRequestId !== this._activeRequestId &&
        latest?.id !== this._activeRequestId
      ) {
        const requestId = this._activeRequestId;
        const [active] = await fetchRuntimeRequests(this.slug, {
          sessionId: this._activeSessionId,
          requestId,
          limit: 1,
        });
        if (!stillCurrent() || this._activeRequestId !== requestId) return;
        if (
          active?.id !== requestId ||
          active.session_id !== this._activeSessionId ||
          !["succeeded", "failed", "timed_out", "cancelled"].includes(active.execution_status ?? "")
        )
          return;
        // Its HTTP response can remain pending after execution has finished and
        // another channel has started a newer turn in this shared session.
        this._activeRequestId = "";
        this._settledRequestId = requestId;
        await this._refreshMessages();
        return;
      }
      if (!latest || latest.session_id !== this._activeSessionId) return;
      const terminal = latest.execution_status;
      if (terminal === "accepted" || terminal === "running") {
        if (this._status === "idle") this._status = this._hasPendingQuestion ? "tool" : "sending";
        return;
      }
      if (!["succeeded", "failed", "timed_out", "cancelled"].includes(terminal ?? "")) return;
      const wasBusy = ["sending", "thinking", "tool", "streaming", "error"].includes(this._status);
      const wasReconnecting = this._recoveryState === "RECONNECTING";
      this._settledRequestId = latest.id;
      if (this._activeRequestId === latest.id) this._activeRequestId = "";
      this._finishActivity();
      this._error = "";
      if (terminal !== "succeeded") this._recoveryState = "NEEDS_ATTENTION";
      else if (wasBusy || wasReconnecting) this._recoveryState = "RESULT_READY";
    } catch {
      // Non-fatal — polling will retry without re-executing the request.
    }
  }

  /**
   * Merge a batch of fresh messages into the existing list.
   * Updates in-place if already present, appends new ones at the end.
   */
  private _mergeMessages(fresh: PilotMessage[]): void {
    if (fresh.length === 0) return;
    const existingIds = new Set(this._messages.map((m) => m.id));
    const newMsgs = fresh.filter((m) => !existingIds.has(m.id));
    const updatedMsgs = this._messages.map((m) => {
      const updated = fresh.find((nm) => nm.id === m.id);
      return updated ?? m;
    });
    if (newMsgs.length > 0 || updatedMsgs.some((m, i) => m !== this._messages[i])) {
      this._messages = [...updatedMsgs, ...newMsgs];
    }
  }

  // ── Context loading ───────────────────────────────────────────────────────

  private async _loadContext(): Promise<void> {
    if (!this._activeSessionId) return;
    const isCurrent = this._captureScope();
    try {
      const context = await fetchSessionContext(this.slug, this._activeSessionId);
      if (isCurrent()) this._context = context;
    } catch {
      // Non-fatal — context panel shows empty state
    }
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  private _openStream(): void {
    this._closeStream();
    if (!this.slug) return;

    // Stream all instance events (no sessionId filter) — we filter client-side
    const token = getToken();
    const baseUrl = getRuntimeChatStreamUrl(this.slug, undefined, this._lastEventId || undefined);
    const url = token
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : baseUrl;
    // withCredentials ensures cookies (session) are sent even under strict
    // SameSite policies; the ?token fallback above covers the case where no
    // cookie is available.
    const es = new EventSource(url, { withCredentials: true });
    this._eventSource = es;
    this._sseConnected = false; // will be set true on first message or open
    debugSse("[runtime-pilot] _openStream", baseUrl);

    es.onopen = () => {
      if (this._eventSource !== es) return;
      this._sseConnected = true;
      this._reconnectDelay = SSE_RECONNECT_INITIAL_MS; // reset backoff on success
      debugSse("[runtime-pilot] sse open");
      void this._refreshMessages();
      // Clear any SSE error banner if the reconnect succeeds
      if (this._error.includes("Connection")) {
        this._error = "";
        if (this._status === "error") this._status = "idle";
      }
    };

    es.onmessage = (e: MessageEvent) => {
      if (this._eventSource !== es) return;
      this._sseConnected = true;
      if (e.lastEventId) this._lastEventId = e.lastEventId;
      let event: PilotBusEvent;
      try {
        event = JSON.parse(e.data as string) as PilotBusEvent;
      } catch {
        return;
      }
      debugSse("[runtime-pilot] sse event", event.type);
      this._handleBusEvent(event);
    };

    es.addEventListener("ping", () => {
      if (this._eventSource !== es) return;
      this._sseConnected = true;
      // Keep-alive — ignore
    });

    es.onerror = () => {
      if (this._eventSource !== es) return;
      this._sseConnected = false;
      if (["sending", "thinking", "tool", "streaming"].includes(this._status))
        this._recoveryState = "RECONNECTING";
      debugSse("[runtime-pilot] sse error, reconnecting in", this._reconnectDelay, "ms");
      this._closeStream();
      // Schedule reconnect with exponential backoff (silent — no error banner unless persistent)
      this._scheduleReconnect(this._reconnectDelay);
      this._reconnectDelay = Math.min(
        this._reconnectDelay * SSE_RECONNECT_MULTIPLIER,
        SSE_RECONNECT_MAX_MS,
      );
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    this._sseConnected = false;
    if (this._reconnectTimeout !== null) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
  }

  private _scheduleReconnect(delayMs: number): void {
    if (this._reconnectTimeout !== null) return;
    this._reconnectTimeout = setTimeout(() => {
      this._reconnectTimeout = null;
      if (this.slug) {
        this._openStream();
      }
    }, delayMs);
  }

  // ── Polling fallback ──────────────────────────────────────────────────────

  private _startPolling(): void {
    this._stopPolling();
    this._pollInterval = setInterval(() => {
      // Only poll if SSE might have missed something (tab was hidden, SSE reconnecting, etc.)
      // When SSE is healthy and active, this is a lightweight safety net
      if (this._activeSessionId) {
        void this._refreshMessages();
      }
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollInterval !== null) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  // ── Full teardown ─────────────────────────────────────────────────────────

  private _teardown(): void {
    this._scopeVersion += 1;
    this._closeStream();
    this._stopPolling();
  }

  // ── Bus event handler ─────────────────────────────────────────────────────

  private _handleBusEvent(event: PilotBusEvent): void {
    const p = event.payload;
    const eventSessionId = p.sessionId as string | undefined;
    debugSse("runtime-pilot recv", event.type, {
      sessionId: eventSessionId,
      activeSessionId: this._activeSessionId,
      role: p.role,
      agentId: p.agentId,
      messageId: p.messageId,
      partType: p.partType,
      deltaLen: typeof p.delta === "string" ? (p.delta as string).length : undefined,
    });

    // If we don't have a session yet but an event arrives with a sessionId,
    // adopt it as our active session (handles the case where a message arrives
    // from another channel before the UI has loaded the session).
    if (!this._activeSessionId && eventSessionId) {
      this._activeSessionId = eventSessionId;
      void this._loadMessages();
      void this._loadContext();
      this._startPolling();
    }

    switch (event.type) {
      // ── Message streaming ────────────────────────────────────────────────
      case "message.part.delta": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const delta = p.delta as string | undefined;
        const partType = (p.partType as string | undefined) ?? "text";
        const partId = p.partId as string | undefined;
        if (!delta) break;
        if (partType === "reasoning") {
          // Reset buffer when a new reasoning block starts (different partId)
          if (partId && this._streamingReasoningPartId !== partId) {
            this._streamingReasoning = "";
            this._streamingReasoningPartId = partId;
          }
          this._streamingReasoning += delta;
          if (this._status !== "thinking") this._status = "thinking";
        } else {
          this._streamingText += delta;
          if (this._status !== "streaming") this._status = "streaming";
        }
        break;
      }

      case "message.created": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        if (p.role === "assistant") {
          this._activityVersion += 1;
          this._recoveryState = "";
          this._streamingText = "";
          this._streamingReasoning = "";
          this._streamingReasoningPartId = null;
          this._currentToolName = null;
          this._streamingAgentId = (p.agentId as string | undefined) ?? "";
          this._streamingMessageId = (p.messageId as string | undefined) ?? null;
          // Keep status as "sending" until the first delta tells us the phase
          if (this._status !== "sending") this._status = "sending";
          debugChat("runtime-pilot start streaming assistant", {
            messageId: this._streamingMessageId,
            agentId: this._streamingAgentId,
            status: this._status,
          });
        } else if (p.role === "user") {
          // Message from another channel (Telegram, CLI, etc.) — load it immediately
          void this._reloadLastMessages();
        }
        break;
      }

      case "message.updated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        // Reload the last message from API to get its parts.
        // Do NOT touch this._status here — message.updated fires on every
        // tool call / tool result during a running loop. Trust session.status
        // events for busy/idle transitions (emitted once at start, once at end).
        void this._reloadLastMessages(p.messageId as string | undefined);
        this._streamingText = "";
        break;
      }

      case "tool.call.started": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._currentToolName = (p.toolName as string | undefined) ?? null;
        this._status = "tool";
        break;
      }

      case "tool.call.ended": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._currentToolName = null;
        // Do not force another status here — next delta (reasoning/text) will set it.
        break;
      }

      case "session.status": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const status = p.status as string;
        if (status === "busy") {
          this._activityVersion += 1;
          this._recoveryState = "";
        }
        if (
          status === "busy" &&
          this._status !== "streaming" &&
          this._status !== "thinking" &&
          this._status !== "tool"
        ) {
          this._status = "sending";
        } else if (
          status === "idle" &&
          (this._status === "sending" ||
            (this._activeRequestId && this._activeRequestId !== this._settledRequestId))
        ) {
          // Replayed assistant creation has no delta to move us out of sending.
          // Durable request identity also protects an in-flight new HTTP send.
          void this._refreshMessages();
        } else if (status === "idle") {
          this._streamingText = "";
          this._streamingReasoning = "";
          this._streamingReasoningPartId = null;
          this._currentToolName = null;
          this._streamingMessageId = null;
          this._status = "idle";
          debugChat("runtime-pilot stream ended (idle)", { status: this._status });
          // Ensure the final messages are rendered — individual
          // message.updated/created events may have been missed.
          void this._reloadLastMessages();
        }
        break;
      }

      case "session.ended": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._streamingText = "";
        this._streamingReasoning = "";
        this._streamingReasoningPartId = null;
        this._currentToolName = null;
        this._streamingMessageId = null;
        this._status = "idle";
        debugChat("runtime-pilot session ended", { status: this._status });
        break;
      }

      // ── Sub-agents ───────────────────────────────────────────────────────
      case "subagent.completed": {
        const subId = p.subSessionId as string | undefined;
        if (subId) {
          this._subagentResults = {
            ...this._subagentResults,
            [subId]: p.result as {
              text?: string;
              steps?: number;
              tokens?: { input: number; output: number };
              model?: string;
            },
          };
        }
        this._addEvent(event);
        break;
      }

      // ── Suggestions ─────────────────────────────────────────────────────
      case "suggestions.generated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        // Refresh messages to pick up the new suggestion part
        void this._refreshMessages();
        break;
      }

      // ── Question asked — reload so the question card renders immediately ─
      // Fired when a question tool call suspends the prompt loop. Without this
      // handler, subagent-initiated questions only appear after a manual F5.
      // Reload directly so the question card does not wait for a request-state
      // reconciliation; tool.call.started has already marked the session busy.
      case "question.asked": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        void this._reloadLastMessages();
        break;
      }

      // ── System prompt real-time update ──────────────────────────────────
      case "session.system_prompt": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const systemPrompt = p.systemPrompt as string | undefined;
        const builtAt = p.builtAt as string | undefined;
        if (systemPrompt !== undefined && this._context) {
          // Patch _context in place to avoid a full reload
          this._context = {
            ...this._context,
            systemPrompt: systemPrompt,
            ...(builtAt !== undefined ? { systemPromptBuiltAt: builtAt } : {}),
          };
        }
        break;
      }

      // ── Context refresh triggers ─────────────────────────────────────────
      case "mcp.tools.changed":
        void this._loadContext();
        this._addEvent(event);
        break;

      // ── Events for the event log ─────────────────────────────────────────
      case "permission.asked":
      case "permission.replied":
      case "provider.failover":
      case "provider.auth_failed":
      case "tool.doom_loop":
        this._addEvent(event);
        break;
      case "llm.chunk_timeout":
      case "agent.timeout":
        if (!eventSessionId || eventSessionId !== this._activeSessionId) break;
        this._recoveryState = "NEEDS_ATTENTION";
        void this._refreshMessages();
        this._addEvent(event);
        break;
      case "session.created":
      case "session.updated":
        this._addEvent(event);
        break;

      default:
        break;
    }
  }

  private _addEvent(event: PilotBusEvent): void {
    const ev: PilotBusEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    // Ring buffer — keep last MAX_EVENTS
    const next = [...this._events, ev];
    this._events = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  }

  private async _reloadLastMessages(messageId?: string): Promise<void> {
    if (!this._activeSessionId) return;
    const isCurrent = this._captureScope();
    const activity = this._activityVersion;
    debugApi("runtime-pilot fetchSessionMessages reloadLast", {
      sessionId: this._activeSessionId,
      triggerMessageId: messageId,
      streamingActive: this._streamingText.length > 0,
    });
    try {
      // Reload the last few messages to pick up the completed message with parts
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 5,
      });
      if (isCurrent() && activity === this._activityVersion) this._mergeMessages(messages);
    } catch {
      // Non-fatal
    }
    void messageId; // suppress unused warning
  }

  // ── Kickoff (Start CTA) ───────────────────────────────────────────────────

  private _onKickoffDone = (e: Event): void => {
    const detail = (e as CustomEvent<{ sessionId: string; greeting: string }>).detail;
    if (!this._activeSessionId && detail?.sessionId) {
      this._activeSessionId = detail.sessionId;
    }
  };

  // ── Send message ──────────────────────────────────────────────────────────

  private async _onSendMessage(
    e: CustomEvent<{
      text: string;
      files?: Array<{ name: string; mimeType: string; data: string }>;
    }>,
  ): Promise<void> {
    const text = e.detail.text;
    const files = e.detail.files;
    if ((!text.trim() && !files?.length) || this._status !== "idle") return;

    this._status = "sending";
    this._error = "";
    this._recoveryState = "";
    this._activityVersion += 1;
    const version = this._scopeVersion;
    const slug = this.slug;
    const requestId = crypto.randomUUID();
    this._activeRequestId = requestId;
    const isCurrent = () =>
      version === this._scopeVersion &&
      slug === this.slug &&
      this._activeRequestId === requestId &&
      this._settledRequestId !== requestId;

    try {
      const result = await postRuntimeChat(
        this.slug,
        {
          message: text,
          ...(this._activeSessionId ? { sessionId: this._activeSessionId } : {}),
          ...(this._context?.agent.id ? { agentId: this._context.agent.id } : {}),
          ...(files !== undefined && files.length > 0 ? { files } : {}),
        },
        requestId,
      );
      if (!isCurrent()) return;

      // If this is the first message, we now have a sessionId — load context + start polling
      if (!this._activeSessionId && result.sessionId) {
        this._activeSessionId = result.sessionId;
        void this._loadContext();
        this._startPolling();
      }

      // Reload messages to show the complete exchange
      await this._reloadLastMessages(result.messageId);
      if (!isCurrent()) return;

      // If the backend returned early because the loop is suspended on a
      // pending question, keep the UI in its current busy state — SSE will
      // drive further transitions and the question card handles the user
      // interaction from here.
      if (result.pendingQuestion) {
        debugSse("[runtime-pilot] pendingQuestion=true — UI stays busy, SSE drives updates");
        // Keep the pending question visibly active until canonical execution
        // state or subsequent stream events report completion.
        if (this._status === "sending") this._status = "thinking";
      } else {
        this._settledRequestId = requestId;
        this._activeRequestId = "";
        // A newer cross-channel turn may already be running by the time this
        // response arrives. Follow the current session projection before idle.
        await this._refreshMessages();
      }
    } catch (err) {
      if (!isCurrent()) return;
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to send message";
    }
  }

  // ── Abort ───────────────────────────────────────────────────────────────

  private async _onAbortRequest(): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      await abortSession(this.slug, this._activeSessionId);
    } catch {
      // Non-fatal — the loop may have already finished
    }
    // Optimistic: immediately restore idle state
    this._status = "idle";
    this._streamingText = "";
    this._streamingAgentId = "";
    this._streamingMessageId = null;
  }

  // ── Suggestion click ────────────────────────────────────────────────────

  private _onSuggestionClick(e: CustomEvent<{ text: string }>): void {
    void this._onSendMessage(new CustomEvent("send-message", { detail: { text: e.detail.text } }));
  }

  /**
   * The user answered a question — the backend just resumed the paused prompt
   * loop but doesn't emit a new session.status event (the session was already
   * busy). Flip to streaming so the UI reflects ongoing activity.
   */
  private _onQuestionAnswered(): void {
    if (this._status === "idle") {
      this._status = "streaming";
    }
  }

  private _onQuestionExpired(): void {
    this._status = "idle";
    this._currentToolName = null;
    void this._reloadLastMessages();
  }

  // ── Stats computed from messages ──────────────────────────────────────────

  private get _totalTokens(): number {
    return (
      this._context?.tokenUsage.estimated ??
      this._messages.reduce((sum, m) => sum + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0)
    );
  }

  private get _totalCost(): number {
    return this._messages.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  }

  // ── Nav bar (back + slug + agent tabs) ───────────────────────────────────

  private _renderNavBar() {
    return html`
      <div class="nav-bar">
        <button
          class="nav-back"
          @click=${() =>
            this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }))}
        >
          ← ${msg("Back", { id: "settings-back" })}
        </button>
        <span class="nav-sep">/</span>
        <span class="nav-slug" title="${this.slug}">${this.slug}</span>

        ${this._permanentSessions.length > 1
          ? html`
              <span class="nav-sep">/</span>
              <div class="agent-tabs">
                ${this._permanentSessions.map(
                  (s) => html`
                    <button
                      class="agent-tab ${s.id === this._activeSessionId ? "active" : ""}"
                      @click=${() => this._switchSession(s.id)}
                    >
                      ${s.agentName ?? s.agentId}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * True when the latest assistant message has an unresolved `question`
   * tool_call — while pending, the chat input must be locked to prevent the
   * user from queuing a text message that would deadlock behind the
   * question's Promise in the session queue.
   */
  private get _hasPendingQuestion(): boolean {
    const last = this._messages[this._messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.parts.some((p) => {
      if (p.type !== "tool_call" || p.state !== undefined) return false;
      try {
        const meta = JSON.parse(p.metadata ?? "{}") as { toolName?: string };
        return meta.toolName === "question";
      } catch {
        return false;
      }
    });
  }

  override render() {
    const isDisabled = this._status !== "idle";
    const isStreaming =
      this._status === "sending" ||
      this._status === "streaming" ||
      this._status === "thinking" ||
      this._status === "tool";
    const lockReason: "pending_question" | "" = this._hasPendingQuestion ? "pending_question" : "";
    const agentId = this._context?.agent.id ?? "";
    const agentName = this._context?.agent.name ?? agentId;
    const model = this._context?.agent.model ?? "";

    // Diagnostic guard: surfaces any regression of the in-flight filter that
    // protects the timeline from rendering the same assistant reply twice
    // during streaming. Only emits when `cp:debug-render` is enabled.
    if (
      this._streamingMessageId &&
      this._streamingText.length > 0 &&
      this._messages.some((m) => m.id === this._streamingMessageId)
    ) {
      debugRender("runtime-pilot filtering in-flight assistant row", {
        streamingMessageId: this._streamingMessageId,
        streamingTextLen: this._streamingText.length,
      });
    }

    return html`
      ${this._renderNavBar()}
      <cp-pilot-header
        .agentId=${agentId}
        .agentName=${agentName}
        .model=${model}
        .status=${this._status}
        .toolName=${this._currentToolName}
        .messageCount=${this._messages.length}
        .totalTokens=${this._totalTokens}
        .totalCost=${this._totalCost}
        .panelOpen=${this._panelOpen}
        @toggle-panel=${() => {
          this._panelOpen = !this._panelOpen;
        }}
      ></cp-pilot-header>

      <div class="pilot-body">
        <div
          class="pilot-main"
          @suggestion-click=${this._onSuggestionClick}
          @question-answered=${this._onQuestionAnswered}
          @question-expired=${this._onQuestionExpired}
        >
          <cp-pilot-filter-bar
            .filters=${this._filters}
            @filter-change=${this._onFilterChange}
          ></cp-pilot-filter-bar>

          ${this._messages.length === 0 && this._status !== "loading" && agentId
            ? html`<cp-start-cta
                .slug=${this.slug}
                .agentId=${agentId}
                @cp-kickoff-done=${this._onKickoffDone}
              ></cp-start-cta>`
            : html`
                <cp-pilot-messages
                  .messages=${this._streamingMessageId
                    ? this._messages.filter((m) => m.id !== this._streamingMessageId)
                    : this._messages}
                  .filters=${this._filters}
                  .currentAgentId=${agentId}
                  .streamingText=${this._streamingText}
                  .streamingReasoning=${this._streamingReasoning}
                  .streamingReasoningPartId=${this._streamingReasoningPartId}
                  .streamingAgentId=${this._streamingAgentId}
                  .status=${this._status}
                  .hasMore=${this._hasMore}
                  .subagentResults=${this._subagentResults}
                  .slug=${this.slug}
                  @load-more=${this._loadMore}
                ></cp-pilot-messages>

                ${this._recoveryState
                  ? html`<div
                      class="error-banner ${this._recoveryState === "NEEDS_ATTENTION"
                        ? ""
                        : "recovery-info"}"
                      role="status"
                    >
                      ${this._recoveryState === "RECONNECTING"
                        ? msg("Connection lost. Checking the saved execution…", {
                            id: "pilot-recovery-reconnecting",
                          })
                        : this._recoveryState === "RESULT_READY"
                          ? msg("Saved response recovered.", { id: "pilot-recovery-ready" })
                          : msg(
                              "The execution stopped before completing. Review the saved messages before retrying.",
                              { id: "pilot-recovery-attention" },
                            )}
                    </div>`
                  : nothing}
                ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

                <cp-pilot-input
                  .disabled=${isDisabled}
                  .streaming=${isStreaming}
                  .lockReason=${lockReason}
                  @send-message=${this._onSendMessage}
                  @abort-request=${this._onAbortRequest}
                ></cp-pilot-input>
              `}
        </div>

        <cp-pilot-context-panel
          .context=${this._context}
          .events=${this._events}
          ?closed=${!this._panelOpen}
          @toggle-panel=${() => {
            this._panelOpen = !this._panelOpen;
          }}
        ></cp-pilot-context-panel>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-runtime-pilot": RuntimePilot;
  }
}
