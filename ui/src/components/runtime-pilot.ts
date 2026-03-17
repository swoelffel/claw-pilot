// ui/src/components/runtime-pilot.ts
// cp-runtime-pilot — Runtime Pilot orchestrator.
// Replaces cp-runtime-chat with a rich agent piloting interface:
// - Full message history with parts (tool calls, reasoning, subtasks, compaction)
// - Context panel (token gauge, tools, agent info, system prompt, event log)
// - All bus events forwarded via enriched SSE stream
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotMessage, SessionContext, PilotBusEvent } from "../types.js";
import {
  postRuntimeChat,
  getRuntimeChatStreamUrl,
  fetchSessionMessages,
  fetchSessionContext,
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
    `,
  ];

  // ── Public properties ─────────────────────────────────────────────────────

  @property({ type: String }) slug = "";
  /**
   * sessionId of the permanent session to pilot.
   * If empty, the component will use postRuntimeChat to create/resume the session.
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
  @state() private _subagentResults: Record<
    string,
    { text?: string; steps?: number; tokens?: { input: number; output: number }; model?: string }
  > = {};

  private _eventSource: EventSource | null = null;
  private _activeSessionId = "";

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.slug) {
      void this._init();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
  }

  override updated(changed: Map<string, unknown>): void {
    if ((changed.has("slug") || changed.has("sessionId")) && this.slug) {
      void this._init();
    }
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    this._status = "loading";
    this._error = "";
    this._messages = [];
    this._hasMore = false;
    this._streamingText = "";
    this._events = [];
    this._context = null;
    this._closeStream();

    // If we already have a sessionId, use it; otherwise we'll create one on first send.
    if (this.sessionId) {
      this._activeSessionId = this.sessionId;
      await Promise.all([this._loadMessages(), this._loadContext()]);
      this._openStream();
    } else {
      this._status = "idle";
    }
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

    es.onmessage = (e: MessageEvent) => {
      let event: PilotBusEvent;
      try {
        event = JSON.parse(e.data as string) as PilotBusEvent;
      } catch {
        return;
      }

      this._handleBusEvent(event);
    };

    es.addEventListener("ping", () => {
      // Keep-alive — ignore
    });

    es.onerror = () => {
      this._status = "error";
      this._error = msg("Connection to runtime lost. Please refresh.", {
        id: "pilot-connection-lost",
      });
      this._closeStream();
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  private _handleBusEvent(event: PilotBusEvent): void {
    const p = event.payload;
    const eventSessionId = p.sessionId as string | undefined;

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
        }
        break;
      }

      case "message.updated": {
        if (eventSessionId && eventSessionId !== this._activeSessionId) break;
        // Reload the last message from API to get its parts
        void this._reloadLastMessage(p.messageId as string | undefined);
        this._streamingText = "";
        this._status = "idle";
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

  private async _reloadLastMessage(messageId?: string): Promise<void> {
    if (!this._activeSessionId) return;
    try {
      // Reload the last few messages to pick up the completed message with parts
      const { messages } = await fetchSessionMessages(this.slug, this._activeSessionId, {
        limit: 5,
      });
      // Merge: replace/append messages we already have
      const existingIds = new Set(this._messages.map((m) => m.id));
      const newMsgs = messages.filter((m) => !existingIds.has(m.id));
      // Update existing messages (e.g. token counts filled in)
      const updatedMsgs = this._messages.map((m) => {
        const updated = messages.find((nm) => nm.id === m.id);
        return updated ?? m;
      });
      this._messages = [...updatedMsgs, ...newMsgs];
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

      // If this is the first message, we now have a sessionId — open SSE stream
      if (!this._activeSessionId && result.sessionId) {
        this._activeSessionId = result.sessionId;
        this._openStream();
        void this._loadContext();
      }

      // Reload messages to show the complete exchange
      await this._reloadLastMessage(result.messageId);

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

  // ── Render ────────────────────────────────────────────────────────────────

  override render() {
    const isDisabled = this._status !== "idle";
    const agentId = this._context?.agent.id ?? "";
    const model = this._context?.agent.model ?? "";

    return html`
      <cp-pilot-header
        .agentId=${agentId}
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
