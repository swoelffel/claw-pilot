// ui/src/components/instance-mcp.ts
// MCP panel — configure, status and tools for MCP servers
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";
import { ApiError } from "../lib/api-error.js";
import { userMessage } from "../lib/error-messages.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface McpServerConfig {
  id: string;
  type: "local" | "remote";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 16px;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* ── mcpEnabled toggle ─────────────────────────────────── */

      .toggle-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
      }

      .toggle-label {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .toggle {
        position: relative;
        width: 36px;
        height: 20px;
        flex-shrink: 0;
      }

      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--bg-border);
        border-radius: 20px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .toggle-slider::before {
        content: "";
        position: absolute;
        width: 14px;
        height: 14px;
        left: 3px;
        bottom: 3px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
      }

      .toggle input:checked + .toggle-slider {
        background: var(--accent);
      }

      .toggle input:checked + .toggle-slider::before {
        transform: translateX(16px);
      }

      .toggle input:disabled + .toggle-slider {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ── Restart banner ────────────────────────────────────── */

      .restart-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 14px;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.3);
        border-radius: var(--radius-md);
        margin-bottom: 16px;
        font-size: 12px;
        color: var(--text-secondary);
      }

      .restart-banner strong {
        color: var(--text-primary);
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

      .group-title.configured {
        color: var(--text-secondary);
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

      .group-count.configured {
        background: rgba(100, 116, 139, 0.08);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.15);
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

      .server-dot.configured {
        background: var(--bg-border);
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

      .server-disabled-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        background: rgba(100, 116, 139, 0.08);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.15);
        flex-shrink: 0;
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

      /* ── Server action buttons ─────────────────────────── */

      .server-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .btn-icon {
        padding: 3px 6px;
        border-radius: var(--radius-sm);
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
        line-height: 1;
        transition:
          background 0.15s,
          color 0.15s,
          border-color 0.15s;
      }

      .btn-icon:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
        border-color: var(--bg-border);
      }

      .btn-icon.danger:hover {
        background: rgba(239, 68, 68, 0.1);
        color: var(--state-error);
        border-color: rgba(239, 68, 68, 0.25);
      }

      .btn-icon:disabled {
        opacity: 0.4;
        cursor: not-allowed;
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

      /* ── Dialog overlay ─────────────────────────────────── */

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .dialog {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 520px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid var(--bg-border);
      }

      .dialog-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: color 0.15s;
      }

      .close-btn:hover {
        color: var(--text-primary);
      }

      .close-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .dialog-body {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .dialog-footer {
        padding: 14px 24px;
        border-top: 1px solid var(--bg-border);
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      /* ── Form fields ─────────────────────────────────────── */

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .field label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .field input,
      .field textarea {
        padding: 8px 10px;
        background: var(--bg-input, var(--bg-hover));
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        transition: border-color 0.15s;
        width: 100%;
        box-sizing: border-box;
      }

      .field input:focus,
      .field textarea:focus {
        outline: none;
        border-color: var(--accent);
      }

      .field textarea {
        resize: vertical;
        min-height: 72px;
        font-family: var(--font-mono);
        font-size: 12px;
      }

      .field-hint {
        font-size: 11px;
        color: var(--text-muted);
      }

      .type-tabs {
        display: flex;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }

      .type-tab {
        flex: 1;
        padding: 7px;
        background: transparent;
        border: none;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
        text-align: center;
      }

      .type-tab.active {
        background: var(--accent);
        color: white;
      }

      .delete-confirm-msg {
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.5;
      }

      .delete-confirm-msg strong {
        color: var(--state-error);
        font-family: var(--font-mono);
      }
    `,
  ];

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  // Status/tool state
  @state() private _servers: McpServerStatus[] = [];
  @state() private _tools: McpTool[] = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _expandedServers: Set<string> = new Set();
  @state() private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // Configured servers (from CRUD endpoint)
  @state() private _configuredServers: McpServerConfig[] = [];
  @state() private _mcpEnabled = false;
  @state() private _loadingConfig = false;
  @state() private _restartRequired = false;

  // Dialog state
  @state() private _showAddDialog = false;
  @state() private _showDeleteConfirm: string | null = null; // serverId
  @state() private _editingServer: McpServerConfig | null = null;
  @state() private _dialogSaving = false;
  @state() private _dialogError = "";

  // Form state (add / edit dialog)
  @state() private _formType: "local" | "remote" = "local";
  @state() private _formId = "";
  @state() private _formCommand = "";
  @state() private _formArgs = "";
  @state() private _formEnv = "";
  @state() private _formUrl = "";
  @state() private _formHeaders = "";
  @state() private _formEnabled = true;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.active) {
      void this._load();
      void this._loadConfig();
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
        void this._loadConfig();
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
      const token = getToken();
      const headers = { Authorization: `Bearer ${token}` };

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

  private async _loadConfig(): Promise<void> {
    if (!this.slug) return;
    this._loadingConfig = true;
    try {
      const token = getToken();
      const res = await fetch(`/api/instances/${this.slug}/mcp/servers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch MCP config");
      const data = (await res.json()) as { mcpEnabled: boolean; servers: McpServerConfig[] };
      this._mcpEnabled = data.mcpEnabled;
      this._configuredServers = data.servers ?? [];
    } catch {
      // Non-critical — config tab may not be accessible
    } finally {
      this._loadingConfig = false;
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

  // ── MCP enabled toggle ─────────────────────────────────────────────────────

  private async _toggleMcpEnabled(enabled: boolean): Promise<void> {
    try {
      const token = getToken();
      const res = await fetch(`/api/instances/${this.slug}/mcp/enabled`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new ApiError(res.status, "MCP_TOGGLE_FAILED", "Failed to toggle MCP");
      this._mcpEnabled = enabled;
      this._restartRequired = true;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  // ── Add / Edit dialog ──────────────────────────────────────────────────────

  private _openAddDialog(): void {
    this._editingServer = null;
    this._formType = "local";
    this._formId = "";
    this._formCommand = "";
    this._formArgs = "";
    this._formEnv = "";
    this._formUrl = "";
    this._formHeaders = "";
    this._formEnabled = true;
    this._dialogError = "";
    this._showAddDialog = true;
  }

  private _openEditDialog(srv: McpServerConfig): void {
    this._editingServer = srv;
    this._formType = srv.type;
    this._formId = srv.id;
    this._formCommand = srv.command ?? "";
    this._formArgs = (srv.args ?? []).join(", ");
    // Env values are masked — don't pre-fill
    this._formEnv = "";
    this._formUrl = srv.url ?? "";
    // Headers are masked — don't pre-fill
    this._formHeaders = "";
    this._formEnabled = srv.enabled ?? true;
    this._dialogError = "";
    this._showAddDialog = true;
  }

  private _closeDialog(): void {
    this._showAddDialog = false;
    this._editingServer = null;
    this._dialogError = "";
  }

  /** Parse "KEY=VALUE\nKEY2=VALUE2" or JSON object string into a record. */
  private _parseKeyValue(raw: string): Record<string, string> | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const result: Record<string, string> = {};
    for (const line of trimmed.split("\n")) {
      const idx = line.indexOf("=");
      if (idx < 1) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) result[k] = v;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private async _saveServer(): Promise<void> {
    this._dialogError = "";
    this._dialogSaving = true;

    const isEditing = this._editingServer !== null;
    const id = this._formId.trim();
    const args = this._formArgs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const env = this._parseKeyValue(this._formEnv);
    const headers = this._parseKeyValue(this._formHeaders);

    try {
      const token = getToken();
      let body: Record<string, unknown>;

      if (this._formType === "local") {
        body = {
          type: "local",
          ...(isEditing ? {} : { id }),
          ...(this._formCommand ? { command: this._formCommand.trim() } : {}),
          ...(args.length > 0 ? { args } : isEditing ? {} : { args: [] }),
          ...(env !== undefined ? { env } : {}),
          enabled: this._formEnabled,
        };
      } else {
        body = {
          type: "remote",
          ...(isEditing ? {} : { id }),
          ...(this._formUrl ? { url: this._formUrl.trim() } : {}),
          ...(headers !== undefined ? { headers } : {}),
          enabled: this._formEnabled,
        };
      }

      const url = isEditing
        ? `/api/instances/${this.slug}/mcp/servers/${this._editingServer!.id}`
        : `/api/instances/${this.slug}/mcp/servers`;

      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save MCP server");
      }

      this._restartRequired = true;
      this._closeDialog();
      await this._loadConfig();
    } catch (err) {
      this._dialogError = err instanceof Error ? err.message : "Failed to save MCP server";
    } finally {
      this._dialogSaving = false;
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private async _deleteServer(serverId: string): Promise<void> {
    this._showDeleteConfirm = null;
    try {
      const token = getToken();
      const res = await fetch(`/api/instances/${this.slug}/mcp/servers/${serverId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete MCP server");
      this._restartRequired = true;
      await this._loadConfig();
    } catch (err) {
      this._error = userMessage(err);
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

  private _renderStatusServer(server: McpServerStatus) {
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
                  ${msg("Tools", { id: "mcp-tools-label" })} ${isExpanded ? "▴" : "▾"}
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

  private _renderConfiguredServer(srv: McpServerConfig) {
    return html`
      <div class="server-row">
        <div class="server-row-main">
          <span class="server-dot configured"></span>
          <span class="server-name" title=${srv.id}>${srv.id}</span>
          <span class="server-type">${srv.type}</span>
          ${srv.enabled === false
            ? html`<span class="server-disabled-badge">
                ${msg("disabled", { id: "mcp-disabled-badge" })}
              </span>`
            : nothing}
          <div class="server-actions">
            <button
              class="btn-icon"
              title=${msg("Edit server", { id: "mcp-btn-edit-title" })}
              @click=${() => this._openEditDialog(srv)}
            >
              ✏
            </button>
            <button
              class="btn-icon danger"
              title=${msg("Delete server", { id: "mcp-btn-delete-title" })}
              @click=${() => {
                this._showDeleteConfirm = srv.id;
              }}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderDialog() {
    if (!this._showAddDialog) return nothing;
    const isEditing = this._editingServer !== null;
    const title = isEditing
      ? msg("Edit MCP Server", { id: "mcp-dialog-edit-title" })
      : msg("Add MCP Server", { id: "mcp-dialog-add-title" });

    return html`
      <div
        class="overlay"
        @click=${(e: Event) => e.target === e.currentTarget && this._closeDialog()}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${title}</span>
            <button class="close-btn" ?disabled=${this._dialogSaving} @click=${this._closeDialog}>
              ×
            </button>
          </div>
          <div class="dialog-body">
            ${this._dialogError
              ? html`<div class="error-banner">${this._dialogError}</div>`
              : nothing}

            <!-- Type tabs (only for create) -->
            ${!isEditing
              ? html`
                  <div class="field">
                    <label>${msg("Type", { id: "mcp-form-type" })}</label>
                    <div class="type-tabs">
                      <button
                        class="type-tab ${this._formType === "local" ? "active" : ""}"
                        @click=${() => {
                          this._formType = "local";
                        }}
                      >
                        local (stdio)
                      </button>
                      <button
                        class="type-tab ${this._formType === "remote" ? "active" : ""}"
                        @click=${() => {
                          this._formType = "remote";
                        }}
                      >
                        remote (HTTP)
                      </button>
                    </div>
                  </div>
                `
              : nothing}

            <!-- ID (only for create) -->
            ${!isEditing
              ? html`
                  <div class="field">
                    <label>${msg("ID", { id: "mcp-form-id" })}</label>
                    <input
                      type="text"
                      .value=${this._formId}
                      @input=${(e: InputEvent) => {
                        this._formId = (e.target as HTMLInputElement).value;
                      }}
                      placeholder="jira"
                      ?disabled=${this._dialogSaving}
                    />
                    <span class="field-hint"
                      >${msg("Alphanumeric, dash or underscore", {
                        id: "mcp-form-id-hint",
                      })}</span
                    >
                  </div>
                `
              : nothing}

            <!-- Local fields -->
            ${this._formType === "local"
              ? html`
                  <div class="field">
                    <label>${msg("Command", { id: "mcp-form-command" })}</label>
                    <input
                      type="text"
                      .value=${this._formCommand}
                      @input=${(e: InputEvent) => {
                        this._formCommand = (e.target as HTMLInputElement).value;
                      }}
                      placeholder="npx"
                      ?disabled=${this._dialogSaving}
                    />
                  </div>
                  <div class="field">
                    <label>${msg("Arguments", { id: "mcp-form-args" })}</label>
                    <input
                      type="text"
                      .value=${this._formArgs}
                      @input=${(e: InputEvent) => {
                        this._formArgs = (e.target as HTMLInputElement).value;
                      }}
                      placeholder="@modelcontextprotocol/server-atlassian"
                      ?disabled=${this._dialogSaving}
                    />
                    <span class="field-hint"
                      >${msg("Comma-separated", { id: "mcp-form-args-hint" })}</span
                    >
                  </div>
                  <div class="field">
                    <label>${msg("Environment variables", { id: "mcp-form-env" })}</label>
                    <textarea
                      .value=${this._formEnv}
                      @input=${(e: InputEvent) => {
                        this._formEnv = (e.target as HTMLTextAreaElement).value;
                      }}
                      placeholder="JIRA_TOKEN=your-token&#10;JIRA_URL=https://team.atlassian.net"
                      ?disabled=${this._dialogSaving}
                    ></textarea>
                    <span class="field-hint"
                      >${msg("KEY=VALUE, one per line", { id: "mcp-form-env-hint" })}</span
                    >
                  </div>
                `
              : nothing}

            <!-- Remote fields -->
            ${this._formType === "remote"
              ? html`
                  <div class="field">
                    <label>${msg("URL", { id: "mcp-form-url" })}</label>
                    <input
                      type="url"
                      .value=${this._formUrl}
                      @input=${(e: InputEvent) => {
                        this._formUrl = (e.target as HTMLInputElement).value;
                      }}
                      placeholder="https://mcp.example.com"
                      ?disabled=${this._dialogSaving}
                    />
                  </div>
                  <div class="field">
                    <label>${msg("Headers", { id: "mcp-form-headers" })}</label>
                    <textarea
                      .value=${this._formHeaders}
                      @input=${(e: InputEvent) => {
                        this._formHeaders = (e.target as HTMLTextAreaElement).value;
                      }}
                      placeholder="Authorization=Bearer token"
                      ?disabled=${this._dialogSaving}
                    ></textarea>
                    <span class="field-hint"
                      >${msg("KEY=VALUE, one per line", { id: "mcp-form-headers-hint" })}</span
                    >
                  </div>
                `
              : nothing}

            <!-- Enabled toggle -->
            <div class="toggle-row">
              <label class="toggle">
                <input
                  type="checkbox"
                  ?checked=${this._formEnabled}
                  @change=${(e: Event) => {
                    this._formEnabled = (e.target as HTMLInputElement).checked;
                  }}
                  ?disabled=${this._dialogSaving}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-label">${msg("Enabled", { id: "mcp-form-enabled" })}</span>
            </div>
          </div>
          <div class="dialog-footer">
            <button
              class="btn secondary"
              ?disabled=${this._dialogSaving}
              @click=${this._closeDialog}
            >
              ${msg("Cancel", { id: "mcp-dialog-cancel" })}
            </button>
            <button class="btn primary" ?disabled=${this._dialogSaving} @click=${this._saveServer}>
              ${this._dialogSaving
                ? html`<span class="spinner-sm"></span>`
                : isEditing
                  ? msg("Save", { id: "mcp-dialog-save" })
                  : msg("Add Server", { id: "mcp-dialog-add" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderDeleteConfirm() {
    const id = this._showDeleteConfirm;
    if (!id) return nothing;
    return html`
      <div
        class="overlay"
        @click=${(e: Event) => e.target === e.currentTarget && (this._showDeleteConfirm = null)}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title"
              >${msg("Delete MCP Server", { id: "mcp-delete-title" })}</span
            >
            <button
              class="close-btn"
              @click=${() => {
                this._showDeleteConfirm = null;
              }}
            >
              ×
            </button>
          </div>
          <div class="dialog-body">
            <p class="delete-confirm-msg">
              ${msg(html`Remove server <strong>${id}</strong> from this instance?`, {
                id: "mcp-delete-confirm-msg",
              })}
            </p>
          </div>
          <div class="dialog-footer">
            <button
              class="btn secondary"
              @click=${() => {
                this._showDeleteConfirm = null;
              }}
            >
              ${msg("Cancel", { id: "mcp-delete-cancel" })}
            </button>
            <button class="btn danger" @click=${() => void this._deleteServer(id)}>
              ${msg("Delete", { id: "mcp-delete-confirm" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    const connected = this._servers.filter((s) => s.connected);
    const disconnected = this._servers.filter((s) => !s.connected);

    return html`
      <div class="mcp-panel">
        <div class="section-header">
          <span>MCP</span>
          <div class="header-actions">
            <label class="toggle" title=${msg("Enable/disable MCP", { id: "mcp-toggle-title" })}>
              <input
                type="checkbox"
                ?checked=${this._mcpEnabled}
                @change=${(e: Event) =>
                  void this._toggleMcpEnabled((e.target as HTMLInputElement).checked)}
                ?disabled=${this._loadingConfig}
              />
              <span class="toggle-slider"></span>
            </label>
            <button class="btn primary small" @click=${this._openAddDialog}>
              + ${msg("Add Server", { id: "mcp-btn-add-server" })}
            </button>
          </div>
        </div>

        ${this._restartRequired
          ? html`
              <div class="restart-banner">
                <span
                  ><strong>${msg("Restart required", { id: "mcp-restart-required" })}</strong> —
                  ${msg("MCP configuration changed. Restart the instance to apply.", {
                    id: "mcp-restart-msg",
                  })}</span
                >
                <button
                  class="btn secondary small"
                  @click=${async () => {
                    this._restartRequired = false;
                    try {
                      const token = getToken();
                      await fetch(`/api/instances/${this.slug}/restart`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}` },
                      });
                    } catch {
                      this._restartRequired = true;
                    }
                  }}
                >
                  ${msg("Restart now", { id: "mcp-restart-btn" })}
                </button>
              </div>
            `
          : nothing}
        ${this._loading && this._servers.length === 0 ? html`<div class="spinner"></div>` : nothing}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

        <!-- Configured servers (static config) -->
        ${this._configuredServers.length > 0
          ? html`
              <div class="group">
                <div class="group-title configured">
                  ${msg("CONFIGURED", { id: "mcp-group-configured" })}
                  <span class="group-count configured">${this._configuredServers.length}</span>
                </div>
                <div class="server-list">
                  ${this._configuredServers.map((s) => this._renderConfiguredServer(s))}
                </div>
              </div>
            `
          : html`<p class="empty-msg">
              ${msg("No MCP servers configured.", { id: "mcp-no-servers" })}
            </p>`}

        <!-- Runtime status (connected / disconnected) -->
        ${connected.length > 0
          ? html`
              <div class="group">
                <div class="group-title connected">
                  ${msg("CONNECTED", { id: "mcp-group-connected" })}
                  <span class="group-count connected">${connected.length}</span>
                </div>
                <div class="server-list">${connected.map((s) => this._renderStatusServer(s))}</div>
              </div>
            `
          : nothing}
        ${disconnected.length > 0
          ? html`
              <div class="group">
                <div class="group-title disconnected">
                  ${msg("DISCONNECTED", { id: "mcp-group-disconnected" })}
                  <span class="group-count disconnected">${disconnected.length}</span>
                </div>
                <div class="server-list">
                  ${disconnected.map((s) => this._renderStatusServer(s))}
                </div>
              </div>
            `
          : nothing}

        <div class="footer">
          <button
            class="btn-refresh"
            @click=${() => {
              void this._load();
              void this._loadConfig();
            }}
          >
            ↻ ${msg("Refresh", { id: "mcp-btn-refresh" })}
          </button>
        </div>
      </div>

      ${this._renderDialog()} ${this._renderDeleteConfirm()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-mcp": InstanceMcp;
  }
}
