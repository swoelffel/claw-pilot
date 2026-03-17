// ui/src/components/pilot/pilot-header.ts
// Top bar of the Runtime Pilot: agent name, model, status, cumulative stats, panel toggle.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";

export type PilotStatus = "idle" | "loading" | "sending" | "streaming" | "error";

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

@localized()
@customElement("cp-pilot-header")
export class PilotHeader extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-surface);
        min-height: 44px;
      }

      /* Agent dot */
      .agent-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--accent);
      }

      /* Agent name */
      .agent-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary);
        font-family: var(--font-mono);
        white-space: nowrap;
      }

      .sep {
        color: var(--bg-border);
        font-size: 12px;
        flex-shrink: 0;
      }

      /* Model name */
      .model-name {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }

      /* Status pill */
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 100px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .status-pill.idle {
        background: rgba(16, 185, 129, 0.08);
        color: var(--state-running);
        border: 1px solid rgba(16, 185, 129, 0.2);
      }

      .status-pill.loading,
      .status-pill.sending,
      .status-pill.streaming {
        background: rgba(245, 158, 11, 0.08);
        color: var(--state-warning);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .status-pill.error {
        background: rgba(239, 68, 68, 0.08);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.2);
      }

      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
      }

      .status-dot.pulsing {
        animation: pulse 1.2s ease-in-out infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }

      /* Stats */
      .stats {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: auto;
        flex-shrink: 0;
      }

      .stat {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        white-space: nowrap;
      }

      .stat strong {
        color: var(--text-secondary);
        font-weight: 600;
      }

      /* Panel toggle */
      .panel-toggle {
        padding: 4px 7px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: 13px;
        cursor: pointer;
        transition:
          background 0.12s,
          color 0.12s;
        flex-shrink: 0;
        line-height: 1;
        font-family: var(--font-ui);
      }

      .panel-toggle:hover,
      .panel-toggle.active {
        background: var(--accent-subtle);
        color: var(--accent);
        border-color: var(--accent-border);
      }
    `,
  ];

  @property() agentId = "";
  /** Display name for the agent — falls back to agentId if not set */
  @property() agentName = "";
  @property() model = "";
  @property() status: PilotStatus = "idle";
  @property({ type: Number }) messageCount = 0;
  @property({ type: Number }) totalTokens = 0;
  @property({ type: Number }) totalCost = 0;
  @property() agentColor = "";
  @property({ type: Boolean }) panelOpen = true;

  private _statusLabel(): string {
    const labels: Record<PilotStatus, string> = {
      idle: msg("idle", { id: "pilot-status-idle" }),
      loading: msg("loading", { id: "pilot-status-loading" }),
      sending: msg("sending", { id: "pilot-status-sending" }),
      streaming: msg("streaming", { id: "pilot-status-streaming" }),
      error: msg("error", { id: "pilot-status-error" }),
    };
    return labels[this.status];
  }

  private _isPulsing(): boolean {
    return this.status === "sending" || this.status === "streaming" || this.status === "loading";
  }

  /** Derives a short model display name: "anthropic/claude-sonnet-4-5" → "sonnet-4-5" */
  private _shortModel(): string {
    if (!this.model) return "";
    const slash = this.model.lastIndexOf("/");
    return slash !== -1 ? this.model.slice(slash + 1) : this.model;
  }

  override render() {
    const agentDotStyle = this.agentColor
      ? `background: ${this.agentColor};`
      : "background: var(--accent);";

    return html`
      <div class="header">
        <span class="agent-dot" style="${agentDotStyle}"></span>
        <span class="agent-name">${this.agentName || this.agentId || "—"}</span>

        ${this._shortModel()
          ? html`
              <span class="sep">·</span>
              <span class="model-name" title="${this.model}">${this._shortModel()}</span>
            `
          : nothing}

        <span class="sep">·</span>

        <span class="status-pill ${this.status}">
          <span class="status-dot ${this._isPulsing() ? "pulsing" : ""}"></span>
          ${this._statusLabel()}
        </span>

        <div class="stats">
          ${this.messageCount > 0
            ? html`<span class="stat"><strong>${this.messageCount}</strong> msgs</span>`
            : nothing}
          ${this.totalTokens > 0
            ? html`<span class="stat"><strong>${formatTokens(this.totalTokens)}</strong> tok</span>`
            : nothing}
          ${this.totalCost > 0
            ? html`<span class="stat"><strong>${formatCost(this.totalCost)}</strong></span>`
            : nothing}
        </div>

        <button
          class="panel-toggle ${this.panelOpen ? "active" : ""}"
          title="${this.panelOpen
            ? msg("Hide context panel", { id: "pilot-panel-hide" })
            : msg("Show context panel", { id: "pilot-panel-show" })}"
          @click=${() =>
            this.dispatchEvent(new CustomEvent("toggle-panel", { bubbles: true, composed: true }))}
        >
          ⊞
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-header": PilotHeader;
  }
}
