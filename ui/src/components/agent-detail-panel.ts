// ui/src/components/agent-detail-panel.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, AgentLink, AgentFileContent } from "../types.js";
import { fetchAgentFile } from "../api.js";

const EDITABLE_FILES = new Set(["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md"]);

@localized()
@customElement("cp-agent-detail-panel")
export class AgentDetailPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      top: 0;
      right: 0;
      width: 420px;
      height: 100%;
      background: #1a1d27;
      border-left: 1px solid #2a2d3a;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 10;
    }

    .panel-header {
      padding: 16px 20px;
      border-bottom: 1px solid #2a2d3a;
      flex-shrink: 0;
    }

    .panel-close {
      position: absolute;
      top: 12px;
      right: 16px;
      background: none;
      border: none;
      color: #4a5568;
      font-size: 18px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }

    .panel-close:hover {
      color: #e2e8f0;
      background: #2a2d3a;
    }

    .agent-name {
      font-size: 16px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 4px;
      padding-right: 32px;
    }

    .agent-meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .agent-id-label {
      font-size: 11px;
      color: #4a5568;
      font-family: "Fira Mono", monospace;
    }

    .badge-default {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #6c63ff;
      background: #6c63ff20;
      border: 1px solid #6c63ff40;
      border-radius: 3px;
      padding: 1px 5px;
    }

    .badge-role {
      font-size: 10px;
      font-weight: 600;
      color: #0ea5e9;
      background: #0ea5e920;
      border: 1px solid #0ea5e940;
      border-radius: 3px;
      padding: 1px 6px;
    }

    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #2a2d3a;
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
      color: #4a5568;
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
      color: #94a3b8;
    }

    .tab.active {
      color: #6c63ff;
      border-bottom-color: #6c63ff;
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
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
      color: #4a5568;
    }

    .info-value {
      font-size: 13px;
      color: #94a3b8;
      font-family: "Fira Mono", monospace;
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
      color: #94a3b8;
      background: #2a2d3a;
      border-radius: 3px;
      padding: 2px 7px;
      font-family: "Fira Mono", monospace;
    }

    .link-badge.a2a {
      color: #6c63ff;
      background: #6c63ff15;
    }

    .link-badge.spawn {
      color: #94a3b8;
    }

    .file-content {
      font-family: "Fira Mono", monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #94a3b8;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0f1117;
      border: 1px solid #2a2d3a;
      border-radius: 6px;
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
      color: #10b981;
      background: #10b98115;
      border: 1px solid #10b98130;
      border-radius: 3px;
      padding: 1px 6px;
    }

    .badge-readonly {
      color: #4a5568;
      background: #2a2d3a;
      border-radius: 3px;
      padding: 1px 6px;
    }

    .loading-text {
      color: #4a5568;
      font-size: 13px;
      font-style: italic;
    }

    .notes-text {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
      font-style: italic;
    }
  `;

  @property({ type: Object }) agent!: AgentBuilderInfo;
  @property({ type: Array }) links: AgentLink[] = [];
  @property({ type: String }) slug = "";

  @state() private _activeTab = "info";
  @state() private _fileCache = new Map<string, AgentFileContent>();
  @state() private _loadingFile = false;

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

  // Reset tab when agent changes
  override updated(changed: Map<string, unknown>): void {
    if (changed.has("agent")) {
      this._activeTab = "info";
      this._fileCache = new Map();
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
            <span class="info-value">${a.model}</span>
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
        ${spawnLinks.length > 0 ? html`
          <div class="info-item">
            <span class="info-label">${msg("Can spawn", { id: "adp-label-can-spawn" })}</span>
            <div class="links-list">
              ${spawnLinks.map(l => html`<span class="link-badge spawn">→ ${l.target_agent_id}</span>`)}
            </div>
          </div>
        ` : ""}
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

    return html`
      <div class="panel-header">
        <button class="panel-close" @click=${() => this.dispatchEvent(new CustomEvent("panel-close", { bubbles: true, composed: true }))}>✕</button>
        <div class="agent-name">${a.name}</div>
        <div class="agent-meta-row">
          <span class="agent-id-label">${a.agent_id}</span>
          ${a.is_default ? html`<span class="badge-default">${msg("Default", { id: "acm-badge-default" })}</span>` : ""}
          ${a.role ? html`<span class="badge-role">${a.role}</span>` : ""}
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

      <div class="panel-body">
        ${this._activeTab === "info"
          ? this._renderInfo()
          : this._renderFileTab(this._activeTab)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-detail-panel": AgentDetailPanel;
  }
}
