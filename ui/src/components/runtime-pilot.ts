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
import { localized } from "@lit/localize";
import type { PilotMessage, SessionContext, PilotBusEvent, RuntimeSession } from "../types.js";
import {
  postRuntimeChat,
  getRuntimeChatStreamUrl,
  fetchSessionMessages,
  fetchSessionContext,
  fetchRuntimeSessions,
} from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";
import "./pilot/pilot-header.js";
import "./pilot/pilot-messages.js";
import "./pilot/pilot-input.js";
import "./pilot/pilot-context-panel.js";

type PilotStatus = "idle" | "loading" | "sending" | "streaming" | "error";

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
        overflow: hidden;
      }

      /* Error banner */
      .error-banner {
        margin: 0 12px 8px;
        flex-shrink: 0;
      }

      /* Agent selector tab strip */
      .agent-tabs {
        display: flex;
        gap: 4px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--bg-border);
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
  @state() private _messages: PilotMessage[] = [];
  @state() private _hasMore = false;
  @state() private _streamingText = "";
  @state() private _streamingAgentId = "";
  @state() private _context: SessionContext | null = null;
  @state() private _panelOpen = true;
  @state() private _events: PilotBusEvent[] = [];
  @state() private _permanentSessions: RuntimeSession[] = [];
  @state() private _subagentResults: Record<
    string,
    { text?: string; steps?: number; tokens?: { input: number; output: number }; model?: string }
  > = {};

  private _eventSource: EventSource | null = null;
  private _activeSessionId = "";

  // SSE reconnect state
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _sseConnected = false;

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
    this._status = "loading";
    this._error = "";
    this._messages = [];
    this._hasMore = false;
    this._streamingText = "";
    this._events = [];
    this._context = null;
    this._activeSessionId = "";
    this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;

    // 1. Resolve the session ID — prop takes priority, otherwise auto-detect
    const resolvedId = this.sessionId || (await this._detectPermanentSession());

    if (resolvedId) {
      this._activeSessionId = resolvedId;
      await Promise.all([this._loadMessages(), this._loadContext()]);
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
    try {
      const sessions: RuntimeSession[] = await fetchRuntimeSessions(this.slug);
      const sorted = sessions
        .filter((s) => s.persistent && s.state === "active")
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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
    try {
      const { messages, hasMore } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 50,
        ...(before ? { before } : {}),
      });

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
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to load messages";
    }
  }

  private async _loadMore(): Promise<void> {
    if (!this._hasMore || this._messages.length === 0) return;
    const firstId = this._messages[0]?.id;
    await this._loadMessages(firstId);
  }

  /**
   * Light refresh: fetch the latest messages and merge without resetting the list.
   * Used by polling and visibilitychange. Does not change _status.
   */
  private async _refreshMessages(): Promise<void> {
    if (!this._activeSessionId || this._status === "streaming" || this._status === "sending") {
      return;
    }
    try {
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 20,
      });
      this._mergeMessages(messages);
    } catch {
      // Non-fatal — polling will retry
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
    try {
      this._context = await fetchSessionContext(this.slug, this._activeSessionId);
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
    const baseUrl = getRuntimeChatStreamUrl(this.slug);
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const es = new EventSource(url);
    this._eventSource = es;
    this._sseConnected = false; // will be set true on first message or open

    es.onopen = () => {
      this._sseConnected = true;
      this._reconnectDelay = SSE_RECONNECT_INITIAL_MS; // reset backoff on success
      // Clear any SSE error banner if the reconnect succeeds
      if (this._error.includes("Connection")) {
        this._error = "";
        if (this._status === "error") this._status = "idle";
      }
    };

    es.onmessage = (e: MessageEvent) => {
      this._sseConnected = true;
      let event: PilotBusEvent;
      try {
        event = JSON.parse(e.data as string) as PilotBusEvent;
      } catch {
        return;
      }
      this._handleBusEvent(event);
    };

    es.addEventListener("ping", () => {
      this._sseConnected = true;
      // Keep-alive — ignore
    });

    es.onerror = () => {
      this._sseConnected = false;
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
    this._closeStream();
    this._stopPolling();
  }

  // ── Bus event handler ─────────────────────────────────────────────────────

  private _handleBusEvent(event: PilotBusEvent): void {
    const p = event.payload;
    const eventSessionId = p.sessionId as string | undefined;

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
        if (delta) {
          this._streamingText += delta;
          if (this._status !== "streaming") this._status = "streaming";
        }
        break;
      }

      case "message.created": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        if (p.role === "assistant") {
          this._streamingText = "";
          this._streamingAgentId = (p.agentId as string | undefined) ?? "";
          this._status = "streaming";
        } else if (p.role === "user") {
          // Message from another channel (Telegram, CLI, etc.) — load it immediately
          void this._reloadLastMessages();
        }
        break;
      }

      case "message.updated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        // Reload the last message from API to get its parts
        void this._reloadLastMessages(p.messageId as string | undefined);
        this._streamingText = "";
        if (this._status !== "sending") this._status = "idle";
        break;
      }

      case "session.status": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const status = p.status as string;
        if (status === "busy" && this._status !== "streaming") {
          this._status = "streaming";
        } else if (status === "idle" && this._status !== "sending") {
          this._streamingText = "";
          this._status = "idle";
        }
        break;
      }

      case "session.ended": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._streamingText = "";
        this._status = "idle";
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
      case "llm.chunk_timeout":
      case "agent.timeout":
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
    try {
      // Reload the last few messages to pick up the completed message with parts
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 5,
      });
      this._mergeMessages(messages);
    } catch {
      // Non-fatal
    }
    void messageId; // suppress unused warning
  }

  // ── Send message ──────────────────────────────────────────────────────────

  private async _onSendMessage(e: CustomEvent<{ text: string }>): Promise<void> {
    const text = e.detail.text;
    if (!text.trim() || this._status !== "idle") return;

    this._status = "sending";
    this._error = "";

    try {
      const result = await postRuntimeChat(this.slug, {
        message: text,
        ...(this._activeSessionId ? { sessionId: this._activeSessionId } : {}),
      });

      // If this is the first message, we now have a sessionId — load context + start polling
      if (!this._activeSessionId && result.sessionId) {
        this._activeSessionId = result.sessionId;
        void this._loadContext();
        this._startPolling();
      }

      // Reload messages to show the complete exchange
      await this._reloadLastMessages(result.messageId);

      if (this._status === "sending") {
        this._status = "idle";
      }
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to send message";
    }
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

  // ── Agent selector ────────────────────────────────────────────────────────

  private _renderAgentSelector() {
    if (this._permanentSessions.length <= 1) return nothing;
    return html`
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
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    const isDisabled = this._status !== "idle";
    const agentId = this._context?.agent.id ?? "";
    const agentName = this._context?.agent.name ?? agentId;
    const model = this._context?.agent.model ?? "";

    return html`
      ${this._renderAgentSelector()}
      <cp-pilot-header
        .agentId=${agentId}
        .agentName=${agentName}
        .model=${model}
        .status=${this._status}
        .messageCount=${this._messages.length}
        .totalTokens=${this._totalTokens}
        .totalCost=${this._totalCost}
        .panelOpen=${this._panelOpen}
        @toggle-panel=${() => {
          this._panelOpen = !this._panelOpen;
        }}
      ></cp-pilot-header>

      <div class="pilot-body">
        <div class="pilot-main">
          <cp-pilot-messages
            .messages=${this._messages}
            .streamingText=${this._streamingText}
            .streamingAgentId=${this._streamingAgentId}
            .status=${this._status}
            .hasMore=${this._hasMore}
            .subagentResults=${this._subagentResults}
            @load-more=${this._loadMore}
          ></cp-pilot-messages>

          ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

          <cp-pilot-input
            .disabled=${isDisabled}
            @send-message=${this._onSendMessage}
          ></cp-pilot-input>
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
