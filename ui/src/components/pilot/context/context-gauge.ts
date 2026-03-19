// ui/src/components/pilot/context/context-gauge.ts
// Token usage bar: used / context window, with compaction threshold marker.
// Also renders the system prompt viewer below the gauge.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../../styles/tokens.js";
import "./context-prompt.js";

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

@localized()
@customElement("cp-pilot-context-gauge")
export class PilotContextGauge extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .gauge-wrap {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .gauge-label-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .gauge-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      .gauge-percent {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        font-weight: 600;
      }

      .gauge-percent.warning {
        color: var(--state-warning);
      }

      .gauge-percent.danger {
        color: var(--state-error);
      }

      /* Bar track */
      .gauge-track {
        position: relative;
        height: 6px;
        background: var(--bg-hover);
        border-radius: 3px;
        overflow: visible;
      }

      .gauge-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease;
        min-width: 2px;
      }

      .gauge-fill.ok {
        background: var(--state-running);
      }

      .gauge-fill.warning {
        background: var(--state-warning);
      }

      .gauge-fill.danger {
        background: var(--state-error);
      }

      /* Threshold marker */
      .threshold-marker {
        position: absolute;
        top: -3px;
        width: 2px;
        height: 12px;
        background: var(--text-muted);
        border-radius: 1px;
        opacity: 0.5;
      }

      .gauge-subtext {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        display: flex;
        justify-content: space-between;
      }
    `,
  ];

  @property({ type: Number }) used = 0;
  @property({ type: Number }) total = 200_000;
  @property({ type: Number }) threshold = 0.85;
  @property({ type: String }) systemPrompt: string | null = null;
  @property({ type: String }) builtAt: string | null = null;

  override render() {
    const pct = this.total > 0 ? Math.min(this.used / this.total, 1) : 0;
    const pctDisplay = Math.round(pct * 100);
    const thresholdPct = this.threshold * 100;

    const fillClass =
      pct >= this.threshold ? "danger" : pct >= this.threshold * 0.75 ? "warning" : "ok";
    const percentClass = fillClass;

    return html`
      <div class="gauge-wrap">
        <div class="gauge-label-row">
          <span class="gauge-title">${msg("Context", { id: "context-gauge-title" })}</span>
          <span class="gauge-percent ${percentClass}">${pctDisplay}%</span>
        </div>

        <div class="gauge-track">
          <div class="gauge-fill ${fillClass}" style="width: ${(pct * 100).toFixed(1)}%"></div>
          <div
            class="threshold-marker"
            style="left: ${thresholdPct.toFixed(1)}%"
            title="${msg("Compaction threshold", { id: "context-gauge-threshold" })}"
          ></div>
        </div>

        <div class="gauge-subtext">
          <span>~${formatK(this.used)} / ${formatK(this.total)}</span>
          <span>⊡ ${thresholdPct.toFixed(0)}%</span>
        </div>
      </div>

      ${this.systemPrompt !== undefined
        ? html`
            <cp-pilot-context-prompt
              .systemPrompt=${this.systemPrompt}
              .builtAt=${this.builtAt}
            ></cp-pilot-context-prompt>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-gauge": PilotContextGauge;
  }
}
