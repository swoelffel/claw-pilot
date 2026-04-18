// ui/src/components/flow-sessions.ts
// Flow Sessions — master/detail viewer for sessions linked to a flow definition.
// Reuses existing session message APIs and SSE streaming.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchFlowSessions,
  getFlow,
  fetchSessionMessages,
  fetchSessionContext,
  getRuntimeChatStreamUrl,
} from "../api.js";
import type { FlowSession, PilotMessage, PilotPart, SessionContext } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 30;
const MSG_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 86_400_000) {
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtCost(usd: number | undefined): string {
  if (usd == null || usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number | undefined): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function parseToolMetadata(meta: string | undefined): {
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
} {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as { toolName?: string; toolCallId?: string; args?: unknown };
  } catch {
    return {};
  }
}

function stringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

/** Extract a short label from the session label (e.g. "flow:maint:step:scan" → "scan"). */
function shortLabel(label: string | null): string {
  if (!label) return "session";
  const parts = label.split(":");
  return parts[parts.length - 1] ?? label;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-flow-sessions")
export class FlowSessions extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1400px;
        margin: 0 auto;
      }

      /* ── Header ─────────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
      }

      .btn-back {
        background: transparent;
        border: 1px solid var(--bg-border);
        color: var(--text-secondary);
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 13px;
      }
      .btn-back:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }

      /* ── Layout ─────────────────────────────────────────────────── */

      .layout {
        display: grid;
        grid-template-columns: 340px 1fr;
        gap: var(--space-4);
        min-height: 600px;
      }

      @media (max-width: 800px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      /* ── Session list (left panel) ──────────────────────────────── */

      .session-list {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        overflow-y: auto;
        max-height: 80vh;
      }

      .session-item {
        padding: var(--space-3) var(--space-4);
        cursor: pointer;
        border-bottom: 1px solid var(--bg-border);
        transition: background 0.1s;
      }
      .session-item:hover {
        background: var(--bg-hover);
      }
      .session-item.selected {
        background: var(--accent-subtle, rgba(79, 110, 247, 0.08));
        border-left: 3px solid var(--accent);
      }

      .session-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }

      .session-meta {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
        display: flex;
        gap: var(--space-2);
        align-items: center;
        flex-wrap: wrap;
      }

      .badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        font-weight: 600;
      }
      .badge-active {
        background: rgba(16, 185, 129, 0.15);
        color: var(--state-running);
      }
      .badge-archived {
        background: rgba(239, 68, 68, 0.15);
        color: var(--state-error);
      }

      .active-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--state-running);
        animation: pulse 1.2s infinite;
        flex-shrink: 0;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
      }

      .load-sentinel {
        padding: var(--space-3);
        text-align: center;
        color: var(--text-muted);
        font-size: 12px;
      }

      /* ── Conversation panel (right) ─────────────────────────────── */

      .conversation {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        max-height: 80vh;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-surface);
        flex-shrink: 0;
      }

      .panel-header-info {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .panel-header-info strong {
        color: var(--text-primary);
      }

      .toggle-raw {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 12px;
        color: var(--text-muted);
        cursor: pointer;
      }
      .toggle-raw input {
        accent-color: var(--accent);
      }

      .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .panel-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 14px;
      }

      .panel-footer {
        display: flex;
        gap: var(--space-4);
        padding: var(--space-2) var(--space-4);
        border-top: 1px solid var(--bg-border);
        background: var(--bg-surface);
        font-size: 12px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      /* ── System prompt ──────────────────────────────────────────── */

      .system-prompt {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        margin-bottom: var(--space-3);
      }

      .system-prompt-header {
        padding: var(--space-2) var(--space-3);
        background: var(--bg-surface);
        cursor: pointer;
        font-size: 12px;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .system-prompt-header:hover {
        color: var(--text-secondary);
      }

      .system-prompt-body {
        padding: var(--space-3);
        font-family: var(--font-mono);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-secondary);
        max-height: 400px;
        overflow-y: auto;
        border-top: 1px solid var(--bg-border);
      }

      /* ── Messages ───────────────────────────────────────────────── */

      .msg {
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        font-size: 13px;
        line-height: 1.5;
      }

      .msg-user {
        background: var(--bg-surface);
      }

      .msg-assistant {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
      }

      .msg-role {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: var(--space-1);
      }
      .msg-role-user {
        color: var(--text-muted);
      }
      .msg-role-assistant {
        color: var(--accent);
      }

      .msg-text {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-primary);
      }

      .msg-compaction {
        border: 1px dashed var(--bg-border);
        background: transparent;
        font-style: italic;
        color: var(--text-muted);
      }

      /* ── Tool parts ─────────────────────────────────────────────── */

      .tool-part {
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-family: var(--font-mono);
      }

      .tool-call {
        background: rgba(79, 110, 247, 0.06);
        border: 1px solid rgba(79, 110, 247, 0.2);
        cursor: pointer;
      }
      .tool-call:hover {
        background: rgba(79, 110, 247, 0.1);
      }

      .tool-result {
        background: rgba(16, 185, 129, 0.06);
        border: 1px solid rgba(16, 185, 129, 0.2);
      }

      .tool-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
      }

      .tool-detail {
        margin-top: var(--space-2);
        padding-top: var(--space-2);
        border-top: 1px solid var(--bg-border);
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-muted);
        max-height: 300px;
        overflow-y: auto;
      }

      .reasoning-part {
        font-style: italic;
        color: var(--text-muted);
        padding: var(--space-2) var(--space-3);
        border-left: 2px solid var(--bg-border);
      }

      /* ── States ─────────────────────────────────────────────────── */

      .spinner {
        text-align: center;
        padding: var(--space-6);
        color: var(--text-muted);
      }

      .error {
        text-align: center;
        padding: var(--space-6);
        color: var(--state-error);
      }

      .empty {
        text-align: center;
        padding: var(--space-6);
        color: var(--text-muted);
      }
    `,
  ];

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  @property({ type: String }) slug = "";
  @property({ type: Number }) flowId = 0;

  @state() private _flowName = "";
  @state() private _sessions: FlowSession[] = [];
  @state() private _selectedSession: FlowSession | null = null;
  @state() private _messages: PilotMessage[] = [];
  @state() private _context: SessionContext | null = null;
  @state() private _rawMode = false;
  @state() private _systemPromptOpen = false;
  @state() private _expandedTools = new Set<string>();
  @state() private _hasMoreSessions = false;
  @state() private _hasMoreMessages = false;
  @state() private _loading = false;
  @state() private _loadingMessages = false;
  @state() private _error = "";

  private _sessionObserver: IntersectionObserver | null = null;
  private _sseSource: EventSource | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadFlowName();
    void this._loadSessions();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._sessionObserver?.disconnect();
    this._disconnectSSE();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private async _loadFlowName(): Promise<void> {
    if (!this.slug || !this.flowId) return;
    try {
      const { flow } = await getFlow(this.slug, this.flowId);
      this._flowName = flow.name;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _loadSessions(append = false): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._error = "";

    try {
      const lastSession = append ? this._sessions[this._sessions.length - 1] : undefined;

      const { sessions, hasMore } = await fetchFlowSessions(this.slug, this.flowId, {
        limit: PAGE_SIZE,
        ...(lastSession ? { before: lastSession.created_at } : {}),
      });

      if (append) {
        this._sessions = [...this._sessions, ...sessions];
      } else {
        this._sessions = sessions;
      }
      this._hasMoreSessions = hasMore;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _selectSession(session: FlowSession): Promise<void> {
    this._selectedSession = session;
    this._messages = [];
    this._context = null;
    this._systemPromptOpen = false;
    this._expandedTools = new Set();
    this._loadingMessages = true;

    // Disconnect previous SSE before loading new session
    this._disconnectSSE();

    try {
      const [messagesResult, context] = await Promise.all([
        fetchSessionMessages(this.slug, session.id, { limit: MSG_PAGE_SIZE }),
        fetchSessionContext(this.slug, session.id),
      ]);
      this._messages = messagesResult.messages;
      this._hasMoreMessages = messagesResult.hasMore;
      this._context = context;

      // Connect SSE for active sessions
      if (session.state === "active") {
        this._connectSSE(session.id);
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loadingMessages = false;
    }
  }

  private async _loadMoreMessages(): Promise<void> {
    if (this._loadingMessages || !this._selectedSession || !this._hasMoreMessages) return;
    const firstMsg = this._messages[0];
    if (!firstMsg) return;

    this._loadingMessages = true;
    try {
      const { messages, hasMore } = await fetchSessionMessages(
        this.slug,
        this._selectedSession.id,
        { limit: MSG_PAGE_SIZE, before: firstMsg.id },
      );
      this._messages = [...messages, ...this._messages];
      this._hasMoreMessages = hasMore;
    } catch {
      // User can retry by scrolling
    } finally {
      this._loadingMessages = false;
    }
  }

  // ---------------------------------------------------------------------------
  // SSE
  // ---------------------------------------------------------------------------

  private _connectSSE(sessionId: string): void {
    this._disconnectSSE();
    const url = getRuntimeChatStreamUrl(this.slug, sessionId);
    this._sseSource = new EventSource(url, { withCredentials: true });
    this._sseSource.onmessage = () => {
      void this._refetchMessages();
    };
    this._sseSource.onerror = () => {
      // SSE reconnects automatically; no action needed
    };
  }

  private _disconnectSSE(): void {
    if (this._sseSource) {
      this._sseSource.close();
      this._sseSource = null;
    }
  }

  private async _refetchMessages(): Promise<void> {
    if (!this._selectedSession) return;
    try {
      const { messages, hasMore } = await fetchSessionMessages(
        this.slug,
        this._selectedSession.id,
        { limit: MSG_PAGE_SIZE },
      );
      this._messages = messages;
      this._hasMoreMessages = hasMore;
    } catch {
      // Silent — SSE will retry
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll sentinel
  // ---------------------------------------------------------------------------

  override updated(): void {
    this._setupSessionSentinel();
  }

  private _setupSessionSentinel(): void {
    this._sessionObserver?.disconnect();
    const sentinel = this.renderRoot.querySelector(".session-sentinel");
    if (!sentinel) return;

    this._sessionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this._hasMoreSessions && !this._loading) {
          void this._loadSessions(true);
        }
      },
      { root: this.renderRoot.querySelector(".session-list"), threshold: 0.1 },
    );
    this._sessionObserver.observe(sentinel);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      <div class="header">
        <button class="btn-back" @click=${this._goBack}>
          ${msg("\u2190 Back", { id: "flow-sessions-back" })}
        </button>
        <span class="title">
          ${msg("Flow Sessions", { id: "flow-sessions-title" })}
          ${this._flowName ? html` — ${this._flowName}` : nothing}
        </span>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

      <div class="layout">${this._renderSessionList()} ${this._renderConversation()}</div>
    `;
  }

  // --- Session list (left panel) ---

  private _renderSessionList() {
    if (this._loading && this._sessions.length === 0) {
      return html`<div class="session-list">
        <div class="spinner">${msg("Loading...", { id: "flow-sessions-loading" })}</div>
      </div>`;
    }

    if (this._sessions.length === 0) {
      return html`<div class="session-list">
        <div class="empty">
          ${msg("No sessions found for this flow", { id: "flow-sessions-empty" })}
        </div>
      </div>`;
    }

    return html`
      <div class="session-list">
        ${this._sessions.map((s) => this._renderSessionItem(s))}
        ${this._hasMoreSessions
          ? html`<div class="session-sentinel load-sentinel">
              ${this._loading ? msg("Loading...", { id: "flow-sessions-loading" }) : ""}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderSessionItem(s: FlowSession) {
    const selected = this._selectedSession?.id === s.id;
    const isActive = s.state === "active";

    return html`
      <div
        class="session-item ${selected ? "selected" : ""}"
        @click=${() => void this._selectSession(s)}
      >
        <div class="session-label">
          ${isActive ? html`<span class="active-dot"></span>` : nothing}
          <span>${shortLabel(s.label)}</span>
          <span style="font-weight:400;color:var(--text-muted);font-size:12px">
            ${s.agent_id}
          </span>
        </div>
        <div class="session-meta">
          <span>${fmtDate(s.created_at)}</span>
          <span>·</span>
          <span>${s.prompt_loops} ${msg("loops", { id: "flow-sessions-loops" })}</span>
          <span>·</span>
          <span>${fmtTokens(s.total_tokens)} tok</span>
          <span>·</span>
          <span>${fmtCost(s.total_cost_usd)}</span>
          ${isActive
            ? html`<span class="badge badge-active"
                >${msg("active", { id: "flow-sessions-active" })}</span
              >`
            : html`<span class="badge badge-archived"
                >${msg("archived", { id: "flow-sessions-archived" })}</span
              >`}
        </div>
      </div>
    `;
  }

  // --- Conversation panel (right) ---

  private _renderConversation() {
    if (!this._selectedSession) {
      return html`
        <div class="conversation">
          <div class="panel-empty">
            ${msg("Select a session to view", { id: "flow-sessions-select" })}
          </div>
        </div>
      `;
    }

    if (this._loadingMessages && this._messages.length === 0) {
      return html`
        <div class="conversation">
          <div class="panel-empty">${msg("Loading...", { id: "flow-sessions-loading" })}</div>
        </div>
      `;
    }

    const ctx = this._context;
    const totalTokensIn = this._messages.reduce((sum, m) => sum + (m.tokensIn ?? 0), 0);
    const totalTokensOut = this._messages.reduce((sum, m) => sum + (m.tokensOut ?? 0), 0);
    const totalCost = this._messages.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
    const model = ctx?.agent.model ?? this._messages.find((m) => m.model)?.model ?? "";

    return html`
      <div class="conversation">
        <div class="panel-header">
          <div class="panel-header-info">
            <strong>${this._selectedSession.agent_id}</strong>
            · ${fmtDate(this._selectedSession.created_at)} ${model ? html` · ${model}` : nothing}
            ${this._selectedSession.state === "active"
              ? html` · <span style="color:var(--state-running)">live</span>`
              : nothing}
          </div>
          <label class="toggle-raw">
            <input
              type="checkbox"
              .checked=${this._rawMode}
              @change=${(e: Event) => {
                this._rawMode = (e.target as HTMLInputElement).checked;
              }}
            />
            ${msg("Raw LLM", { id: "flow-sessions-raw-mode" })}
          </label>
        </div>

        <div class="panel-body">
          ${this._hasMoreMessages
            ? html`<button
                class="btn-back"
                style="align-self:center"
                @click=${() => void this._loadMoreMessages()}
              >
                ${this._loadingMessages
                  ? msg("Loading...", { id: "flow-sessions-loading" })
                  : msg("Load earlier messages", { id: "flow-sessions-load-earlier" })}
              </button>`
            : nothing}
          ${this._renderSystemPrompt()} ${this._messages.map((m) => this._renderMessage(m))}
        </div>

        <div class="panel-footer">
          <span>Tokens: ${fmtTokens(totalTokensIn)} in / ${fmtTokens(totalTokensOut)} out</span>
          <span>${msg("Cost", { id: "flow-sessions-cost" })}: ${fmtCost(totalCost)}</span>
          ${model ? html`<span>${model}</span>` : nothing}
        </div>
      </div>
    `;
  }

  // --- System prompt ---

  private _renderSystemPrompt() {
    const prompt = this._context?.systemPrompt;
    if (!prompt) return nothing;

    const sizeKb = (new TextEncoder().encode(prompt).length / 1024).toFixed(1);

    if (this._rawMode) {
      return html`
        <div class="system-prompt">
          <div class="system-prompt-header">
            ${msg("System prompt", { id: "flow-sessions-system-prompt" })} (${sizeKb} KB)
          </div>
          <div class="system-prompt-body">${prompt}</div>
        </div>
      `;
    }

    return html`
      <div class="system-prompt">
        <div
          class="system-prompt-header"
          @click=${() => {
            this._systemPromptOpen = !this._systemPromptOpen;
          }}
        >
          <span>${this._systemPromptOpen ? "\u25bc" : "\u25b6"}</span>
          ${msg("System prompt", { id: "flow-sessions-system-prompt" })} (${sizeKb} KB)
        </div>
        ${this._systemPromptOpen ? html`<div class="system-prompt-body">${prompt}</div>` : nothing}
      </div>
    `;
  }

  // --- Messages ---

  private _renderMessage(m: PilotMessage) {
    if (m.isCompaction) {
      return html`
        <div class="msg msg-compaction">
          <div class="msg-role msg-role-assistant">compaction</div>
          ${m.parts.map((p) => html`<div class="msg-text">${p.content ?? ""}</div>`)}
        </div>
      `;
    }

    const isUser = m.role === "user";
    return html`
      <div class="msg ${isUser ? "msg-user" : "msg-assistant"}">
        <div class="msg-role ${isUser ? "msg-role-user" : "msg-role-assistant"}">
          ${isUser ? "\ud83d\udc64 user" : "\ud83e\udd16 assistant"}
        </div>
        ${m.parts.map((p) => this._renderPart(p))}
      </div>
    `;
  }

  private _renderPart(p: PilotPart) {
    switch (p.type) {
      case "text":
        return html`<div class="msg-text">${p.content ?? ""}</div>`;

      case "tool_call":
        return this._renderToolCall(p);

      case "tool_result":
        return this._renderToolResult(p);

      case "reasoning":
        return html`<div class="reasoning-part">${p.content ?? ""}</div>`;

      case "compaction":
        return html`<div class="msg-text" style="font-style:italic">${p.content ?? ""}</div>`;

      case "suggestion":
        return html`<div class="msg-text" style="color:var(--text-muted)">${p.content ?? ""}</div>`;

      default:
        return this._rawMode
          ? html`<div class="msg-text">[${p.type}] ${p.content ?? ""}</div>`
          : nothing;
    }
  }

  private _renderToolCall(p: PilotPart) {
    const meta = parseToolMetadata(p.metadata);
    const expanded = this._expandedTools.has(p.id);

    if (this._rawMode) {
      return html`
        <div class="tool-part tool-call">
          <div class="tool-header">🔧 tool_call: ${meta.toolName ?? "unknown"}</div>
          <div class="tool-detail">${stringify({ ...meta, content: p.content })}</div>
        </div>
      `;
    }

    return html`
      <div
        class="tool-part tool-call"
        @click=${() => {
          const next = new Set(this._expandedTools);
          if (expanded) next.delete(p.id);
          else next.add(p.id);
          this._expandedTools = next;
        }}
      >
        <div class="tool-header">
          <span>${expanded ? "\u25bc" : "\u25b6"}</span>
          <span>🔧 ${meta.toolName ?? "unknown"}</span>
          <span style="color:var(--text-muted)">→ ${p.state ?? "completed"}</span>
        </div>
        ${expanded
          ? html`<div class="tool-detail">${stringify(meta.args) || p.content || ""}</div>`
          : nothing}
      </div>
    `;
  }

  private _renderToolResult(p: PilotPart) {
    if (this._rawMode) {
      return html`
        <div class="tool-part tool-result">
          <div class="tool-header">🔧 tool_result</div>
          <div class="tool-detail">${p.content ?? ""}</div>
        </div>
      `;
    }

    const meta = parseToolMetadata(p.metadata);
    const toolCallId = meta.toolCallId;
    if (toolCallId && this._expandedTools.has(toolCallId)) {
      return nothing;
    }

    const expanded = this._expandedTools.has(p.id);
    return html`
      <div
        class="tool-part tool-result"
        @click=${() => {
          const next = new Set(this._expandedTools);
          if (expanded) next.delete(p.id);
          else next.add(p.id);
          this._expandedTools = next;
        }}
      >
        <div class="tool-header">
          <span>${expanded ? "\u25bc" : "\u25b6"}</span>
          <span>🔧 result</span>
          <span style="color:var(--text-muted)">${p.state ?? "completed"}</span>
        </div>
        ${expanded ? html`<div class="tool-detail">${p.content ?? ""}</div>` : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "flows", slug: this.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-flow-sessions": FlowSessions;
  }
}
