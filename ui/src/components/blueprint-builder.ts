// ui/src/components/blueprint-builder.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, AgentLink, BlueprintBuilderData, PanelContext } from "../types.js";
import {
  fetchBlueprintBuilder,
  createBlueprintAgent,
  deleteBlueprintAgent,
  updateBlueprintAgentPosition,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { computePositions, newAgentPosition } from "../lib/builder-utils.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import "./agent-card-mini.js";
import "./agent-links-svg.js";
import "./agent-detail-panel.js";

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

  // Create dialog state
  @state() private _newAgentId = "";
  @state() private _newAgentName = "";
  @state() private _newAgentModel = "";
  @state() private _creating = false;
  @state() private _submitError = "";

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
      this._error = userMessage(err);
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
      this._error = userMessage(err);
    }
  }

  private async _createAgent(): Promise<void> {
    if (!this._newAgentId.trim() || !this._newAgentName.trim()) return;
    this._creating = true;
    this._submitError = "";
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
      this._submitError = userMessage(err);
    } finally {
      this._creating = false;
    }
  }

  private get _selectedAgent(): AgentBuilderInfo | null {
    if (!this._data || !this._selectedAgentId) return null;
    return this._data.agents.find(a => a.agent_id === this._selectedAgentId) ?? null;
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

        ${this._selectedAgent ? html`
          <cp-agent-detail-panel
            .agent=${this._selectedAgent}
            .links=${this._data?.links ?? []}
            .allAgents=${this._data?.agents ?? []}
            .context=${{ kind: "blueprint", blueprintId: this.blueprintId } as PanelContext}
            @panel-close=${() => { this._selectedAgentId = null; }}
            @agent-delete-requested=${(e: CustomEvent<{ agentId: string }>) => this._onDeleteRequested(e.detail.agentId)}
            @spawn-links-updated=${(e: CustomEvent<{ links: AgentLink[] }>) => {
              if (this._data) {
                this._data = { ...this._data, links: e.detail.links };
              }
            }}
            @pending-removals-changed=${(e: Event) => {
              this._pendingRemovals = (e as CustomEvent<{ pendingRemovals: Set<string> }>).detail.pendingRemovals;
            }}
            @pending-additions-changed=${(e: Event) => {
              const { agentId, pendingAdditions } = (e as CustomEvent<{ agentId: string; pendingAdditions: Set<string> }>).detail;
              const next = new Map(this._pendingAdditions);
              if (pendingAdditions.size === 0) {
                next.delete(agentId);
              } else {
                next.set(agentId, pendingAdditions);
              }
              this._pendingAdditions = next;
            }}
          ></cp-agent-detail-panel>
        ` : ""}
      </div>

      ${this._showCreateDialog ? html`
        <div class="dialog-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._showCreateDialog = false; }}>
          <div class="dialog">
            <h3 class="dialog-title">${msg("New agent", { id: "ab-btn-add-agent" })}</h3>
            ${this._submitError ? html`<div class="error-banner" style="margin-bottom: 12px;">${this._submitError}</div>` : ""}
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
              <button class="btn-cancel" @click=${() => { this._showCreateDialog = false; this._submitError = ""; }}>
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
