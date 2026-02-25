// ui/src/components/agent-detail-panel.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, AgentLink, AgentFileContent } from "../types.js";
import { fetchAgentFile, updateSpawnLinks } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles } from "../styles/shared.js";

const EDITABLE_FILES = new Set(["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md"]);

@localized()
@customElement("cp-agent-detail-panel")
export class AgentDetailPanel extends LitElement {
  static styles = [tokenStyles, sectionLabelStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 0;
      right: 0;
      width: 420px;
      height: 100%;
      background: var(--bg-surface);
      border-left: 1px solid var(--bg-border);
      overflow: hidden;
      z-index: 10;
      transition: width 0.25s ease;
    }

    :host(.expanded) {
      width: 100%;
      border-left: none;
    }

    .panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--bg-border);
      flex-shrink: 0;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .panel-header-info {
      flex: 1;
      min-width: 0;
    }

    .panel-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .panel-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 14px;
      cursor: pointer;
      padding: 4px 7px;
      border-radius: var(--radius-sm);
      transition: color 0.15s, background 0.15s;
      line-height: 1;
    }

    .panel-btn:hover {
      color: var(--text-primary);
      background: var(--bg-border);
    }

    /* row 1 : name + slug */
    .agent-name-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 3px;
      min-width: 0;
    }

    .agent-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .agent-id-label {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* row 2 : role (optional) */
    .agent-role-label {
      font-size: 11px;
      color: var(--text-muted);
      font-style: italic;
      margin-bottom: 2px;
    }

    /* row 3 : badges */
    .agent-meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .badge-default {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--accent);
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      border-radius: 3px;
      padding: 1px 5px;
    }

    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--bg-border);
      overflow-x: auto;
      flex-shrink: 0;
      scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tab {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      transition: color 0.15s, border-color 0.15s;
      background: none;
      border-top: none;
      border-left: none;
      border-right: none;
      font-family: inherit;
    }

    .tab:hover {
      color: var(--text-secondary);
    }

    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .panel-body.has-save-bar {
      padding-bottom: 52px;
    }

    .info-row {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
    }

    .info-value {
      font-size: 13px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      word-break: break-all;
    }

    .links-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 4px;
    }

    .link-badge {
      font-size: 10px;
      color: var(--text-secondary);
      background: var(--bg-border);
      border-radius: 3px;
      padding: 2px 7px;
      font-family: var(--font-mono);
    }

    .link-badge.a2a {
      color: var(--accent);
      background: var(--accent-subtle);
    }

    .link-badge.spawn {
      color: var(--text-secondary);
    }

    .link-badge.spawn-editable {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: default;
    }

    .link-badge.spawn-editable.pending-removal {
      text-decoration: line-through;
      opacity: 0.45;
    }

    .spawn-remove-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 10px;
      cursor: pointer;
      padding: 0 1px;
      line-height: 1;
      border-radius: 2px;
      transition: color 0.12s;
      font-family: inherit;
    }

    .spawn-remove-btn:hover {
      color: var(--state-error);
    }

    .pending-removal .spawn-remove-btn {
      color: var(--accent);
    }

    .pending-removal .spawn-remove-btn:hover {
      color: var(--accent-hover);
    }

    .spawn-save-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      background: var(--bg-surface);
      border-top: 1px solid var(--bg-border);
      z-index: 5;
    }

    .btn-save-spawn {
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      color: var(--accent);
      border-radius: 5px;
      padding: 5px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }

    .btn-save-spawn:hover:not(:disabled) {
      background: rgba(79, 110, 247, 0.15);
    }

    .btn-save-spawn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .save-hint {
      font-size: 10px;
      color: var(--text-muted);
      flex: 1;
    }

    .btn-cancel-spawn {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--state-stopped);
      border-radius: 5px;
      padding: 5px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      font-family: inherit;
    }

    .btn-cancel-spawn:hover {
      border-color: var(--state-error);
      color: var(--state-error);
    }

    .file-content {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      padding: 12px;
      margin: 0;
      overflow-x: auto;
    }

    .file-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      margin-bottom: 10px;
    }

    .badge-editable {
      color: var(--state-running);
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 3px;
      padding: 1px 6px;
    }

    .badge-readonly {
      color: var(--text-muted);
      background: var(--bg-border);
      border-radius: 3px;
      padding: 1px 6px;
    }

    .loading-text {
      color: var(--text-muted);
      font-size: 13px;
      font-style: italic;
    }

    .notes-text {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      font-style: italic;
    }

    .spawn-add-wrap {
      position: relative;
      display: inline-block;
    }

    .spawn-add-btn {
      background: none;
      border: 1px dashed var(--bg-border);
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 3px;
      line-height: 1.4;
      transition: border-color 0.12s, color 0.12s;
      font-family: inherit;
    }

    .spawn-add-btn:hover {
      border-color: var(--accent-border);
      color: var(--accent);
    }

    .spawn-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      background: var(--bg-hover);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      min-width: 140px;
      z-index: 20;
      box-shadow: 0 4px 16px rgba(0,0,0,0.375);
      overflow: hidden;
    }

    .spawn-dropdown-item {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 11px;
      font-family: var(--font-mono);
      padding: 7px 12px;
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
    }

    .spawn-dropdown-item:hover {
      background: var(--accent-subtle);
      color: var(--text-primary);
    }

    .link-badge.spawn-pending-add {
      color: var(--state-running);
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .link-badge.spawn-pending-add .spawn-remove-btn {
      color: var(--text-muted);
    }

    .link-badge.spawn-pending-add .spawn-remove-btn:hover {
      color: var(--state-error);
    }
  `];

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Array }) links: AgentLink[] = [];
  @property({ type: Array }) allAgents: AgentBuilderInfo[] = [];
  @property({ type: String }) slug = "";

  @state() private _activeTab = "info";
  @state() private _fileCache = new Map<string, AgentFileContent>();
  @state() private _loadingFile = false;
  @state() private _expanded = false;
  @state() private _pendingRemovals = new Set<string>();
  @state() private _pendingAdditions = new Set<string>();
  @state() private _dropdownOpen = false;
  @state() private _saving = false;

  private async _loadFile(filename: string): Promise<void> {
    if (this._fileCache.has(filename)) return;
    this._loadingFile = true;
    try {
      const content = await fetchAgentFile(this.slug, this.agent.agent_id, filename);
      this._fileCache = new Map(this._fileCache).set(filename, content);
    } catch {
      // Ignore — file may not be synced yet
    } finally {
      this._loadingFile = false;
    }
  }

  private _selectTab(tab: string): void {
    this._activeTab = tab;
    if (tab !== "info") {
      void this._loadFile(tab);
    }
  }

  private _toggleExpand(): void {
    this._expanded = !this._expanded;
    if (this._expanded) {
      this.classList.add("expanded");
    } else {
      this.classList.remove("expanded");
    }
  }

  // Reset tab and pending state when agent changes
  override updated(changed: Map<string, unknown>): void {
    if (changed.has("agent")) {
      this._activeTab = "info";
      this._fileCache = new Map();
      this._pendingRemovals = new Set();
      this._pendingAdditions = new Set();
      this._dropdownOpen = false;
    }
  }

  private _resolveModel(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return (parsed["primary"] as string | undefined) ?? raw;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private _emitPendingAdditions(additions: Set<string>): void {
    this.dispatchEvent(new CustomEvent("pending-additions-changed", {
      detail: { agentId: this.agent.agent_id, pendingAdditions: new Set(additions) },
      bubbles: true,
      composed: true,
    }));
  }

  private _cancelPendingChanges(): void {
    this._pendingRemovals = new Set();
    this._pendingAdditions = new Set();
    this._dropdownOpen = false;
    this.dispatchEvent(new CustomEvent("pending-removals-changed", {
      detail: { pendingRemovals: new Set() },
      bubbles: true,
      composed: true,
    }));
    this._emitPendingAdditions(new Set());
  }

  private _addSpawnLink(targetId: string): void {
    const next = new Set(this._pendingAdditions).add(targetId);
    this._pendingAdditions = next;
    this._dropdownOpen = false;
    this._emitPendingAdditions(next);
  }

  private _cancelAddition(targetId: string): void {
    const next = new Set(this._pendingAdditions);
    next.delete(targetId);
    this._pendingAdditions = next;
    this._emitPendingAdditions(next);
  }

  private _toggleSpawnRemoval(targetId: string): void {
    const next = new Set(this._pendingRemovals);
    if (next.has(targetId)) {
      next.delete(targetId);
    } else {
      next.add(targetId);
    }
    this._pendingRemovals = next;
    this.dispatchEvent(new CustomEvent("pending-removals-changed", {
      detail: { pendingRemovals: new Set(next) },
      bubbles: true,
      composed: true,
    }));
  }

  private async _saveSpawnLinks(spawnLinks: { target_agent_id: string }[]): Promise<void> {
    this._saving = true;
    try {
      const remaining = spawnLinks
        .map(l => l.target_agent_id)
        .filter(id => !this._pendingRemovals.has(id));
      const added = Array.from(this._pendingAdditions);
      const targets = [...new Set([...remaining, ...added])];
      const result = await updateSpawnLinks(this.slug, this.agent.agent_id, targets);
      this._pendingRemovals = new Set();
      this._pendingAdditions = new Set();
      this._dropdownOpen = false;
      // Notify canvas: no more pending removals/additions
      this.dispatchEvent(new CustomEvent("pending-removals-changed", {
        detail: { pendingRemovals: new Set() },
        bubbles: true,
        composed: true,
      }));
      this._emitPendingAdditions(new Set());
      // Propagate updated links to parent (agents-builder will re-fetch)
      this.dispatchEvent(new CustomEvent("spawn-links-updated", {
        detail: { links: result.links },
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      console.error("Failed to save spawn links:", err);
    } finally {
      this._saving = false;
    }
  }

  private _renderInfo() {
    const a = this.agent;
    const a2aLinks = this.links.filter(l =>
      l.link_type === "a2a" && (l.source_agent_id === a.agent_id || l.target_agent_id === a.agent_id)
    );
    const spawnLinks = this.links.filter(l =>
      l.link_type === "spawn" && l.source_agent_id === a.agent_id
    );
    const receivedSpawn = this.links.filter(l =>
      l.link_type === "spawn" && l.target_agent_id === a.agent_id
    );

    return html`
      <div class="info-row">
        ${a.model ? html`
          <div class="info-item">
            <span class="info-label">${msg("Model", { id: "adp-label-model" })}</span>
            <span class="info-value">${this._resolveModel(a.model)}</span>
          </div>
        ` : ""}
        <div class="info-item">
          <span class="info-label">${msg("Workspace", { id: "adp-label-workspace" })}</span>
          <span class="info-value">${a.workspace_path}</span>
        </div>
        ${a.synced_at ? html`
          <div class="info-item">
            <span class="info-label">${msg("Last sync", { id: "adp-label-last-sync" })}</span>
            <span class="info-value">${a.synced_at}</span>
          </div>
        ` : ""}
        ${a2aLinks.length > 0 ? html`
          <div class="info-item">
            <span class="info-label">${msg("A2A links (bidirectional)", { id: "adp-label-a2a" })}</span>
            <div class="links-list">
              ${a2aLinks.map(l => {
                const peer = l.source_agent_id === a.agent_id ? l.target_agent_id : l.source_agent_id;
                return html`<span class="link-badge a2a">↔ ${peer}</span>`;
              })}
            </div>
          </div>
        ` : ""}
        ${(() => {
          // Agents already linked as spawn targets (from saved state)
          const linkedIds = new Set(spawnLinks.map(l => l.target_agent_id));
          // Available agents: all agents except self, already linked, and pending additions
          const availableAgents = this.allAgents.filter(ag =>
            ag.agent_id !== a.agent_id &&
            !linkedIds.has(ag.agent_id) &&
            !this._pendingAdditions.has(ag.agent_id)
          );
          const hasSpawnSection = spawnLinks.length > 0 || this._pendingAdditions.size > 0 || availableAgents.length > 0;
          if (!hasSpawnSection) return "";
          return html`
            <div class="info-item">
              <span class="info-label">${msg("Can spawn", { id: "adp-label-can-spawn" })}</span>
              <div class="links-list">
                ${spawnLinks.map(l => {
                  const isPending = this._pendingRemovals.has(l.target_agent_id);
                  return html`
                    <span class="link-badge spawn spawn-editable ${isPending ? "pending-removal" : ""}">
                      → ${l.target_agent_id}
                      <button
                        class="spawn-remove-btn"
                        title=${isPending ? "Restore" : "Remove"}
                        @click=${() => this._toggleSpawnRemoval(l.target_agent_id)}
                      >${isPending ? "↩" : "✕"}</button>
                    </span>
                  `;
                })}
                ${Array.from(this._pendingAdditions).map(id => html`
                  <span class="link-badge spawn spawn-editable spawn-pending-add">
                    → ${id}
                    <button
                      class="spawn-remove-btn"
                      title="Cancel"
                      @click=${() => this._cancelAddition(id)}
                    >✕</button>
                  </span>
                `)}
                ${availableAgents.length > 0 ? html`
                  <div class="spawn-add-wrap">
                    <button
                      class="spawn-add-btn"
                      title=${msg("Add agent", { id: "adp-btn-add-spawn" })}
                      @click=${() => { this._dropdownOpen = !this._dropdownOpen; }}
                    >＋</button>
                    ${this._dropdownOpen ? html`
                      <div class="spawn-dropdown">
                        ${availableAgents.map(ag => html`
                          <button
                            class="spawn-dropdown-item"
                            @click=${() => this._addSpawnLink(ag.agent_id)}
                          >${ag.agent_id}</button>
                        `)}
                      </div>
                    ` : ""}
                  </div>
                ` : ""}
              </div>
            </div>
          `;
        })()}
        ${receivedSpawn.length > 0 ? html`
          <div class="info-item">
            <span class="info-label">${msg("Spawned by", { id: "adp-label-spawned-by" })}</span>
            <div class="links-list">
              ${receivedSpawn.map(l => html`<span class="link-badge spawn">← ${l.source_agent_id}</span>`)}
            </div>
          </div>
        ` : ""}
        ${a.notes ? html`
          <div class="info-item">
            <span class="info-label">${msg("Notes", { id: "adp-label-notes" })}</span>
            <p class="notes-text">${a.notes}</p>
          </div>
        ` : ""}
      </div>
    `;
  }

  private _renderFileTab(filename: string) {
    const cached = this._fileCache.get(filename);
    const isEditable = EDITABLE_FILES.has(filename);

    if (this._loadingFile && !cached) {
      return html`<p class="loading-text">${msg("Loading", { id: "adp-loading-file" })} ${filename}…</p>`;
    }

    if (!cached) {
      return html`<p class="loading-text">${msg("File not available.", { id: "adp-file-not-available" })}</p>`;
    }

    return html`
      <div class="file-badge">
        <span class="${isEditable ? "badge-editable" : "badge-readonly"}">
          ${isEditable
            ? msg("editable", { id: "adp-badge-editable" })
            : msg("read-only", { id: "adp-badge-readonly" })}
        </span>
      </div>
      <pre class="file-content">${cached.content}</pre>
    `;
  }

  override render() {
    const a = this.agent;
    const fileTabs = a.files.map(f => f.filename);
    const spawnLinks = this.links.filter(l =>
      l.link_type === "spawn" && l.source_agent_id === a.agent_id
    );

    return html`
      <div class="panel-header">
        <div class="panel-header-info">
          <div class="agent-name-row">
            <span class="agent-name">${a.name}</span>
            <span class="agent-id-label">${a.agent_id}</span>
          </div>
          ${a.role ? html`<div class="agent-role-label">${a.role}</div>` : ""}
        </div>
        <div class="panel-controls">
          <button
            class="panel-btn"
            aria-label=${this._expanded ? msg("Collapse", { id: "adp-btn-collapse" }) : msg("Expand", { id: "adp-btn-expand" })}
            title=${this._expanded ? msg("Collapse", { id: "adp-btn-collapse" }) : msg("Expand", { id: "adp-btn-expand" })}
            @click=${this._toggleExpand}
          >${this._expanded ? "⊟" : "⊞"}</button>
          <button
            class="panel-btn"
            aria-label="Fermer"
            title=${msg("Close", { id: "adp-btn-close" })}
            @click=${() => this.dispatchEvent(new CustomEvent("panel-close", { bubbles: true, composed: true }))}
          >✕</button>
        </div>
      </div>

      <div class="tabs">
        <button
          class="tab ${this._activeTab === "info" ? "active" : ""}"
          @click=${() => this._selectTab("info")}
        >${msg("Info", { id: "adp-tab-info" })}</button>
        ${fileTabs.map(f => html`
          <button
            class="tab ${this._activeTab === f ? "active" : ""}"
            @click=${() => this._selectTab(f)}
          >${f}</button>
        `)}
      </div>

      <div class="panel-body ${(this._pendingRemovals.size > 0 || this._pendingAdditions.size > 0) ? "has-save-bar" : ""}">
        ${this._activeTab === "info"
          ? this._renderInfo()
          : this._renderFileTab(this._activeTab)}
      </div>

      ${(this._pendingRemovals.size > 0 || this._pendingAdditions.size > 0) ? html`
        <div class="spawn-save-bar">
          <button
            class="btn-save-spawn"
            ?disabled=${this._saving}
            @click=${() => void this._saveSpawnLinks(spawnLinks)}
          >${this._saving
            ? msg("Saving...", { id: "adp-saving" })
            : msg("Save", { id: "adp-btn-save" })}</button>
          <span class="save-hint">${this._pendingRemovals.size + this._pendingAdditions.size} change${(this._pendingRemovals.size + this._pendingAdditions.size) > 1 ? "s" : ""} pending</span>
          <button
            class="btn-cancel-spawn"
            ?disabled=${this._saving}
            @click=${this._cancelPendingChanges}
          >${msg("Cancel", { id: "adp-btn-cancel-spawn" })}</button>
        </div>
      ` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-detail-panel": AgentDetailPanel;
  }
}
