// ui/src/components/runtime-chat.ts
// Composant Lit pour le chat temps réel avec un agent claw-runtime via SSE
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { RuntimeSession } from "../types.js";
import { fetchRuntimeSessions, postRuntimeChat, getRuntimeChatStreamUrl } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  id?: string;
}

/**
 * Formate un coût en USD avec le bon nombre de décimales :
 * - >= $0.01 → 2 décimales ($0.03)
 * - >= $0.001 → 3 décimales ($0.003)
 * - < $0.001 → 4 décimales ($0.0003)
 */
function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

/**
 * Formate une date ISO en temps relatif lisible.
 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

@localized()
@customElement("cp-runtime-chat")
export class RuntimeChat extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .runtime-chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0;
        background: var(--bg-surface);
      }

      /* ── Header session selector ─────────────────────────── */

      .chat-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--bg-border);
        gap: 8px;
        flex-shrink: 0;
        position: relative;
      }

      /* ── Session dropdown custom ─────────────────────────── */

      .session-selector {
        flex: 1;
        position: relative;
        min-width: 0;
      }

      .session-trigger {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        padding: 6px 10px;
        cursor: pointer;
        outline: none;
        text-align: left;
        transition: border-color 0.15s;
        font-family: var(--font-ui);
        overflow: hidden;
      }

      .session-trigger:focus,
      .session-trigger:hover {
        border-color: var(--accent);
      }

      .session-trigger.open {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      .session-trigger-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .session-trigger-dot.active {
        background: var(--state-running);
        box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
      }

      .session-trigger-dot.archived {
        background: var(--text-muted);
      }

      .session-trigger-dot.new {
        background: var(--accent);
      }

      .session-trigger-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }

      .session-trigger-meta {
        font-size: 11px;
        color: var(--text-muted);
        flex-shrink: 0;
        white-space: nowrap;
      }

      .session-trigger-chevron {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
        transition: transform 0.15s;
      }

      .session-trigger.open .session-trigger-chevron {
        transform: rotate(180deg);
      }

      /* ── Dropdown panel ──────────────────────────────────── */

      .session-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 200;
        overflow: hidden;
        max-height: 320px;
        overflow-y: auto;
      }

      .session-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        font-family: var(--font-ui);
        transition: background 0.1s;
        border-bottom: 1px solid var(--bg-border);
      }

      .session-option:last-child {
        border-bottom: none;
      }

      .session-option:hover {
        background: var(--bg-hover);
      }

      .session-option.selected {
        background: var(--accent-subtle);
      }

      .session-option-info {
        flex: 1;
        min-width: 0;
      }

      .session-option-title {
        font-size: 13px;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-option-meta {
        font-size: 11px;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        flex-wrap: wrap;
      }

      .session-option-cost {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .session-group-label {
        padding: 6px 12px 4px;
        font-size: 10px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        background: var(--bg-hover);
        border-bottom: 1px solid var(--bg-border);
        cursor: default;
      }

      .session-group-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px 4px;
        font-size: 10px;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        background: var(--bg-hover);
        border-bottom: 1px solid var(--bg-border);
        cursor: pointer;
        border: none;
        width: 100%;
        text-align: left;
        font-family: var(--font-ui);
        transition: color 0.15s;
      }

      .session-group-toggle:hover {
        color: var(--text-secondary);
      }

      /* ── Stats bar ───────────────────────────────────────── */

      .stats-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-hover);
        flex-shrink: 0;
        flex-wrap: wrap;
      }

      .stats-text {
        flex: 1;
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stats-text strong {
        color: var(--text-secondary);
        font-weight: 600;
      }

      .stats-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .btn-stats-action {
        padding: 3px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
        font-family: var(--font-ui);
      }

      .btn-stats-action:hover:not(:disabled) {
        background: var(--bg-surface);
        color: var(--text-secondary);
      }

      .btn-stats-action:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* ── Messages ───────────────────────────────────────── */

      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .chat-messages-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 13px;
      }

      .message {
        padding: 10px 14px;
        border-radius: var(--radius-md);
        font-size: 13px;
        line-height: 1.5;
        max-width: 85%;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .message.user {
        background: var(--bg-hover);
        align-self: flex-end;
        color: var(--text-primary);
      }

      .message.assistant {
        background: transparent;
        border: 1px solid var(--bg-border);
        align-self: flex-start;
        color: var(--text-primary);
      }

      .message.streaming {
        opacity: 0.85;
      }

      .spinner-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 12px;
        align-self: flex-start;
      }

      .spinner-row .spinner {
        width: 16px;
        height: 16px;
        border-width: 2px;
      }

      /* ── Input ──────────────────────────────────────────── */

      .chat-input-row {
        display: flex;
        flex-direction: row;
        align-items: flex-end;
        padding: 12px;
        border-top: 1px solid var(--bg-border);
        gap: 8px;
        flex-shrink: 0;
      }

      .chat-input-row textarea {
        flex: 1;
        resize: none;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        padding: 8px 12px;
        outline: none;
        line-height: 1.5;
      }

      .chat-input-row textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      .chat-input-row textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .chat-input-row textarea::placeholder {
        color: var(--text-muted);
      }

      .chat-input-row .btn {
        align-self: flex-end;
      }

      /* ── Error banner ───────────────────────────────────── */

      .error-banner {
        margin: 0 12px 12px;
        flex-shrink: 0;
      }
    `,
  ];

  // ── Public properties ──────────────────────────────────────────────────────

  @property({ type: String }) slug = "";

  // ── Internal state ─────────────────────────────────────────────────────────

  @state() private _sessions: RuntimeSession[] = [];
  @state() private _sessionId: string | null = null;
  @state() private _messages: ChatMessage[] = [];
  @state() private _streamingText = "";
  @state() private _status: "idle" | "loading" | "sending" | "streaming" | "error" = "idle";
  @state() private _error = "";
  @state() private _inputText = "";
  @state() private _sessionsLoading = false;
  @state() private _dropdownOpen = false;
  @state() private _archivedExpanded = false;

  private _eventSource: EventSource | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadSessions();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
  }

  // ── Session management ─────────────────────────────────────────────────────

  private async _loadSessions(): Promise<void> {
    if (!this.slug) return;
    this._sessionsLoading = true;
    try {
      // Charger actives + archivées
      const [active, archived] = await Promise.all([
        fetchRuntimeSessions(this.slug),
        fetchRuntimeSessionsArchived(this.slug),
      ]);
      this._sessions = [...active, ...archived];
      // Auto-select first active session if none selected
      if (!this._sessionId && active.length > 0) {
        this._selectSession(active[0]!.id);
      }
    } catch {
      // Non-fatal — sessions list will be empty
    } finally {
      this._sessionsLoading = false;
    }
  }

  private _selectSession(id: string): void {
    if (this._sessionId === id) return;
    this._dropdownOpen = false;
    this._sessionId = id;
    this._messages = [];
    this._streamingText = "";
    this._error = "";
    this._status = "idle";
    this._closeStream();
    this._openStream(id);
  }

  private _createNewSession(): void {
    this._dropdownOpen = false;
    this._sessionId = null;
    this._messages = [];
    this._streamingText = "";
    this._error = "";
    this._status = "idle";
    this._closeStream();
  }

  // ── SSE stream ─────────────────────────────────────────────────────────────

  private _openStream(sessionId: string): void {
    this._closeStream();

    const url = getRuntimeChatStreamUrl(this.slug, sessionId);
    const es = new EventSource(url);
    this._eventSource = es;

    es.onmessage = (e: MessageEvent) => {
      let event: { type: string; payload: Record<string, unknown> };
      try {
        event = JSON.parse(e.data as string) as typeof event;
      } catch {
        return;
      }

      const payload = event.payload;

      switch (event.type) {
        case "message.part.delta": {
          const delta = payload.delta as string | undefined;
          if (delta) {
            this._streamingText += delta;
            this._status = "streaming";
          }
          break;
        }
        case "message.created": {
          if (payload.role === "assistant") {
            this._streamingText = "";
            this._status = "streaming";
          }
          break;
        }
        case "message.updated": {
          this._streamingText = "";
          this._status = "idle";
          break;
        }
        case "session.status": {
          const status = payload.status as string;
          if (status === "busy") {
            this._status = "streaming";
          } else if (status === "idle") {
            if (this._status === "streaming" && !this._streamingText) {
              this._status = "idle";
            }
          }
          break;
        }
        case "session.ended": {
          this._status = "idle";
          this._streamingText = "";
          break;
        }
        default:
          break;
      }
    };

    es.addEventListener("ping", () => {
      // Keep-alive ping — ignore
    });

    es.onerror = () => {
      this._status = "error";
      this._error = "Connection to runtime lost. Please refresh.";
      this._closeStream();
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────

  private async _sendMessage(): Promise<void> {
    const text = this._inputText.trim();
    if (!text || this._status !== "idle") return;

    this._messages = [...this._messages, { role: "user", text }];
    this._inputText = "";
    this._status = "sending";
    this._error = "";

    try {
      const result = await postRuntimeChat(this.slug, {
        message: text,
        ...(this._sessionId !== null ? { sessionId: this._sessionId } : {}),
      });

      if (!this._sessionId) {
        this._sessionId = result.sessionId;
        this._openStream(result.sessionId);
        void this._loadSessions();
      }

      if (result.text) {
        this._messages = [
          ...this._messages,
          { role: "assistant", text: result.text, id: result.messageId },
        ];
      }
      this._status = "idle";
    } catch (err) {
      this._status = "error";
      this._error = err instanceof Error ? err.message : "Failed to send message";
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this._sendMessage();
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  private get _currentSession(): RuntimeSession | undefined {
    return this._sessions.find((s) => s.id === this._sessionId);
  }

  private _renderSessionTrigger() {
    const current = this._currentSession;

    if (!current) {
      return html`
        <button
          class="session-trigger ${this._dropdownOpen ? "open" : ""}"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._dropdownOpen = !this._dropdownOpen;
          }}
        >
          <span class="session-trigger-dot new"></span>
          <span class="session-trigger-label">
            ${this._sessionsLoading
              ? msg("Loading…", { id: "chat-loading" })
              : msg("New session", { id: "chat-new-session" })}
          </span>
          <span class="session-trigger-chevron">▾</span>
        </button>
      `;
    }

    const cost = current.totalCostUsd ?? 0;
    const costStr = cost > 0 ? formatCost(cost) : "";

    return html`
      <button
        class="session-trigger ${this._dropdownOpen ? "open" : ""}"
        @click=${(e: Event) => {
          e.stopPropagation();
          this._dropdownOpen = !this._dropdownOpen;
        }}
      >
        <span class="session-trigger-dot ${current.state}"></span>
        <span class="session-trigger-label">
          ${current.title ?? current.id.slice(0, 12) + "…"}
        </span>
        ${costStr ? html`<span class="session-trigger-meta">${costStr}</span>` : nothing}
        <span class="session-trigger-chevron">▾</span>
      </button>
    `;
  }

  private _channelBadge(channel: string) {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      telegram: { label: "TG", bg: "rgba(0,136,204,0.15)", color: "#0088cc" },
      web: { label: "WEB", bg: "var(--accent-subtle)", color: "var(--accent)" },
      api: { label: "API", bg: "rgba(100,116,139,0.12)", color: "var(--text-muted)" },
      cli: { label: "CLI", bg: "rgba(100,116,139,0.12)", color: "var(--text-muted)" },
      internal: { label: "INT", bg: "transparent", color: "var(--text-muted)" },
    };
    const style = map[channel] ?? {
      label: channel.slice(0, 4).toUpperCase(),
      bg: "rgba(100,116,139,0.12)",
      color: "var(--text-muted)",
    };
    return html`<span
      style="font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;letter-spacing:0.04em;background:${style.bg};color:${style.color}"
      >${style.label}</span
    >`;
  }

  private _renderSessionOption(s: RuntimeSession, isSelected: boolean) {
    const cost = s.totalCostUsd ?? 0;
    const tokens = s.totalTokens ?? 0;
    const msgCount = s.messageCount ?? 0;

    return html`
      <button
        class="session-option ${isSelected ? "selected" : ""}"
        @click=${() => this._selectSession(s.id)}
      >
        <span class="session-trigger-dot ${s.state}"></span>
        <div class="session-option-info">
          <div class="session-option-title">${s.title ?? s.id.slice(0, 16) + "…"}</div>
          <div class="session-option-meta">
            <span>${s.agentId}</span>
            <span>·</span>
            ${this._channelBadge(s.channel)}
            ${msgCount > 0 ? html`<span>· ${msgCount} msg</span>` : nothing}
            ${tokens > 0 ? html`<span>· ${tokens.toLocaleString()} tok</span>` : nothing}
            <span>· ${relativeTime(s.updatedAt ?? s.createdAt)}</span>
          </div>
        </div>
        ${cost > 0 ? html`<span class="session-option-cost">${formatCost(cost)}</span>` : nothing}
      </button>
    `;
  }

  private _renderDropdown() {
    const active = this._sessions.filter((s) => s.state === "active");
    const archived = this._sessions.filter((s) => s.state === "archived");

    return html`
      <div class="session-dropdown" @click=${(e: Event) => e.stopPropagation()}>
        <!-- Option "New session" -->
        <button
          class="session-option ${!this._sessionId ? "selected" : ""}"
          @click=${this._createNewSession}
        >
          <span class="session-trigger-dot new"></span>
          <div class="session-option-info">
            <div class="session-option-title">
              + ${msg("New session", { id: "chat-new-session" })}
            </div>
          </div>
        </button>

        ${active.length > 0
          ? html`
              <div class="session-group-label">
                ${msg("Active", { id: "chat-sessions-active" })} (${active.length})
              </div>
              ${active.map((s) => this._renderSessionOption(s, s.id === this._sessionId))}
            `
          : nothing}
        ${archived.length > 0
          ? html`
              <button
                class="session-group-toggle"
                @click=${() => {
                  this._archivedExpanded = !this._archivedExpanded;
                }}
              >
                ${this._archivedExpanded ? "▴" : "▾"}
                ${msg("Archived", { id: "chat-sessions-archived" })} (${archived.length})
              </button>
              ${this._archivedExpanded
                ? archived.map((s) => this._renderSessionOption(s, s.id === this._sessionId))
                : nothing}
            `
          : nothing}
      </div>
    `;
  }

  private _renderStatsBar() {
    const session = this._currentSession;
    if (!session) return nothing;

    const cost = session.totalCostUsd ?? 0;
    const tokens = session.totalTokens ?? 0;
    const msgCount = session.messageCount ?? 0;

    return html`
      <div class="stats-bar">
        <span class="stats-text">
          <strong>${session.agentId}</strong>
          · ${session.channel}
          ${msgCount > 0
            ? html` · ${msgCount} ${msg("messages", { id: "chat-stat-messages" })}`
            : nothing}
          ${tokens > 0
            ? html` · ${tokens.toLocaleString()} ${msg("tokens", { id: "chat-stat-tokens" })}`
            : nothing}
          ${cost > 0 ? html` · ${formatCost(cost)}` : nothing}
        </span>
        <div class="stats-actions">
          <button class="btn-stats-action" disabled title="Fork (coming soon)">
            ⑂ ${msg("Fork", { id: "chat-btn-fork" })}
          </button>
          <button class="btn-stats-action" disabled title="Archive (coming soon)">
            ⊡ ${msg("Archive", { id: "chat-btn-archive" })}
          </button>
        </div>
      </div>
    `;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  override render() {
    const isDisabled = this._status !== "idle";

    return html`
      <div
        class="runtime-chat"
        @click=${() => {
          if (this._dropdownOpen) this._dropdownOpen = false;
        }}
      >
        <!-- Header: session selector + new session button -->
        <div class="chat-header">
          <div class="session-selector">
            ${this._renderSessionTrigger()} ${this._dropdownOpen ? this._renderDropdown() : nothing}
          </div>
          <button
            class="btn btn-ghost"
            style="font-size:12px;padding:5px 10px;flex-shrink:0"
            @click=${this._createNewSession}
          >
            + ${msg("New", { id: "chat-btn-new" })}
          </button>
        </div>

        <!-- Stats bar -->
        ${this._renderStatsBar()}

        <!-- Messages history -->
        <div class="chat-messages">
          ${this._messages.length === 0 && !this._streamingText && this._status === "idle"
            ? html`<div class="chat-messages-empty">
                ${msg("Start a conversation with the agent", { id: "chat-empty" })}
              </div>`
            : nothing}
          ${this._messages.map((m) => html` <div class="message ${m.role}">${m.text}</div> `)}
          ${this._streamingText
            ? html`<div class="message assistant streaming">${this._streamingText}▋</div>`
            : nothing}
          ${this._status === "sending" || (this._status === "streaming" && !this._streamingText)
            ? html`
                <div class="spinner-row">
                  <div class="spinner"></div>
                  <span>${msg("Agent is thinking…", { id: "chat-thinking" })}</span>
                </div>
              `
            : nothing}
        </div>

        <!-- Input row -->
        <div class="chat-input-row">
          <textarea
            .value=${this._inputText}
            @input=${(e: Event) => {
              this._inputText = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${this._handleKeydown}
            placeholder=${msg("Message… (Enter to send, Shift+Enter for newline)", {
              id: "chat-placeholder",
            })}
            ?disabled=${isDisabled}
            rows="2"
          ></textarea>
          <button
            class="btn btn-primary"
            @click=${() => void this._sendMessage()}
            ?disabled=${!this._inputText.trim() || isDisabled}
          >
            ${msg("Send", { id: "chat-btn-send" })}
          </button>
        </div>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
      </div>
    `;
  }
}

/**
 * Charge les sessions archivées pour un slug donné.
 * Fonction locale — pas exportée dans api.ts pour éviter la duplication.
 */
async function fetchRuntimeSessionsArchived(slug: string): Promise<RuntimeSession[]> {
  const token = getToken();
  const res = await fetch(`/api/instances/${slug}/runtime/sessions?state=archived&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { sessions: RuntimeSession[] };
  return data.sessions ?? [];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-runtime-chat": RuntimeChat;
  }
}
