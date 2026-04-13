// ui/src/components/home-chat.ts
//
// cp-home-chat — Lean conversational UI dedicated to the cp-system instance.
// Renders only the chat experience with system-pilot:
//   - Compact header (title + status + cumulative tokens/cost)
//   - Messages timeline (chat + delegations + suggestions, NO raw tool calls)
//   - Input bar
//
// This is the simplified counterpart of cp-runtime-pilot, used by cp-home-screen
// for the /home route. The full pilot remains available at /instances/cp-system/pilot
// for advanced inspection (context panel, filters, agent tabs, event log).

import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, PilotBusEvent, TimelineFilters } from "../types.js";
import {
  postRuntimeChat,
  abortSession,
  getRuntimeChatStreamUrl,
  fetchSessionMessages,
  fetchRuntimeSessions,
} from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";
import "./pilot/pilot-header.js";
import "./pilot/pilot-messages.js";
import "./pilot/pilot-input.js";

type HomeChatStatus = "idle" | "loading" | "sending" | "streaming" | "error";

/** Polling fallback when SSE drops or misses an event */
const POLL_INTERVAL_MS = 10_000;

/** SSE reconnect backoff */
const SSE_RECONNECT_INITIAL_MS = 1_000;
const SSE_RECONNECT_MULTIPLIER = 2;
const SSE_RECONNECT_MAX_MS = 30_000;

/**
 * Hard-coded timeline filter for Home: keep chat + delegations + subtasks +
 * suggestions visible, hide raw tool calls and reasoning blocks. Matches the
 * "conversational" intent of the Home screen — the user wants to see the
 * conversation and the team working, not low-level cp_* tool invocations.
 */
const HOME_FILTERS: TimelineFilters = {
  chat: true,
  a2a: true,
  tools: false,
  thinking: false,
  subtasks: true,
  suggestions: true,
};

@localized()
@customElement("cp-home-chat")
export class HomeChat extends LitElement {
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

      .chat-body {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
    `,
  ];

  // ── Public properties ─────────────────────────────────────────────────────

  /** cp-system instance slug (always "cp-system" but kept as prop for reuse). */
  @property({ type: String }) slug = "";

  // ── Internal state ────────────────────────────────────────────────────────

  @state() private _status: HomeChatStatus = "idle";
  @state() private _error = "";
  @state() private _messages: PilotMessage[] = [];
  @state() private _hasMore = false;
  @state() private _streamingText = "";
  @state() private _streamingAgentId = "";
  @state() private _tokensIn = 0;
  @state() private _tokensOut = 0;
  @state() private _costUsd = 0;

  private _eventSource: EventSource | null = null;
  private _activeSessionId = "";
  private _reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = SSE_RECONNECT_INITIAL_MS;
  private _sseConnected = false;
  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  private _onVisibilityChange: (() => void) | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    this._onVisibilityChange = () => {
      if (document.visibilityState === "visible" && this._activeSessionId) {
        void this._refreshMessages();
        if (!this._sseConnected) this._scheduleReconnect(0);
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    if (this.slug) void this._init();
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
    if (changed.has("slug") && this.slug) void this._init();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    this._teardown();
    this._status = "loading";
    this._error = "";
    this._messages = [];
    this._hasMore = false;
    this._streamingText = "";
    this._activeSessionId = "";
    this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;

    const sessionId = await this._detectPermanentSession();
    if (sessionId) {
      this._activeSessionId = sessionId;
      await this._loadMessages();
      this._openStream();
      this._startPolling();
    } else {
      this._status = "idle";
      // Open stream so we catch session.created when first message is sent
      this._openStream();
    }
  }

  /** Find the primary persistent session for this instance (system-pilot). */
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

  private async _loadMessages(before?: string): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      const { messages, hasMore } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 50,
        ...(before ? { before } : {}),
      });
      this._messages = before ? [...messages, ...this._messages] : messages;
      this._hasMore = hasMore;
      this._updateCumulativeStats();
      if (this._status === "loading") this._status = "idle";
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
      this._updateCumulativeStats();
    }
  }

  /** Recompute cumulative tokens/cost from the loaded messages. */
  private _updateCumulativeStats(): void {
    let tIn = 0;
    let tOut = 0;
    let cost = 0;
    for (const m of this._messages) {
      tIn += m.tokensIn ?? 0;
      tOut += m.tokensOut ?? 0;
      cost += m.costUsd ?? 0;
    }
    this._tokensIn = tIn;
    this._tokensOut = tOut;
    this._costUsd = cost;
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  private _openStream(): void {
    this._closeStream();
    if (!this.slug) return;
    const token = getToken();
    const baseUrl = getRuntimeChatStreamUrl(this.slug);
    const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    const es = new EventSource(url);
    this._eventSource = es;
    this._sseConnected = false;

    es.onopen = () => {
      this._sseConnected = true;
      this._reconnectDelay = SSE_RECONNECT_INITIAL_MS;
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
    });

    es.onerror = () => {
      this._sseConnected = false;
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

    // Adopt incoming session if we don't have one yet (e.g. first message via Telegram)
    if (!this._activeSessionId && eventSessionId) {
      this._activeSessionId = eventSessionId;
      void this._loadMessages();
      this._startPolling();
    }

    switch (event.type) {
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
        // Reload to pick up new parts (tool results, delegation traces)
        void this._reloadLastMessages();
        this._streamingText = "";
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
          // Ensure the final messages (assistant reply, tool results, etc.)
          // are rendered — message.updated/created may have been missed.
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

      case "suggestions.generated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        void this._refreshMessages();
        break;
      }

      default:
        // Ignore everything else (no event log, no context updates, no sub-agent merging)
        break;
    }
  }

  // ── Send / abort ──────────────────────────────────────────────────────────

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

    try {
      const result = await postRuntimeChat(this.slug, {
        message: text,
        ...(this._activeSessionId ? { sessionId: this._activeSessionId } : {}),
        ...(files !== undefined && files.length > 0 ? { files } : {}),
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

  private async _onAbortRequest(): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      await abortSession(this.slug, this._activeSessionId);
    } catch {
      // Loop may have already finished
    }
    this._status = "idle";
    this._streamingText = "";
    this._streamingAgentId = "";
  }

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

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    const isDisabled = this._status !== "idle";
    const isStreaming = this._status === "sending" || this._status === "streaming";
    const totalTokens = this._tokensIn + this._tokensOut;

    return html`
      <cp-pilot-header
        agentId="system-pilot"
        agentName="${msg("ClawPilot Assistant", { id: "home-chat-title" })}"
        model=""
        .status=${this._status}
        .messageCount=${this._messages.length}
        .totalTokens=${totalTokens}
        .totalCost=${this._costUsd}
        .panelOpen=${false}
      ></cp-pilot-header>

      <div
        class="chat-body"
        @suggestion-click=${this._onSuggestionClick}
        @question-answered=${this._onQuestionAnswered}
      >
        <cp-pilot-messages
          .messages=${this._messages}
          .filters=${HOME_FILTERS}
          .currentAgentId=${"system-pilot"}
          .streamingText=${this._streamingText}
          .streamingAgentId=${this._streamingAgentId}
          .status=${this._status}
          .hasMore=${this._hasMore}
          .subagentResults=${{}}
          .slug=${this.slug}
          @load-more=${this._loadMore}
        ></cp-pilot-messages>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

        <cp-pilot-input
          .disabled=${isDisabled}
          .streaming=${isStreaming}
          @send-message=${this._onSendMessage}
          @abort-request=${this._onAbortRequest}
        ></cp-pilot-input>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-home-chat": HomeChat;
  }
}
