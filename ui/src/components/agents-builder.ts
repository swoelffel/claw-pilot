// ui/src/components/agents-builder.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBuilderInfo, BuilderData } from "../types.js";
import { syncAgents, fetchBuilderData } from "../api.js";
import "./agent-card-mini.js";
import "./agent-links-svg.js";
import "./agent-detail-panel.js";

function computePositions(
  agents: AgentBuilderInfo[],
  canvasWidth: number,
  canvasHeight: number,
): Map<string, { x: number; y: number }> {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const positions = new Map<string, { x: number; y: number }>();

  const mainAgent = agents.find(a => a.is_default);
  if (mainAgent) {
    positions.set(mainAgent.agent_id, { x: centerX, y: centerY });
  }

  const others = agents.filter(a => !a.is_default);
  if (others.length === 0) return positions;

  const radius = Math.min(canvasWidth, canvasHeight) * 0.35;
  const angleStep = (2 * Math.PI) / others.length;
  const startAngle = -Math.PI / 2;

  others.forEach((agent, i) => {
    const angle = startAngle + i * angleStep;
    positions.set(agent.agent_id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positions;
}

@localized()
@customElement("cp-agents-builder")
export class AgentsBuilder extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 56px - 48px);
      background: #0f1117;
      overflow: hidden;
    }

    .builder-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: #1a1d27;
      border-bottom: 1px solid #2a2d3a;
      flex-shrink: 0;
    }

    .btn-back {
      background: none;
      border: 1px solid #2a2d3a;
      color: #94a3b8;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      font-family: inherit;
    }

    .btn-back:hover {
      border-color: #6c63ff;
      color: #e2e8f0;
    }

    .header-title {
      font-size: 15px;
      font-weight: 600;
      color: #e2e8f0;
    }

    .header-slug {
      font-size: 13px;
      color: #4a5568;
      font-family: "Fira Mono", monospace;
    }

    .state-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .state-badge.running {
      background: #10b98120;
      color: #10b981;
      border: 1px solid #10b98140;
    }

    .state-badge.stopped {
      background: #64748b20;
      color: #64748b;
      border: 1px solid #64748b40;
    }

    .state-badge.error, .state-badge.unknown {
      background: #f59e0b20;
      color: #f59e0b;
      border: 1px solid #f59e0b40;
    }

    .btn-sync {
      margin-left: auto;
      background: #6c63ff20;
      border: 1px solid #6c63ff40;
      color: #6c63ff;
      border-radius: 6px;
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }

    .btn-sync:hover:not(:disabled) {
      background: #6c63ff30;
    }

    .btn-sync:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .builder-body {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    .canvas-zone {
      position: absolute;
      inset: 0;
    }

    .spinner-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0f111780;
      z-index: 20;
      gap: 12px;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #2a2d3a;
      border-top-color: #6c63ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner-label {
      font-size: 13px;
      color: #94a3b8;
    }

    .error-banner {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #ef444420;
      border: 1px solid #ef444440;
      color: #ef4444;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      z-index: 15;
    }

    .empty-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #4a5568;
      gap: 8px;
    }

    .empty-state-title {
      font-size: 16px;
      font-weight: 600;
    }

    .empty-state-sub {
      font-size: 13px;
    }
  `;

  @property({ type: String }) slug = "";

  @state() private _data: BuilderData | null = null;
  @state() private _syncing = false;
  @state() private _error = "";
  @state() private _selectedAgentId: string | null = null;
  @state() private _positions = new Map<string, { x: number; y: number }>();
  @state() private _canvasWidth = 800;
  @state() private _canvasHeight = 600;

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
    this._positions = computePositions(this._data.agents, this._canvasWidth, this._canvasHeight);
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
      this._error = err instanceof Error ? err.message : msg("Failed to load agents", { id: "ab-error-load" });
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

  private get _selectedAgent(): AgentBuilderInfo | null {
    if (!this._data || !this._selectedAgentId) return null;
    return this._data.agents.find(a => a.agent_id === this._selectedAgentId) ?? null;
  }

  override render() {
    const data = this._data;
    const inst = data?.instance;

    return html`
      <div class="builder-header">
        <button class="btn-back" @click=${this._goBack}>${msg("← Back", { id: "ab-btn-back" })}</button>
        <span class="header-title">${msg("Agents Builder", { id: "ab-title" })}</span>
        ${inst ? html`
          <span class="header-slug">${inst.slug}</span>
          <span class="state-badge ${inst.state}">${inst.state}</span>
        ` : ""}
        <button
          class="btn-sync"
          ?disabled=${this._syncing}
          @click=${() => void this._syncAndLoad()}
        >${msg("↻ Sync", { id: "ab-btn-sync" })}</button>
      </div>

      <div class="builder-body">
        <div class="canvas-zone">
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
                    .agent=${agent}
                    .selected=${this._selectedAgentId === agent.agent_id}
                    .isA2A=${a2aAgentIds.has(agent.agent_id)}
                    style="left: ${pos.x}px; top: ${pos.y}px;"
                    @agent-select=${(e: Event) => this._selectAgent((e as CustomEvent<{ agentId: string }>).detail.agentId)}
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
            .slug=${this.slug}
            @panel-close=${() => { this._selectedAgentId = null; }}
            @spawn-links-updated=${() => void this._syncAndLoad()}
          ></cp-agent-detail-panel>
        ` : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agents-builder": AgentsBuilder;
  }
}
