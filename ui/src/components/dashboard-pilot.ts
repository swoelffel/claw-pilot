// ui/src/components/dashboard-pilot.ts
//
// cp-dashboard-pilot — Mini-pilot chat sidebar for the instance dashboard.
// Simplified version of home-chat: text-only SMS bubbles, SSE streaming,
// status indicator, no tool-call / reasoning / artifact rendering.

import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, PilotBusEvent } from "../types.js";
import {
  postRuntimeChat,
  getRuntimeChatStreamUrl,
  fetchSessionMessages,
  fetchRuntimeSessions,
} from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { getToken } from "../services/auth-state.js";
import { debugSse } from "../services/debug.js";

type PilotStatus = "idle" | "loading" | "sending" | "thinking" | "tool" | "streaming" | "error";

/** Polling fallback when SSE drops or misses an event */
const POLL_INTERVAL_MS = 10_000;

/** SSE reconnect backoff */
const SSE_RECONNECT_INITIAL_MS = 1_000;
const SSE_RECONNECT_MULTIPLIER = 2;
const SSE_RECONNECT_MAX_MS = 30_000;

@localized()
@customElement("cp-dashboard-pilot")
export class DashboardPilot extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        height: 100%;
        min-height: 400px;
        overflow: hidden;
      }

      /* Header */
      .pilot-header {
        flex-shrink: 0;
        padding: var(--space-3);
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .pilot-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        cursor: pointer;
      }
      .pilot-label:hover {
        color: var(--accent);
      }
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
      }
      .status-dot[data-status="idle"] {
        background: var(--text-muted);
      }
      .status-dot[data-status="sending"] {
        background: var(--accent);
      }
      .status-dot[data-status="thinking"] {
        background: var(--state-warning);
      }
      .status-dot[data-status="tool"] {
        background: var(--state-info);
      }
      .status-dot[data-status="streaming"] {
        background: var(--state-running);
      }
      .status-dot[data-status="loading"] {
        background: var(--text-muted);
      }
      .status-dot[data-status="error"] {
        background: var(--state-error, #ef4444);
      }
      .status-label {
        font-size: 11px;
        color: var(--text-muted);
      }

      /* Messages area */
      .messages {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .msg-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .msg-meta {
        font-size: 11px;
        color: var(--text-muted);
      }
      .msg-bubble {
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-lg);
        font-size: 13px;
        line-height: 1.5;
        max-width: 85%;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .msg-agent {
        align-self: flex-start;
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .msg-user {
        align-self: flex-end;
        background: var(--accent-subtle);
        border: 1px solid var(--accent-border);
        color: var(--text-primary);
      }
      .msg-user .msg-meta {
        text-align: right;
      }
      .empty-msg {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        font-size: 13px;
      }

      /* Input bar */
      .input-bar {
        display: flex;
        gap: var(--space-2);
        padding: var(--space-3);
        border-top: 1px solid var(--bg-border);
        flex-shrink: 0;
      }
      .input-bar textarea {
        flex: 1;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        padding: 6px 10px;
        resize: none;
        max-height: 60px;
        overflow-y: auto;
      }
      .input-bar textarea:focus {
        outline: none;
        border-color: var(--accent);
      }
      .btn-send {
        background: var(--accent);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 14px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .btn-send:disabled {
        opacity: 0.4;
        cursor: default;
      }
    `,
  ];

  // ── Public properties ─────────────────────────────────────────────────────

  @property({ type: String }) slug = "";

  // ── Internal state ────────────────────────────────────────────────────────

  @state() private _status: PilotStatus = "idle";
  @state() private _error = "";
  @state() private _messages: PilotMessage[] = [];
  @state() private _streamingText = "";
  @state() private _inputText = "";

  @query(".messages") private _messagesEl!: HTMLDivElement;

  private _eventSource: EventSource | null = null;
  private _activeSessionId = "";
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _sseConnected = false;
  private _pollInterval: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.slug) void this._init();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardown();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") && this.slug) void this._init();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    this._teardown();
    this._status = "loading";
    this._error = "";
    this._messages = [];
    this._streamingText = "";
    this._activeSessionId = "";
    this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;

    const sessionId = await this._detectPermanentSession();
    if (sessionId) {
      this._activeSessionId = sessionId;
      await this._loadMessages();
      // Scroll to bottom on initial load (after render)
      await this.updateComplete;
      this._scrollToBottom(false);
      this._openStream();
      this._startPolling();
    } else {
      this._status = "idle";
      this._openStream();
    }
  }

  /** Find the primary persistent session for this instance. */
  private async _detectPermanentSession(): Promise<string | undefined> {
    try {
      const sessions = await fetchRuntimeSessions(this.slug, { includeInternal: true });
      const sorted = sessions
        .filter((s) => s.persistent && s.state === "active")
        .sort((a, b) => {
          if (a.agentIsDefault !== b.agentIsDefault) return a.agentIsDefault ? -1 : 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      return sorted[0]?.id;
    } catch {
      return undefined;
    }
  }

  // ── Message loading ───────────────────────────────────────────────────────

  private async _loadMessages(): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 50,
      });
      this._messages = messages;
      if (this._status === "loading") this._status = "idle";
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to load messages";
    }
  }

  private async _refreshMessages(): Promise<void> {
    if (
      !this._activeSessionId ||
      this._status === "streaming" ||
      this._status === "sending" ||
      this._status === "thinking" ||
      this._status === "tool"
    ) {
      return;
    }
    try {
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 20,
      });
      this._mergeMessages(messages);
    } catch {
      // Polling will retry
    }
  }

  private async _reloadLastMessages(): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 5,
      });
      this._mergeMessages(messages);
    } catch {
      // Non-fatal
    }
  }

  private _mergeMessages(fresh: PilotMessage[]): void {
    if (fresh.length === 0) return;
    const existingIds = new Set(this._messages.map((m) => m.id));
    const newMsgs = fresh.filter((m) => !existingIds.has(m.id));
    const updatedMsgs = this._messages.map((m) => fresh.find((nm) => nm.id === m.id) ?? m);
    if (newMsgs.length > 0 || updatedMsgs.some((m, i) => m !== this._messages[i])) {
      this._messages = [...updatedMsgs, ...newMsgs];
    }
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  private _openStream(): void {
    this._closeStream();
    if (!this.slug) return;
    const token = getToken();
    const baseUrl = getRuntimeChatStreamUrl(this.slug);
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const es = new EventSource(url, { withCredentials: true });
    this._eventSource = es;
    this._sseConnected = false;
    debugSse("[dashboard-pilot] _openStream", baseUrl);

    es.onopen = () => {
      this._sseConnected = true;
      this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;
      debugSse("[dashboard-pilot] sse open");
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
      debugSse("[dashboard-pilot] sse event", event.type);
      this._handleBusEvent(event);
    };

    es.addEventListener("ping", () => {
      this._sseConnected = true;
    });

    es.onerror = () => {
      this._sseConnected = false;
      debugSse("[dashboard-pilot] sse error, reconnecting in", this._reconnectDelay, "ms");
      this._closeStream();
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
      if (this.slug) this._openStream();
    }, delayMs);
  }

  private _startPolling(): void {
    this._stopPolling();
    this._pollInterval = setInterval(() => {
      if (this._activeSessionId) void this._refreshMessages();
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollInterval !== null) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private _teardown(): void {
    this._closeStream();
    this._stopPolling();
  }

  // ── Bus event handler ─────────────────────────────────────────────────────

  private _handleBusEvent(event: PilotBusEvent): void {
    const p = event.payload;
    const eventSessionId = p.sessionId as string | undefined;

    // Adopt incoming session if we don't have one yet
    if (!this._activeSessionId && eventSessionId) {
      this._activeSessionId = eventSessionId;
      void this._loadMessages();
      this._startPolling();
    }

    switch (event.type) {
      case "message.part.delta": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const delta = p.delta as string | undefined;
        const partType = (p.partType as string | undefined) ?? "text";
        if (!delta) break;
        // Only handle text deltas — skip reasoning
        if (partType === "text") {
          this._streamingText += delta;
          if (this._status !== "streaming") this._status = "streaming";
        } else if (partType === "reasoning") {
          if (this._status !== "thinking") this._status = "thinking";
        }
        this._autoScroll();
        break;
      }

      case "message.created": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        if (p.role === "assistant") {
          this._streamingText = "";
          if (this._status !== "sending") this._status = "sending";
        } else if (p.role === "user") {
          void this._reloadLastMessages();
        }
        break;
      }

      case "message.updated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        void this._reloadLastMessages();
        this._streamingText = "";
        break;
      }

      case "tool.call.started": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._status = "tool";
        break;
      }

      case "tool.call.ended": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        break;
      }

      case "session.status": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        const status = p.status as string;
        if (
          status === "busy" &&
          this._status !== "streaming" &&
          this._status !== "thinking" &&
          this._status !== "tool"
        ) {
          this._status = "sending";
        } else if (status === "idle" && this._status !== "sending") {
          this._streamingText = "";
          this._status = "idle";
          void this._reloadLastMessages();
        }
        break;
      }

      case "session.ended": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        this._streamingText = "";
        this._status = "idle";
        break;
      }

      default:
        break;
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  private async _sendMessage(): Promise<void> {
    const text = this._inputText.trim();
    if (!text || this._status !== "idle") return;

    this._inputText = "";
    this._status = "sending";
    this._error = "";

    try {
      const result = await postRuntimeChat(this.slug, {
        message: text,
        ...(this._activeSessionId ? { sessionId: this._activeSessionId } : {}),
      });

      if (!this._activeSessionId && result.sessionId) {
        this._activeSessionId = result.sessionId;
        this._startPolling();
      }

      await this._reloadLastMessages();
      if (this._status === "sending") this._status = "idle";
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to send message";
    }
  }

  // ── Scroll ────────────────────────────────────────────────────────────────

  /** Scroll to bottom. If smooth=false, jump immediately. */
  private _scrollToBottom(smooth = true): void {
    const el = this._messagesEl;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  /** Auto-scroll only if already near bottom. */
  private _autoScroll(): void {
    const el = this._messagesEl;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this._sendMessage();
    }
  }

  private _onInput(e: InputEvent): void {
    const textarea = e.target as HTMLTextAreaElement;
    this._inputText = textarea.value;
    // Auto-grow
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 60)}px`;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  private _statusLabel(): string {
    switch (this._status) {
      case "idle":
        return msg("idle", { id: "dashboard-pilot-status-idle" });
      case "loading":
        return msg("loading", { id: "dashboard-pilot-status-loading" });
      case "sending":
        return msg("sending", { id: "dashboard-pilot-status-sending" });
      case "thinking":
        return msg("thinking", { id: "dashboard-pilot-status-thinking" });
      case "tool":
        return msg("using tool", { id: "dashboard-pilot-status-tool" });
      case "streaming":
        return msg("responding", { id: "dashboard-pilot-status-streaming" });
      case "error":
        return msg("error", { id: "dashboard-pilot-status-error" });
    }
  }

  /** Extract text-only content from a message's parts. */
  private _extractText(m: PilotMessage): string {
    return m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.content ?? "")
      .join("");
  }

  /** Format timestamp as HH:MM. */
  private _formatTime(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    const isBusy =
      this._status === "sending" ||
      this._status === "streaming" ||
      this._status === "thinking" ||
      this._status === "tool";
    const sendDisabled = !this._inputText.trim() || isBusy;
    const dotStatus =
      this._status === "error" || this._status === "loading" ? this._status : this._status;

    return html`
      <div class="pilot-header">
        <span class="pilot-label" @click=${this._navigateToPilot}
          >${msg("Pilot", { id: "dashboard-pilot-title" })} →</span
        >
        <div class="status-indicator">
          <span class="status-dot" data-status=${dotStatus}></span>
          <span class="status-label">${this._statusLabel()}</span>
        </div>
      </div>

      <div class="messages">
        ${this._messages.length === 0 && !this._streamingText
          ? html`<div class="empty-msg">
              ${this._status === "loading"
                ? msg("Loading…", { id: "dashboard-pilot-loading" })
                : msg("No messages yet", { id: "dashboard-pilot-empty" })}
            </div>`
          : nothing}
        ${this._messages.map((m) => this._renderMessage(m))}
        ${this._streamingText
          ? html`<div class="msg-group">
              <div class="msg-bubble msg-agent">${this._streamingText}</div>
            </div>`
          : nothing}
      </div>

      ${this._error
        ? html`<div
            style="padding: 0 var(--space-3); font-size: 12px; color: var(--state-error, #ef4444);"
          >
            ${this._error}
          </div>`
        : nothing}

      <div class="input-bar">
        <textarea
          rows="1"
          .value=${this._inputText}
          ?disabled=${isBusy}
          placeholder=${msg("Message…", { id: "dashboard-pilot-placeholder" })}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        ></textarea>
        <button class="btn-send" ?disabled=${sendDisabled} @click=${() => void this._sendMessage()}>
          ↑
        </button>
      </div>
    `;
  }

  private _renderMessage(m: PilotMessage) {
    const text = this._extractText(m);
    if (!text) return nothing;
    const isUser = m.role === "user";
    const bubbleClass = isUser ? "msg-user" : "msg-agent";
    const senderName = isUser ? "you" : (m.agentId ?? "pilot");
    return html`
      <div class="msg-group">
        <div class="msg-meta" style=${isUser ? "text-align:right" : ""}>
          ${this._formatTime(m.createdAt)} ${senderName}
        </div>
        <div class="msg-bubble ${bubbleClass}">${text}</div>
      </div>
    `;
  }

  private _navigateToPilot(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "pilot", slug: this.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-dashboard-pilot": DashboardPilot;
  }
}
