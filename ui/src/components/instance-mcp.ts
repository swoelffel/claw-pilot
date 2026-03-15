// ui/src/components/instance-mcp.ts
// Panneau MCP — affiche les serveurs MCP connectés/déconnectés et leurs outils
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";

interface McpServerStatus {
  id: string;
  type: string;
  connected: boolean;
  toolCount: number;
  lastError: string | null;
}

interface McpTool {
  id: string;
  serverId: string;
  name: string;
}

@localized()
@customElement("cp-instance-mcp")
export class InstanceMcp extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
      }

      .mcp-panel {
        padding: 0;
      }

      .section-header {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 16px;
      }

      /* ── Groupes CONNECTED / DISCONNECTED ───────────────── */

      .group {
        margin-bottom: 20px;
      }

      .group-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .group-title.connected {
        color: var(--state-running);
      }

      .group-title.disconnected {
        color: var(--text-muted);
      }

      .group-count {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 700;
        font-family: var(--font-mono);
      }

      .group-count.connected {
        background: rgba(16, 185, 129, 0.1);
        color: var(--state-running);
        border: 1px solid rgba(16, 185, 129, 0.25);
      }

      .group-count.disconnected {
        background: rgba(100, 116, 139, 0.1);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.2);
      }

      /* ── Server rows ────────────────────────────────────── */

      .server-list {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .server-row {
        padding: 10px 14px;
        border-bottom: 1px solid var(--bg-border);
      }

      .server-row:last-child {
        border-bottom: none;
      }

      .server-row-main {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .server-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .server-dot.connected {
        background: var(--state-running);
        box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
      }

      .server-dot.disconnected {
        background: var(--text-muted);
      }

      .server-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .server-type {
        font-size: 10px;
        font-weight: 600;
        font-family: var(--font-mono);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        background: rgba(100, 116, 139, 0.1);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.2);
        flex-shrink: 0;
      }

      .server-tool-count {
        font-size: 11px;
        color: var(--text-muted);
        flex-shrink: 0;
        white-space: nowrap;
      }

      .btn-tools-toggle {
        padding: 3px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
        flex-shrink: 0;
        white-space: nowrap;
      }

      .btn-tools-toggle:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .server-error {
        font-size: 11px;
        color: var(--state-error);
        margin-top: 4px;
        padding-left: 18px;
      }

      /* ── Tools expand inline ────────────────────────────── */

      .tools-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin-top: 8px;
        padding: 8px 10px;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
      }

      .tool-name {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── Footer ─────────────────────────────────────────── */

      .footer {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 4px;
      }

      .btn-refresh {
        padding: 5px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
      }

      .btn-refresh:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .empty-msg {
        font-size: 13px;
        color: var(--text-muted);
        padding: 12px 0;
      }
    `,
  ];

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  @state() private _servers: McpServerStatus[] = [];
  @state() private _tools: McpTool[] = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _expandedServers: Set<string> = new Set();
  @state() private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.active) {
      void this._load();
      this._startPolling();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPolling();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("active")) {
      if (this.active) {
        void this._load();
        this._startPolling();
      } else {
        this._stopPolling();
      }
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = "";
    try {
      const token = (window as { __CP_TOKEN__?: string }).__CP_TOKEN__ ?? "";
      const headers = { Authorization: `Bearer ${token}` };

      // Charge status et tools en parallèle
      const [statusRes, toolsRes] = await Promise.all([
        fetch(`/api/instances/${this.slug}/mcp/status`, { headers }),
        fetch(`/api/instances/${this.slug}/mcp/tools`, { headers }),
      ]);

      if (!statusRes.ok || !toolsRes.ok) {
        throw new Error("Failed to fetch MCP data");
      }

      const statusData = (await statusRes.json()) as { servers: McpServerStatus[] };
      const toolsData = (await toolsRes.json()) as { tools: McpTool[] };

      this._servers = statusData.servers ?? [];
      this._tools = toolsData.tools ?? [];

      // Émettre le nombre de serveurs connectés pour le badge sidebar
      const connectedCount = this._servers.filter((s) => s.connected).length;
      this.dispatchEvent(
        new CustomEvent("mcp-connected-count-changed", {
          detail: connectedCount,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load MCP status";
    } finally {
      this._loading = false;
    }
  }

  private _startPolling(): void {
    if (this._pollTimer !== null) return;
    this._pollTimer = setInterval(() => {
      void this._load();
    }, 30_000);
  }

  private _stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  private _toggleExpand(serverId: string): void {
    const next = new Set(this._expandedServers);
    if (next.has(serverId)) {
      next.delete(serverId);
    } else {
      next.add(serverId);
    }
    this._expandedServers = next;
  }

  private _renderServer(server: McpServerStatus) {
    const isExpanded = this._expandedServers.has(server.id);
    const serverTools = this._tools.filter((t) => t.serverId === server.id);
    const toolCount = serverTools.length > 0 ? serverTools.length : server.toolCount;

    return html`
      <div class="server-row">
        <div class="server-row-main">
          <span class="server-dot ${server.connected ? "connected" : "disconnected"}"></span>
          <span class="server-name" title=${server.id}>${server.id}</span>
          <span class="server-type">${server.type}</span>
          <span class="server-tool-count">
            ${toolCount} ${toolCount === 1 ? "tool" : "tools"}
          </span>
          ${toolCount > 0
            ? html`
                <button class="btn-tools-toggle" @click=${() => this._toggleExpand(server.id)}>
                  Tools ${isExpanded ? "▴" : "▾"}
                </button>
              `
            : nothing}
        </div>

        ${server.lastError ? html`<div class="server-error">⚠ ${server.lastError}</div>` : nothing}
        ${isExpanded && serverTools.length > 0
          ? html`
              <div class="tools-grid">
                ${serverTools.map(
                  (t) => html`<span class="tool-name" title=${t.name}>${t.name}</span>`,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  override render() {
    const connected = this._servers.filter((s) => s.connected);
    const disconnected = this._servers.filter((s) => !s.connected);

    return html`
      <div class="mcp-panel">
        <div class="section-header">MCP</div>

        ${this._loading && this._servers.length === 0 ? html`<div class="spinner"></div>` : nothing}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
        ${this._servers.length === 0 && !this._loading
          ? html`<p class="empty-msg">
              ${msg("No MCP servers configured.", { id: "mcp-no-servers" })}
            </p>`
          : nothing}
        ${connected.length > 0
          ? html`
              <div class="group">
                <div class="group-title connected">
                  CONNECTED
                  <span class="group-count connected">${connected.length}</span>
                </div>
                <div class="server-list">${connected.map((s) => this._renderServer(s))}</div>
              </div>
            `
          : nothing}
        ${disconnected.length > 0
          ? html`
              <div class="group">
                <div class="group-title disconnected">
                  DISCONNECTED
                  <span class="group-count disconnected">${disconnected.length}</span>
                </div>
                <div class="server-list">${disconnected.map((s) => this._renderServer(s))}</div>
              </div>
            `
          : nothing}

        <div class="footer">
          <button class="btn-refresh" @click=${() => void this._load()}>
            ↻ ${msg("Refresh", { id: "mcp-btn-refresh" })}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-mcp": InstanceMcp;
  }
}
