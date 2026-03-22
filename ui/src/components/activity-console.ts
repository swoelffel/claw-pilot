// ui/src/components/activity-console.ts
// Activity Console — paginated event browser with filters.

import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { fetchRtEvents } from "../api.js";
import type { RtEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_REFRESH_MS = 30_000; // 30 seconds

/** Map event type prefix to badge color. */
const TYPE_COLORS: Record<string, string> = {
  runtime: "#a78bfa",
  session: "#60a5fa",
  message: "#34d399",
  permission: "#fb923c",
  provider: "#f87171",
  agent: "#818cf8",
  subagent: "#818cf8",
  heartbeat: "#94a3b8",
  mcp: "#2dd4bf",
  tool: "#facc15",
  llm: "#facc15",
  channel: "#22d3ee",
};

const LEVEL_COLORS: Record<string, string> = {
  info: "#60a5fa",
  warn: "#fb923c",
  error: "#f87171",
};

function typeColor(eventType: string): string {
  const prefix = eventType.split(".")[0] ?? "";
  return TYPE_COLORS[prefix] ?? "#94a3b8";
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-activity-console")
export class ActivityConsole extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1200px;
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
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        padding: var(--space-1) var(--space-2);
        cursor: pointer;
        font-size: 0.85rem;
      }
      .btn-back:hover {
        background: var(--bg-hover);
      }

      h1 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        flex: 1;
      }

      /* ── Filters ────────────────────────────────────────────────── */

      .filters {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
      }

      .filter-select,
      .filter-input {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        padding: var(--space-1) var(--space-2);
        font-size: 0.8rem;
        font-family: inherit;
      }

      .level-pills {
        display: flex;
        gap: var(--space-1);
      }

      .pill {
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: 0.75rem;
        cursor: pointer;
        transition: all 0.15s;
      }
      .pill.active {
        color: #fff;
        border-color: transparent;
      }
      .pill[data-level="info"].active {
        background: ${unsafeCSS(LEVEL_COLORS.info)};
      }
      .pill[data-level="warn"].active {
        background: ${unsafeCSS(LEVEL_COLORS.warn)};
      }
      .pill[data-level="error"].active {
        background: ${unsafeCSS(LEVEL_COLORS.error)};
      }

      .auto-refresh-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: 0.75rem;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .auto-refresh-toggle input {
        accent-color: var(--accent);
      }

      /* ── Table ──────────────────────────────────────────────────── */

      .events-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
      }

      .events-table th {
        text-align: left;
        padding: var(--space-2) var(--space-2);
        color: var(--text-secondary);
        font-weight: 500;
        border-bottom: 1px solid var(--bg-border);
        white-space: nowrap;
      }

      .events-table td {
        padding: var(--space-2) var(--space-2);
        border-bottom: 1px solid var(--bg-border);
        vertical-align: top;
      }

      .events-table tr {
        cursor: pointer;
      }
      .events-table tr:hover {
        background: var(--bg-hover);
      }

      .level-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        vertical-align: middle;
      }

      .type-badge {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
      }

      .agent-tag {
        color: var(--text-secondary);
        font-size: 0.75rem;
      }

      .summary-text {
        color: var(--text-primary);
      }

      .time-col {
        white-space: nowrap;
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }

      /* ── Detail panel ───────────────────────────────────────────── */

      .detail-row td {
        padding: var(--space-2) var(--space-2);
        background: var(--bg-surface);
      }

      .detail-json {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
        font-family: monospace;
        font-size: 0.75rem;
        color: var(--text-primary);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 300px;
        overflow-y: auto;
      }

      /* ── Footer / Load more ─────────────────────────────────────── */

      .footer {
        display: flex;
        justify-content: center;
        margin-top: var(--space-4);
      }

      .btn-load-more {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        padding: var(--space-2) var(--space-4);
        cursor: pointer;
        font-size: 0.8rem;
      }
      .btn-load-more:hover {
        background: var(--bg-hover);
      }
      .btn-load-more:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ── States ─────────────────────────────────────────────────── */

      .loading,
      .error,
      .empty {
        text-align: center;
        padding: var(--space-8);
        color: var(--text-secondary);
      }
      .error {
        color: var(--error);
      }
    `,
  ];

  @property() slug = "";

  // Data
  @state() private _events: RtEvent[] = [];
  @state() private _loading = false;
  @state() private _loadingMore = false;
  @state() private _error: string | null = null;
  @state() private _nextCursor: number | null = null;

  // Filters
  @state() private _filterLevel = "";
  @state() private _filterAgent = "";
  @state() private _filterType = "";

  // Detail
  @state() private _expandedIds = new Set<number>();

  // Auto-refresh
  @state() private _autoRefresh = true;
  private _refreshInterval: ReturnType<typeof setInterval> | undefined;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this._startAutoRefresh();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopAutoRefresh();
  }

  override updated(changed: Map<string, unknown>): void {
    if (
      changed.has("slug") ||
      changed.has("_filterLevel") ||
      changed.has("_filterAgent") ||
      changed.has("_filterType")
    ) {
      void this._loadData();
    }
    if (changed.has("_autoRefresh")) {
      if (this._autoRefresh) this._startAutoRefresh();
      else this._stopAutoRefresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  private async _loadData(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = null;
    this._events = [];
    this._nextCursor = null;

    try {
      const page = await fetchRtEvents(this.slug, {
        limit: 50,
        ...(this._filterLevel ? { level: this._filterLevel } : {}),
        ...(this._filterAgent ? { agentId: this._filterAgent } : {}),
        ...(this._filterType ? { type: [this._filterType] } : {}),
      });
      this._events = page.events;
      this._nextCursor = page.nextCursor;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load events";
    }
    this._loading = false;
  }

  private async _loadMore(): Promise<void> {
    if (!this.slug || !this._nextCursor || this._loadingMore) return;
    this._loadingMore = true;

    try {
      const page = await fetchRtEvents(this.slug, {
        cursor: this._nextCursor,
        limit: 50,
        ...(this._filterLevel ? { level: this._filterLevel } : {}),
        ...(this._filterAgent ? { agentId: this._filterAgent } : {}),
        ...(this._filterType ? { type: [this._filterType] } : {}),
      });
      this._events = [...this._events, ...page.events];
      this._nextCursor = page.nextCursor;
    } catch {
      // Silently fail on load-more
    }
    this._loadingMore = false;
  }

  private _startAutoRefresh(): void {
    this._stopAutoRefresh();
    if (this._autoRefresh) {
      this._refreshInterval = setInterval(() => void this._loadData(), AUTO_REFRESH_MS);
    }
  }

  private _stopAutoRefresh(): void {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private _toggleExpand(id: number): void {
    const next = new Set(this._expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedIds = next;
  }

  private _navigateBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "cluster" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      <div class="header">
        <button class="btn-back" @click=${this._navigateBack}>
          ← ${msg("Back", { id: "activity.back" })}
        </button>
        <h1>${msg("Activity", { id: "activity.title" })}</h1>
        <label class="auto-refresh-toggle">
          <input
            type="checkbox"
            .checked=${this._autoRefresh}
            @change=${(e: Event) => {
              this._autoRefresh = (e.target as HTMLInputElement).checked;
            }}
          />
          ${msg("Auto-refresh", { id: "activity.auto-refresh" })}
        </label>
      </div>

      ${this._renderFilters()}
      ${this._loading
        ? html`<div class="loading">${msg("Loading…", { id: "activity.loading" })}</div>`
        : nothing}
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${!this._loading && !this._error ? this._renderTable() : nothing}
      ${this._nextCursor !== null
        ? html`
            <div class="footer">
              <button
                class="btn-load-more"
                ?disabled=${this._loadingMore}
                @click=${() => void this._loadMore()}
              >
                ${this._loadingMore
                  ? msg("Loading…", { id: "activity.loading-more" })
                  : msg("Load more", { id: "activity.load-more" })}
              </button>
            </div>
          `
        : nothing}
    `;
  }

  private _renderFilters() {
    return html`
      <div class="filters">
        <select
          class="filter-select"
          .value=${this._filterType}
          @change=${(e: Event) => {
            this._filterType = (e.target as HTMLSelectElement).value;
          }}
        >
          <option value="">${msg("All types", { id: "activity.filter-all-types" })}</option>
          <option value="runtime.started">runtime.started</option>
          <option value="runtime.stopped">runtime.stopped</option>
          <option value="runtime.error">runtime.error</option>
          <option value="session.created">session.created</option>
          <option value="session.ended">session.ended</option>
          <option value="session.status">session.status</option>
          <option value="message.created">message.created</option>
          <option value="message.updated">message.updated</option>
          <option value="permission.asked">permission.asked</option>
          <option value="permission.replied">permission.replied</option>
          <option value="provider.auth_failed">provider.auth_failed</option>
          <option value="provider.failover">provider.failover</option>
          <option value="heartbeat.alert">heartbeat.alert</option>
          <option value="agent.message.sent">agent.message.sent</option>
          <option value="subagent.completed">subagent.completed</option>
          <option value="mcp.server.reconnected">mcp.server.reconnected</option>
          <option value="mcp.tools.changed">mcp.tools.changed</option>
          <option value="tool.doom_loop">tool.doom_loop</option>
          <option value="channel.message.received">channel.message.received</option>
          <option value="channel.message.sent">channel.message.sent</option>
        </select>

        <input
          class="filter-input"
          type="text"
          placeholder=${msg("Agent ID", { id: "activity.filter-agent" })}
          .value=${this._filterAgent}
          @input=${(e: Event) => {
            this._filterAgent = (e.target as HTMLInputElement).value.trim();
          }}
        />

        <div class="level-pills">
          ${(["info", "warn", "error"] as const).map(
            (lvl) => html`
              <button
                class="pill ${this._filterLevel === lvl ? "active" : ""}"
                data-level=${lvl}
                @click=${() => {
                  this._filterLevel = this._filterLevel === lvl ? "" : lvl;
                }}
              >
                ${lvl}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _renderTable() {
    if (this._events.length === 0) {
      return html`<div class="empty">${msg("No events found", { id: "activity.empty" })}</div>`;
    }

    return html`
      <table class="events-table">
        <thead>
          <tr>
            <th>${msg("Time", { id: "activity.col-time" })}</th>
            <th></th>
            <th>${msg("Type", { id: "activity.col-type" })}</th>
            <th>${msg("Agent", { id: "activity.col-agent" })}</th>
            <th>${msg("Summary", { id: "activity.col-summary" })}</th>
          </tr>
        </thead>
        <tbody>
          ${this._events.map((ev) => this._renderEventRow(ev))}
        </tbody>
      </table>
    `;
  }

  private _renderEventRow(ev: RtEvent) {
    const expanded = this._expandedIds.has(ev.id);
    return html`
      <tr @click=${() => this._toggleExpand(ev.id)}>
        <td class="time-col">${fmtTime(ev.createdAt)}</td>
        <td>
          <span class="level-dot" style="background:${LEVEL_COLORS[ev.level] ?? "#94a3b8"}"></span>
        </td>
        <td>
          <span class="type-badge" style="background:${typeColor(ev.eventType)}"
            >${ev.eventType}</span
          >
        </td>
        <td class="agent-tag">${ev.agentId ?? "—"}</td>
        <td class="summary-text">${ev.summary ?? ""}</td>
      </tr>
      ${expanded
        ? html`
            <tr class="detail-row">
              <td colspan="5">
                <pre class="detail-json">
${ev.payload ? JSON.stringify(ev.payload, null, 2) : "null"}</pre
                >
              </td>
            </tr>
          `
        : nothing}
    `;
  }
}
