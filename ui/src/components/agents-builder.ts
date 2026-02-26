// ui/src/components/agents-builder.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, BuilderData } from "../types.js";
import { syncAgents, fetchBuilderData, updateAgentPosition } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import "./delete-agent-dialog.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import "./agent-card-mini.js";
import "./agent-links-svg.js";
import "./agent-detail-panel.js";
import "./create-agent-dialog.js";
import { computePositions, newAgentPosition } from "../lib/builder-utils.js";

@localized()
@customElement("cp-agents-builder")
export class AgentsBuilder extends LitElement {
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

    .header-slug {
      font-size: 13px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .btn-sync {
      background: var(--accent-subtle);
      border: 1px solid var(--accent-border);
      color: var(--accent);
      border-radius: var(--radius-md);
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }

    .btn-sync:hover:not(:disabled) {
      background: rgba(79, 110, 247, 0.15);
    }

    .btn-sync:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
  `];

  @property({ type: String }) slug = "";

  @state() private _data: BuilderData | null = null;
  @state() private _syncing = false;
  @state() private _error = "";
  @state() private _selectedAgentId: string | null = null;
  @state() private _positions = new Map<string, { x: number; y: number }>();
  @state() private _canvasWidth = 800;
  @state() private _canvasHeight = 600;
  @state() private _pendingRemovals = new Set<string>();
  @state() private _pendingAdditions = new Map<string, Set<string>>();
  @state() private _showCreateDialog = false;
  @state() private _justCreatedAgentId: string | null = null;
  @state() private _agentToDelete: AgentBuilderInfo | null = null;

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
    void this._syncAndLoad();
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

  private async _syncAndLoad(): Promise<void> {
    this._syncing = true;
    this._error = "";
    try {
      await syncAgents(this.slug);
      const data = await fetchBuilderData(this.slug);
      this._data = data;
      this._recomputePositions();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._syncing = false;
    }
  }

  private _goBack(): void {
    this.dispatchEvent(new CustomEvent("navigate", {
      detail: { slug: null },
      bubbles: true,
      composed: true,
    }));
  }

  private _selectAgent(agentId: string): void {
    this._selectedAgentId = this._selectedAgentId === agentId ? null : agentId;
  }

  private _onAgentCreated(builderData: BuilderData): void {
    this._showCreateDialog = false;
    // Identify the new agent — find agent_id present in builderData but not in current data
    const currentAgentIds = new Set(this._data?.agents.map(a => a.agent_id) ?? []);
    const newAgent = builderData.agents.find(a => !currentAgentIds.has(a.agent_id))
      ?? builderData.agents.at(-1)
      ?? null;

    // Pre-inject a top-left position for the new agent so computePositions
    // picks it up from in-memory (priority 1) instead of falling back to concentric
    const positionsWithNew = new Map(this._positions);
    if (newAgent) {
      positionsWithNew.set(newAgent.agent_id, newAgentPosition());
    }

    this._data = builderData;
    this._positions = computePositions(
      builderData.agents,
      this._canvasWidth,
      this._canvasHeight,
      positionsWithNew,
    );

    if (newAgent) {
      this._justCreatedAgentId = newAgent.agent_id;
      this._selectedAgentId = newAgent.agent_id;
      setTimeout(() => { this._justCreatedAgentId = null; }, 2000);
    }
  }

  private _onDeleteRequested(agentId: string): void {
    const agent = this._data?.agents.find(a => a.agent_id === agentId) ?? null;
    if (agent && !agent.is_default) {
      this._agentToDelete = agent;
    }
  }

  private _onAgentDeleted(builderData: BuilderData): void {
    const deletedId = this._agentToDelete?.agent_id;
    this._agentToDelete = null;

    // Reset selection if the deleted agent was selected
    if (deletedId && this._selectedAgentId === deletedId) {
      this._selectedAgentId = null;
    }

    // Remove position from in-memory map
    if (deletedId) {
      const next = new Map(this._positions);
      next.delete(deletedId);
      this._positions = next;
    }

    // Update data and recompute positions
    this._data = builderData;
    this._positions = computePositions(
      builderData.agents,
      this._canvasWidth,
      this._canvasHeight,
      this._positions,
    );
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
      void updateAgentPosition(this.slug, agentId, pos.x, pos.y).catch(err => {
        console.error("Failed to save agent position:", err);
      });
    }
  }

  private get _selectedAgent(): AgentBuilderInfo | null {
    if (!this._data || !this._selectedAgentId) return null;
    return this._data.agents.find(a => a.agent_id === this._selectedAgentId) ?? null;
  }

  override render() {
    const data = this._data;
    const inst = data?.instance;

    return html`
      <div class="builder-header">
        <button class="btn-back" aria-label="Retour" @click=${this._goBack}>${msg("← Back", { id: "ab-btn-back" })}</button>
        <span class="header-title">${msg("Agents Builder", { id: "ab-title" })}</span>
        ${inst ? html`
          <span class="header-slug">${inst.slug}</span>
          <span class="badge ${inst.state}">${inst.state}</span>
        ` : ""}
        <button
          class="btn-add-agent"
          aria-label="New agent"
          @click=${() => { this._showCreateDialog = true; }}
        >${msg("+ New agent", { id: "ab-btn-add-agent" })}</button>
        <button
          class="btn-sync"
          aria-label="Synchroniser"
          ?disabled=${this._syncing}
          @click=${() => void this._syncAndLoad()}
        >${msg("↻ Sync", { id: "ab-btn-sync" })}</button>
      </div>

      <div class="builder-body">
        <div class="canvas-zone"
          @pointerdown=${this._onPointerDown}
          @pointermove=${this._onPointerMove}
          @pointerup=${this._onPointerUp}
          @pointercancel=${this._onPointerUp}
        >
          ${this._syncing ? html`
            <div class="spinner-overlay">
              <div class="spinner"></div>
              <span class="spinner-label">${msg("Syncing agents…", { id: "ab-syncing" })}</span>
            </div>
          ` : ""}

          ${this._error ? html`
            <div class="error-banner">${this._error}</div>
          ` : ""}

          ${data && data.agents.length === 0 ? html`
            <div class="empty-state">
              <div class="empty-state-title">${msg("No agents found", { id: "ab-empty-title" })}</div>
              <div class="empty-state-sub">${msg("Click Sync to refresh from disk", { id: "ab-empty-sub" })}</div>
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
            .links=${data?.links ?? []}
            .allAgents=${data?.agents ?? []}
            .context=${{ kind: "instance", slug: this.slug }}
            @panel-close=${() => { this._selectedAgentId = null; this._pendingAdditions = new Map(); this._pendingRemovals = new Set(); }}
            @agent-delete-requested=${(e: CustomEvent<{ agentId: string }>) => this._onDeleteRequested(e.detail.agentId)}
            @spawn-links-updated=${() => { this._pendingAdditions = new Map(); void this._syncAndLoad(); }}
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
        <cp-create-agent-dialog
          .slug=${this.slug}
          .existingAgentIds=${this._data?.agents.map(a => a.agent_id) ?? []}
          @close-dialog=${() => { this._showCreateDialog = false; }}
          @agent-created=${(e: CustomEvent<BuilderData>) => this._onAgentCreated(e.detail)}
        ></cp-create-agent-dialog>
      ` : ""}

      ${this._agentToDelete ? html`
        <cp-delete-agent-dialog
          .instanceSlug=${this.slug}
          .agent=${this._agentToDelete}
          @close-dialog=${() => { this._agentToDelete = null; }}
          @agent-deleted=${(e: CustomEvent<BuilderData>) => this._onAgentDeleted(e.detail)}
        ></cp-delete-agent-dialog>
      ` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agents-builder": AgentsBuilder;
  }
}
