// ui/src/components/session-logs.ts
// Session Logs — master/detail viewer with filters, infinite scroll, conversation/raw toggle.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchRuntimeSessionsPaginated,
  fetchSessionMessages,
  fetchSessionContext,
} from "../api.js";
import type { RuntimeSession, PilotMessage, PilotPart, SessionContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const MSG_PAGE_SIZE = 50;

type Period = "7d" | "30d" | "all";

function sinceFromPeriod(period: Period): string | undefined {
  if (period === "all") return undefined;
  const d = new Date();
  d.setDate(d.getDate() - (period === "30d" ? 30 : 7));
  return d.toISOString();
}

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
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function parseToolMetadata(meta: string | undefined): {
  toolName?: string;
  toolCallId?: string;
  args?: string;
} {
  if (!meta) return {};
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-session-logs")
export class SessionLogs extends LitElement {
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

      /* ── Filters ─────────────────────────────────────────────────── */

      .filters {
        display: flex;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
        align-items: center;
      }

      .filter-label {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .filter-select {
        background: var(--bg-surface);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-family: var(--font-ui);
      }

      .segmented {
        display: inline-flex;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }
      .segmented button {
        background: transparent;
        color: var(--text-secondary);
        border: none;
        padding: var(--space-1) var(--space-3);
        font-size: 13px;
        cursor: pointer;
        font-family: var(--font-ui);
      }
      .segmented button:not(:last-child) {
        border-right: 1px solid var(--bg-border);
      }
      .segmented button.active {
        background: var(--accent);
        color: #fff;
      }

      /* ── Layout ─────────────────────────────────────────────────── */

      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
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

      .session-agent {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .session-meta {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }

      .badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        font-weight: 600;
      }
      .badge-archived {
        background: rgba(239, 68, 68, 0.15);
        color: var(--state-error);
      }
      .badge-persistent {
        background: rgba(16, 185, 129, 0.15);
        color: var(--state-running);
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

  @property({ type: String }) slug!: string;

  @state() private _sessions: RuntimeSession[] = [];
  @state() private _selectedSession: RuntimeSession | null = null;
  @state() private _messages: PilotMessage[] = [];
  @state() private _context: SessionContext | null = null;
  @state() private _rawMode = false;
  @state() private _systemPromptOpen = false;
  @state() private _expandedTools = new Set<string>();

  // Filters
  @state() private _filterAgent = "";
  @state() private _filterPeriod: Period = "7d";
  @state() private _filterPersistent: "" | "0" | "1" = "";
  @state() private _filterState: "active" | "archived" | "" = "";

  // Loading states
  @state() private _loading = false;
  @state() private _loadingMessages = false;
  @state() private _hasMoreSessions = false;
  @state() private _hasMoreMessages = false;
  @state() private _error = "";

  // Known agents (extracted from loaded sessions)
  @state() private _agents: Array<{ id: string; name: string }> = [];

  private _sessionObserver?: IntersectionObserver;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadSessions();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._sessionObserver?.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private async _loadSessions(append = false): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._error = "";

    try {
      const since = sinceFromPeriod(this._filterPeriod);
      const lastSession = append ? this._sessions[this._sessions.length - 1] : undefined;

      const { sessions, hasMore } = await fetchRuntimeSessionsPaginated(this.slug, {
        limit: PAGE_SIZE,
        ...(this._filterAgent ? { agentId: this._filterAgent } : {}),
        ...(since ? { since } : {}),
        ...(this._filterPersistent ? { persistent: Number(this._filterPersistent) as 0 | 1 } : {}),
        ...(this._filterState ? { state: this._filterState } : {}),
        ...(lastSession ? { before: lastSession.createdAt } : {}),
      });

      if (append) {
        this._sessions = [...this._sessions, ...sessions];
      } else {
        this._sessions = sessions;
      }
      this._hasMoreSessions = hasMore;

      // Update agents dropdown from unique agents seen
      this._updateAgents();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private _updateAgents(): void {
    const seen = new Map<string, string>();
    for (const s of this._sessions) {
      if (!seen.has(s.agentId)) {
        seen.set(s.agentId, s.agentName ?? s.agentId);
      }
    }
    this._agents = [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async _selectSession(session: RuntimeSession): Promise<void> {
    this._selectedSession = session;
    this._messages = [];
    this._context = null;
    this._systemPromptOpen = false;
    this._expandedTools = new Set();
    this._loadingMessages = true;

    try {
      const [messagesResult, context] = await Promise.all([
        fetchSessionMessages(this.slug, session.id, { limit: MSG_PAGE_SIZE }),
        fetchSessionContext(this.slug, session.id),
      ]);
      this._messages = messagesResult.messages;
      this._hasMoreMessages = messagesResult.hasMore;
      this._context = context;
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
      // Silent — user can retry by scrolling
    } finally {
      this._loadingMessages = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

  private _onAgentChange(e: Event): void {
    this._filterAgent = (e.target as HTMLSelectElement).value;
    this._resetAndReload();
  }

  private _onPeriodChange(period: Period): void {
    this._filterPeriod = period;
    this._resetAndReload();
  }

  private _onPersistentChange(e: Event): void {
    this._filterPersistent = (e.target as HTMLSelectElement).value as "" | "0" | "1";
    this._resetAndReload();
  }

  private _onStateChange(e: Event): void {
    this._filterState = (e.target as HTMLSelectElement).value as "active" | "archived" | "";
    this._resetAndReload();
  }

  private _resetAndReload(): void {
    this._selectedSession = null;
    this._messages = [];
    this._context = null;
    this._loadSessions();
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
          this._loadSessions(true);
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
          ${msg("← Back", { id: "btn-back" })}
        </button>
        <span class="title"
          >${msg("Session Logs", { id: "session-logs-title" })} — ${this.slug}</span
        >
      </div>

      ${this._renderFilters()}
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

      <div class="layout">${this._renderSessionList()} ${this._renderConversation()}</div>
    `;
  }

  // --- Filters ---

  private _renderFilters() {
    return html`
      <div class="filters">
        <span class="filter-label">${msg("Agent", { id: "session-logs-filter-agent" })}</span>
        <select class="filter-select" @change=${this._onAgentChange} .value=${this._filterAgent}>
          <option value="">${msg("All agents", { id: "session-logs-all-agents" })}</option>
          ${this._agents.map((a) => html`<option value=${a.id}>${a.name}</option>`)}
        </select>

        <span class="filter-label">${msg("Period", { id: "session-logs-filter-period" })}</span>
        <div class="segmented">
          ${(["7d", "30d", "all"] as Period[]).map(
            (p) => html`
              <button
                class=${p === this._filterPeriod ? "active" : ""}
                @click=${() => this._onPeriodChange(p)}
              >
                ${p === "7d"
                  ? "7d"
                  : p === "30d"
                    ? "30d"
                    : msg("All", { id: "session-logs-all-types" })}
              </button>
            `,
          )}
        </div>

        <span class="filter-label">${msg("Type", { id: "session-logs-filter-type" })}</span>
        <select
          class="filter-select"
          @change=${this._onPersistentChange}
          .value=${this._filterPersistent}
        >
          <option value="">${msg("All", { id: "session-logs-all-types" })}</option>
          <option value="1">${msg("Permanent", { id: "session-logs-permanent" })}</option>
          <option value="0">${msg("Ephemeral", { id: "session-logs-ephemeral" })}</option>
        </select>

        <span class="filter-label">${msg("State", { id: "session-logs-filter-state" })}</span>
        <select class="filter-select" @change=${this._onStateChange} .value=${this._filterState}>
          <option value="">${msg("All", { id: "session-logs-all-types" })}</option>
          <option value="active">${msg("Active", { id: "session-logs-active" })}</option>
          <option value="archived">${msg("Archived", { id: "session-logs-archived" })}</option>
        </select>
      </div>
    `;
  }

  // --- Session list (left panel) ---

  private _renderSessionList() {
    if (this._loading && this._sessions.length === 0) {
      return html`<div class="session-list">
        <div class="spinner">${msg("Loading...", { id: "session-logs-loading" })}</div>
      </div>`;
    }

    if (this._sessions.length === 0) {
      return html`<div class="session-list">
        <div class="empty">${msg("No sessions found", { id: "session-logs-no-sessions" })}</div>
      </div>`;
    }

    return html`
      <div class="session-list">
        ${this._sessions.map((s) => this._renderSessionItem(s))}
        ${this._hasMoreSessions
          ? html`<div class="session-sentinel load-sentinel">
              ${this._loading ? msg("Loading...", { id: "session-logs-loading" }) : ""}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderSessionItem(s: RuntimeSession) {
    const selected = this._selectedSession?.id === s.id;
    return html`
      <div
        class="session-item ${selected ? "selected" : ""}"
        @click=${() => this._selectSession(s)}
      >
        <div class="session-agent">${s.agentName ?? s.agentId}</div>
        <div class="session-meta">
          <span>${fmtDate(s.createdAt)}</span>
          <span>·</span>
          <span>${s.messageCount ?? 0} msgs</span>
          <span>·</span>
          <span>${fmtCost(s.totalCostUsd)}</span>
          ${s.state === "archived"
            ? html`<span class="badge badge-archived">archived</span>`
            : nothing}
          ${s.persistent ? html`<span class="badge badge-persistent">persistent</span>` : nothing}
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
            ${msg("Select a session", { id: "session-logs-select-session" })}
          </div>
        </div>
      `;
    }

    if (this._loadingMessages && this._messages.length === 0) {
      return html`
        <div class="conversation">
          <div class="panel-empty">${msg("Loading...", { id: "session-logs-loading" })}</div>
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
            <strong>${this._selectedSession.agentName ?? this._selectedSession.agentId}</strong>
            · ${fmtDate(this._selectedSession.createdAt)} ${model ? html` · ${model}` : nothing}
          </div>
          <label class="toggle-raw">
            <input
              type="checkbox"
              .checked=${this._rawMode}
              @change=${(e: Event) => {
                this._rawMode = (e.target as HTMLInputElement).checked;
              }}
            />
            ${msg("Raw LLM", { id: "session-logs-raw-mode" })}
          </label>
        </div>

        <div class="panel-body">
          ${this._hasMoreMessages
            ? html`<button
                class="btn-back"
                style="align-self:center"
                @click=${() => this._loadMoreMessages()}
              >
                ${this._loadingMessages
                  ? msg("Loading...", { id: "session-logs-loading" })
                  : "Load earlier messages"}
              </button>`
            : nothing}
          ${this._renderSystemPrompt()} ${this._messages.map((m) => this._renderMessage(m))}
        </div>

        <div class="panel-footer">
          <span>Tokens: ${fmtTokens(totalTokensIn)} in / ${fmtTokens(totalTokensOut)} out</span>
          <span>${msg("Cost", { id: "session-logs-cost-label" })}: ${fmtCost(totalCost)}</span>
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
            ${msg("System prompt", { id: "session-logs-system-prompt" })} (${sizeKb} KB)
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
          <span>${this._systemPromptOpen ? "▼" : "▶"}</span>
          ${msg("System prompt", { id: "session-logs-system-prompt" })} (${sizeKb} KB)
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
          ${isUser ? "👤 user" : "🤖 assistant"}
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
          <div class="tool-detail">${JSON.stringify({ ...meta, content: p.content }, null, 2)}</div>
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
          <span>${expanded ? "▼" : "▶"}</span>
          <span>🔧 ${meta.toolName ?? "unknown"}</span>
          <span style="color:var(--text-muted)">→ ${p.state ?? "completed"}</span>
        </div>
        ${expanded ? html`<div class="tool-detail">${meta.args ?? p.content ?? ""}</div>` : nothing}
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

    // In conversation mode, tool results are shown inside expanded tool calls
    // Show standalone only if not linked to a tool call
    const meta = parseToolMetadata(p.metadata);
    const toolCallId = meta.toolCallId;
    if (toolCallId && this._expandedTools.has(toolCallId)) {
      return nothing; // Already rendered inside the tool call
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
          <span>${expanded ? "▼" : "▶"}</span>
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
        detail: { view: "cluster" },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-session-logs": SessionLogs;
  }
}
