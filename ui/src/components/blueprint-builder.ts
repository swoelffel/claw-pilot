// ui/src/components/blueprint-builder.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, AgentLink, BlueprintBuilderData, AgentFileContent } from "../types.js";
import {
  fetchBlueprintBuilder,
  createBlueprintAgent,
  deleteBlueprintAgent,
  updateBlueprintAgentPosition,
  fetchBlueprintAgentFile,
  updateBlueprintAgentFile,
  updateBlueprintSpawnLinks,
} from "../api.js";
import { computePositions, newAgentPosition } from "../lib/builder-utils.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import "./agent-card-mini.js";
import "./agent-links-svg.js";

type PanelTab = "info" | "files" | "links";

@localized()
@customElement("cp-blueprint-builder")
export class BlueprintBuilder extends LitElement {
  static styles = [tokenStyles, badgeStyles, spinnerStyles, errorBannerStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 56px - 48px);
      background: var(--bg-base);
      overflow: hidden;
    }

    .builder-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--bg-border);
      flex-shrink: 0;
    }

    .btn-back {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      font-family: inherit;
    }

    .btn-back:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }

    .header-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .header-subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }

    .btn-add-agent {
      margin-left: auto;
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      font-family: inherit;
    }

    .btn-add-agent:hover {
      border-color: var(--state-success, #22c55e);
      color: var(--state-success, #22c55e);
      background: color-mix(in srgb, var(--state-success, #22c55e) 8%, transparent);
    }

    .builder-body {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    .canvas-zone {
      position: absolute;
      inset: 0;
      cursor: default;
    }

    .canvas-zone.dragging {
      cursor: grabbing;
      user-select: none;
    }

    .spinner-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(15, 17, 23, 0.5);
      z-index: 20;
      gap: 12px;
    }

    .spinner-label {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .error-banner {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 15;
    }

    .empty-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      gap: 8px;
    }

    .empty-state-title {
      font-size: 16px;
      font-weight: 600;
    }

    .empty-state-sub {
      font-size: 13px;
    }

    /* Detail panel */
    .detail-panel {
      position: absolute;
      top: 0;
      right: 0;
      width: 420px;
      height: 100%;
      background: var(--bg-surface);
      border-left: 1px solid var(--bg-border);
      display: flex;
      flex-direction: column;
      z-index: 10;
    }

    .panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--bg-border);
      flex-shrink: 0;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .panel-agent-name {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .panel-agent-id {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .panel-close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 18px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      transition: color 0.15s;
      font-family: inherit;
      line-height: 1;
    }

    .panel-close-btn:hover {
      color: var(--text-primary);
    }

    .panel-tabs {
      display: flex;
      border-bottom: 1px solid var(--bg-border);
      flex-shrink: 0;
    }

    .panel-tab {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      background: none;
      border-top: none;
      border-left: none;
      border-right: none;
      font-family: inherit;
      transition: color 0.15s, border-color 0.15s;
    }

    .panel-tab:hover { color: var(--text-secondary); }
    .panel-tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .info-item {
      margin-bottom: 12px;
    }

    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 3px;
    }

    .info-value {
      font-size: 13px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      word-break: break-all;
    }

    .file-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    .file-btn {
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 12px;
      font-family: var(--font-mono);
      padding: 6px 10px;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s, color 0.15s;
    }

    .file-btn:hover, .file-btn.active {
      border-color: var(--accent-border);
      color: var(--accent);
    }

    .file-editor {
      margin-top: 8px;
    }

    .file-editor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .file-editor-name {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }

    .file-editor textarea {
      width: 100%;
      min-height: 200px;
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      padding: 8px;
      box-sizing: border-box;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
    }

    .file-editor textarea:focus {
      border-color: var(--accent);
    }

    .btn-save {
      background: var(--accent);
      border: none;
      color: white;
      border-radius: var(--radius-sm);
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
    }

    .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

    .spawn-list {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 10px;
    }

    .spawn-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-border);
      border-radius: 3px;
      padding: 2px 7px;
      font-family: var(--font-mono);
    }

    .spawn-remove {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 10px;
      cursor: pointer;
      padding: 0 1px;
      line-height: 1;
      font-family: inherit;
      transition: color 0.12s;
    }

    .spawn-remove:hover { color: var(--state-error); }

    .spawn-add {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    .spawn-add select {
      flex: 1;
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 12px;
      font-family: inherit;
      padding: 4px 8px;
      outline: none;
    }

    .btn-add-link {
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      color: var(--accent);
      border-radius: var(--radius-sm);
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }

    /* Create agent dialog */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 500;
    }

    .dialog {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: 12px;
      padding: 24px;
      width: 400px;
      max-width: calc(100vw - 32px);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    }

    .dialog-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 0 16px 0;
    }

    .form-group {
      margin-bottom: 14px;
    }

    .form-group label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 5px;
    }

    .form-group input {
      width: 100%;
      background: var(--bg-base);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 13px;
      font-family: inherit;
      padding: 7px 10px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }

    .form-group input:focus { border-color: var(--accent); }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }

    .btn-cancel {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 6px 16px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }

    .btn-create {
      background: var(--accent);
      border: none;
      color: white;
      border-radius: var(--radius-md);
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-create:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-delete-agent {
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.15s, color 0.15s;
      margin-top: 16px;
    }

    .btn-delete-agent:hover {
      border-color: var(--state-error, #ef4444);
      color: var(--state-error, #ef4444);
    }
  `];

  @property({ type: Number }) blueprintId = 0;

  @state() private _data: BlueprintBuilderData | null = null;
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _selectedAgentId: string | null = null;
  @state() private _positions = new Map<string, { x: number; y: number }>();
  @state() private _canvasWidth = 800;
  @state() private _canvasHeight = 600;
  @state() private _pendingRemovals = new Set<string>();
  @state() private _pendingAdditions = new Map<string, Set<string>>();
  @state() private _showCreateDialog = false;
  @state() private _justCreatedAgentId: string | null = null;

  // Panel state
  @state() private _panelTab: PanelTab = "info";
  @state() private _activeFile: string | null = null;
  @state() private _fileContent: AgentFileContent | null = null;
  @state() private _fileLoading = false;
  @state() private _fileSaving = false;
  @state() private _fileEdited = "";
  @state() private _spawnTarget = "";

  // Create dialog state
  @state() private _newAgentId = "";
  @state() private _newAgentName = "";
  @state() private _newAgentModel = "";
  @state() private _creating = false;
  @state() private _createError = "";

  // Drag state — not @state, updated directly during pointer events
  private _drag: {
    agentId: string;
    startX: number;
    startY: number;
    startCardX: number;
    startCardY: number;
    moved: boolean;
  } | null = null;

  private _resizeObserver: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
  }

  override firstUpdated(): void {
    const canvas = this.shadowRoot?.querySelector(".canvas-zone");
    if (canvas) {
      this._resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          this._canvasWidth = entry.contentRect.width;
          this._canvasHeight = entry.contentRect.height;
          this._recomputePositions();
        }
      });
      this._resizeObserver.observe(canvas);
    }
  }

  private _recomputePositions(): void {
    if (!this._data) return;
    this._positions = computePositions(
      this._data.agents,
      this._canvasWidth,
      this._canvasHeight,
      this._positions,
    );
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const data = await fetchBlueprintBuilder(this.blueprintId);
      this._data = data;
      this._recomputePositions();
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load blueprint";
    } finally {
      this._loading = false;
    }
  }

  private _goBack(): void {
    this.dispatchEvent(new CustomEvent("navigate", {
      detail: { view: "blueprints" },
      bubbles: true,
      composed: true,
    }));
  }

  private _selectAgent(agentId: string): void {
    if (this._selectedAgentId === agentId) {
      this._selectedAgentId = null;
      return;
    }
    this._selectedAgentId = agentId;
    this._panelTab = "info";
    this._activeFile = null;
    this._fileContent = null;
    this._fileEdited = "";
    this._pendingRemovals = new Set();
    this._pendingAdditions = new Map();
  }

  private _onPointerDown(e: PointerEvent): void {
    // Identify the card via composedPath
    const card = (e.composedPath() as Element[]).find(
      el => el instanceof Element && el.tagName === "CP-AGENT-CARD-MINI",
    ) as HTMLElement | undefined;
    if (!card) return;

    // If the click originated from the delete button, don't start a drag
    const isDeleteBtn = (e.composedPath() as Element[]).some(
      el => el instanceof Element && el.classList.contains("btn-delete"),
    );
    if (isDeleteBtn) return;

    const agentId = card.dataset["agentId"];
    if (!agentId) return;

    const pos = this._positions.get(agentId);
    if (!pos) return;

    const zone = e.currentTarget as HTMLElement;
    const rect = zone.getBoundingClientRect();

    this._drag = {
      agentId,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      startCardX: pos.x,
      startCardY: pos.y,
      moved: false,
    };

    zone.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._drag) return;

    const zone = e.currentTarget as HTMLElement;
    const rect = zone.getBoundingClientRect();
    const dx = (e.clientX - rect.left) - this._drag.startX;
    const dy = (e.clientY - rect.top) - this._drag.startY;

    if (!this._drag.moved && Math.hypot(dx, dy) >= 5) {
      this._drag.moved = true;
      zone.classList.add("dragging");
    }

    if (this._drag.moved) {
      const next = new Map(this._positions);
      next.set(this._drag.agentId, {
        x: this._drag.startCardX + dx,
        y: this._drag.startCardY + dy,
      });
      this._positions = next;
    }
  }

  private _onPointerUp(e: PointerEvent): void {
    if (!this._drag) return;

    const zone = e.currentTarget as HTMLElement;
    zone.releasePointerCapture(e.pointerId);
    zone.classList.remove("dragging");

    const { agentId, moved } = this._drag;
    this._drag = null;

    if (!moved) {
      // Short click — open/close panel
      this._selectAgent(agentId);
      return;
    }

    // Drag ended — persist position fire-and-forget
    const pos = this._positions.get(agentId);
    if (pos) {
      void updateBlueprintAgentPosition(this.blueprintId, agentId, pos.x, pos.y).catch(err => {
        console.error("Failed to save agent position:", err);
      });
    }
  }

  private _onDeleteRequested(agentId: string): void {
    const agent = this._data?.agents.find(a => a.agent_id === agentId);
    if (!agent || agent.is_default) return;
    void this._deleteAgent(agentId);
  }

  private async _deleteAgent(agentId: string): Promise<void> {
    try {
      const data = await deleteBlueprintAgent(this.blueprintId, agentId);
      if (this._selectedAgentId === agentId) this._selectedAgentId = null;
      const next = new Map(this._positions);
      next.delete(agentId);
      this._positions = next;
      this._data = data;
      this._recomputePositions();
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to delete agent";
    }
  }

  private async _createAgent(): Promise<void> {
    if (!this._newAgentId.trim() || !this._newAgentName.trim()) return;
    this._creating = true;
    this._createError = "";
    try {
      const data = await createBlueprintAgent(this.blueprintId, {
        agent_id: this._newAgentId.trim(),
        name: this._newAgentName.trim(),
        model: this._newAgentModel.trim() || undefined,
      });

      const currentIds = new Set(this._data?.agents.map(a => a.agent_id) ?? []);
      const newAgent = data.agents.find(a => !currentIds.has(a.agent_id)) ?? data.agents.at(-1);

      const positionsWithNew = new Map(this._positions);
      if (newAgent) {
        positionsWithNew.set(newAgent.agent_id, newAgentPosition());
      }

      this._data = data;
      this._positions = computePositions(
        data.agents,
        this._canvasWidth,
        this._canvasHeight,
        positionsWithNew,
      );

      if (newAgent) {
        this._justCreatedAgentId = newAgent.agent_id;
        this._selectedAgentId = newAgent.agent_id;
        setTimeout(() => { this._justCreatedAgentId = null; }, 2000);
      }

      this._showCreateDialog = false;
      this._newAgentId = "";
      this._newAgentName = "";
      this._newAgentModel = "";
    } catch (err) {
      this._createError = err instanceof Error ? err.message : "Failed to create agent";
    } finally {
      this._creating = false;
    }
  }

  private async _loadFile(agentId: string, filename: string): Promise<void> {
    this._activeFile = filename;
    this._fileLoading = true;
    this._fileContent = null;
    this._fileEdited = "";
    try {
      const file = await fetchBlueprintAgentFile(this.blueprintId, agentId, filename);
      this._fileContent = file;
      this._fileEdited = file.content;
    } catch {
      // File doesn't exist yet — start with empty content
      this._fileContent = null;
      this._fileEdited = "";
    } finally {
      this._fileLoading = false;
    }
  }

  private async _saveFile(agentId: string, filename: string): Promise<void> {
    this._fileSaving = true;
    try {
      await updateBlueprintAgentFile(this.blueprintId, agentId, filename, this._fileEdited);
      // Refresh builder data to update file summaries
      const data = await fetchBlueprintBuilder(this.blueprintId);
      this._data = data;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to save file";
    } finally {
      this._fileSaving = false;
    }
  }

  private async _addSpawnLink(agentId: string, targetId: string): Promise<void> {
    if (!targetId) return;
    const currentLinks = this._data?.links ?? [];
    const currentSpawnTargets = currentLinks
      .filter((l: AgentLink) => l.source_agent_id === agentId && l.link_type === "spawn")
      .map((l: AgentLink) => l.target_agent_id);
    if (currentSpawnTargets.includes(targetId)) return;
    const newTargets = [...currentSpawnTargets, targetId];
    try {
      const data = await updateBlueprintSpawnLinks(this.blueprintId, agentId, newTargets);
      this._data = data;
      this._spawnTarget = "";
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to update links";
    }
  }

  private async _removeSpawnLink(agentId: string, targetId: string): Promise<void> {
    const currentLinks = this._data?.links ?? [];
    const newTargets = currentLinks
      .filter((l: AgentLink) => l.source_agent_id === agentId && l.link_type === "spawn" && l.target_agent_id !== targetId)
      .map((l: AgentLink) => l.target_agent_id);
    try {
      const data = await updateBlueprintSpawnLinks(this.blueprintId, agentId, newTargets);
      this._data = data;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to update links";
    }
  }

  private get _selectedAgent(): AgentBuilderInfo | null {
    if (!this._data || !this._selectedAgentId) return null;
    return this._data.agents.find(a => a.agent_id === this._selectedAgentId) ?? null;
  }

  private _renderDetailPanel(agent: AgentBuilderInfo) {
    const links = this._data?.links ?? [];
    const spawnLinks = links.filter((l: AgentLink) => l.source_agent_id === agent.agent_id && l.link_type === "spawn");
    const a2aLinks = links.filter((l: AgentLink) => l.source_agent_id === agent.agent_id && l.link_type === "a2a");
    const otherAgents = this._data?.agents.filter(a => a.agent_id !== agent.agent_id) ?? [];
    const EDITABLE_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md"];

    return html`
      <div class="detail-panel">
        <div class="panel-header">
          <div>
            <div class="panel-agent-name">${agent.name}</div>
            <div class="panel-agent-id">${agent.agent_id}</div>
          </div>
          <button class="panel-close-btn" @click=${() => { this._selectedAgentId = null; }}>✕</button>
        </div>

        <div class="panel-tabs">
          ${(["info", "files", "links"] as PanelTab[]).map(tab => html`
            <button
              class="panel-tab ${this._panelTab === tab ? "active" : ""}"
              @click=${() => { this._panelTab = tab; }}
            >${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
          `)}
        </div>

        <div class="panel-body">
          ${this._panelTab === "info" ? html`
            <div class="info-item">
              <div class="info-label">Workspace</div>
              <div class="info-value">${agent.workspace_path}</div>
            </div>
            ${agent.model ? html`
              <div class="info-item">
                <div class="info-label">Model</div>
                <div class="info-value">${agent.model}</div>
              </div>
            ` : ""}
            ${agent.role ? html`
              <div class="info-item">
                <div class="info-label">Role</div>
                <div class="info-value">${agent.role}</div>
              </div>
            ` : ""}
            ${!agent.is_default ? html`
              <button
                class="btn-delete-agent"
                @click=${() => this._onDeleteRequested(agent.agent_id)}
              >Delete agent</button>
            ` : ""}
          ` : ""}

          ${this._panelTab === "files" ? html`
            <div class="file-list">
              ${EDITABLE_FILES.map(filename => html`
                <button
                  class="file-btn ${this._activeFile === filename ? "active" : ""}"
                  @click=${() => void this._loadFile(agent.agent_id, filename)}
                >${filename}</button>
              `)}
            </div>

            ${this._activeFile ? html`
              <div class="file-editor">
                <div class="file-editor-header">
                  <span class="file-editor-name">${this._activeFile}</span>
                  <button
                    class="btn-save"
                    ?disabled=${this._fileSaving}
                    @click=${() => void this._saveFile(agent.agent_id, this._activeFile!)}
                  >${this._fileSaving ? "Saving…" : "Save"}</button>
                </div>
                ${this._fileLoading ? html`<div class="spinner"></div>` : html`
                  <textarea
                    .value=${this._fileEdited}
                    @input=${(e: Event) => { this._fileEdited = (e.target as HTMLTextAreaElement).value; }}
                    rows="15"
                  ></textarea>
                `}
              </div>
            ` : ""}
          ` : ""}

          ${this._panelTab === "links" ? html`
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Spawn links</div>
            ${spawnLinks.length > 0 ? html`
              <div class="spawn-list">
                ${spawnLinks.map((l: AgentLink) => html`
                  <span class="spawn-badge">
                    ${l.target_agent_id}
                    <button class="spawn-remove" @click=${() => void this._removeSpawnLink(agent.agent_id, l.target_agent_id)}>✕</button>
                  </span>
                `)}
              </div>
            ` : html`<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">No spawn links</div>`}

            ${otherAgents.length > 0 ? html`
              <div class="spawn-add">
                <select
                  .value=${this._spawnTarget}
                  @change=${(e: Event) => { this._spawnTarget = (e.target as HTMLSelectElement).value; }}
                >
                  <option value="">Select agent…</option>
                  ${otherAgents
                    .filter((a: AgentBuilderInfo) => !spawnLinks.some((l: AgentLink) => l.target_agent_id === a.agent_id))
                    .map((a: AgentBuilderInfo) => html`<option value="${a.agent_id}">${a.name} (${a.agent_id})</option>`)}
                </select>
                <button
                  class="btn-add-link"
                  ?disabled=${!this._spawnTarget}
                  @click=${() => void this._addSpawnLink(agent.agent_id, this._spawnTarget)}
                >+ Add</button>
              </div>
            ` : ""}

            ${a2aLinks.length > 0 ? html`
              <div style="font-size: 11px; color: var(--text-muted); margin: 12px 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">A2A links</div>
              <div class="spawn-list">
                ${a2aLinks.map((l: AgentLink) => html`<span class="spawn-badge" style="color: var(--accent);">${l.target_agent_id}</span>`)}
              </div>
            ` : ""}
          ` : ""}
        </div>
      </div>
    `;
  }

  override render() {
    const data = this._data;

    return html`
      <div class="builder-header">
        <button class="btn-back" @click=${this._goBack}>
          ${msg("← Back to Blueprints", { id: "bb-back" })}
        </button>
        <span class="header-title">${data?.blueprint.name ?? "Blueprint"}</span>
        ${data?.blueprint.icon ? html`<span style="font-size: 18px;">${data.blueprint.icon}</span>` : ""}
        <button
          class="btn-add-agent"
          @click=${() => { this._showCreateDialog = true; }}
        >${msg("+ New agent", { id: "ab-btn-add-agent" })}</button>
      </div>

      <div class="builder-body">
        <div class="canvas-zone"
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
        >
          ${this._loading ? html`
            <div class="spinner-overlay">
              <div class="spinner"></div>
              <span class="spinner-label">Loading blueprint…</span>
            </div>
          ` : ""}

          ${this._error ? html`
            <div class="error-banner">${this._error}</div>
          ` : ""}

          ${data && data.agents.length === 0 ? html`
            <div class="empty-state">
              <div class="empty-state-title">${msg("No agents in this blueprint", { id: "bb-no-agents" })}</div>
              <div class="empty-state-sub">${msg("Click \"+ New agent\" to add one.", { id: "bb-no-agents-hint" })}</div>
            </div>
          ` : ""}

          ${data && data.agents.length > 0 ? html`
            <cp-agent-links-svg
              .links=${data.links}
              .positions=${this._positions}
              .pendingRemovals=${this._pendingRemovals}
              .pendingAdditions=${this._pendingAdditions}
            ></cp-agent-links-svg>

            ${(() => {
              const a2aAgentIds = new Set<string>();
              for (const link of data.links) {
                if (link.link_type === "a2a") {
                  a2aAgentIds.add(link.source_agent_id);
                  a2aAgentIds.add(link.target_agent_id);
                }
              }
              return data.agents.map(agent => {
                const pos = this._positions.get(agent.agent_id);
                if (!pos) return "";
                return html`
                  <cp-agent-card-mini
                    data-agent-id=${agent.agent_id}
                    .agent=${agent}
                    .selected=${this._selectedAgentId === agent.agent_id}
                    .isA2A=${a2aAgentIds.has(agent.agent_id)}
                    .isNew=${this._justCreatedAgentId === agent.agent_id}
                    .deletable=${!agent.is_default}
                    style="left: ${pos.x}px; top: ${pos.y}px;"
                    @agent-delete-requested=${(e: CustomEvent<{ agentId: string }>) => this._onDeleteRequested(e.detail.agentId)}
                  ></cp-agent-card-mini>
                `;
              });
            })()}
          ` : ""}
        </div>

        ${this._selectedAgent ? this._renderDetailPanel(this._selectedAgent) : ""}
      </div>

      ${this._showCreateDialog ? html`
        <div class="dialog-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._showCreateDialog = false; }}>
          <div class="dialog">
            <h3 class="dialog-title">${msg("New agent", { id: "ab-btn-add-agent" })}</h3>
            ${this._createError ? html`<div class="error-banner" style="margin-bottom: 12px;">${this._createError}</div>` : ""}
            <div class="form-group">
              <label>Agent ID *</label>
              <input
                type="text"
                .value=${this._newAgentId}
                @input=${(e: Event) => { this._newAgentId = (e.target as HTMLInputElement).value; }}
                placeholder="e.g. researcher, writer"
                autofocus
              />
            </div>
            <div class="form-group">
              <label>Name *</label>
              <input
                type="text"
                .value=${this._newAgentName}
                @input=${(e: Event) => { this._newAgentName = (e.target as HTMLInputElement).value; }}
                placeholder="e.g. Research Agent"
              />
            </div>
            <div class="form-group">
              <label>Model (optional)</label>
              <input
                type="text"
                .value=${this._newAgentModel}
                @input=${(e: Event) => { this._newAgentModel = (e.target as HTMLInputElement).value; }}
                placeholder="e.g. claude-opus-4-5"
              />
            </div>
            <div class="dialog-actions">
              <button class="btn-cancel" @click=${() => { this._showCreateDialog = false; this._createError = ""; }}>
                ${msg("Cancel", { id: "cbd-btn-cancel" })}
              </button>
              <button
                class="btn-create"
                ?disabled=${this._creating || !this._newAgentId.trim() || !this._newAgentName.trim()}
                @click=${() => void this._createAgent()}
              >
                ${this._creating ? html`<div class="spinner" style="width: 12px; height: 12px;"></div>` : ""}
                ${this._creating ? msg("Creating...", { id: "cbd-btn-creating" }) : msg("Create", { id: "cbd-btn-create" })}
              </button>
            </div>
          </div>
        </div>
      ` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-blueprint-builder": BlueprintBuilder;
  }
}
