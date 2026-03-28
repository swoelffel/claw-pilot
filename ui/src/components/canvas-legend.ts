// ui/src/components/canvas-legend.ts
import { LitElement, html, css, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

const STORAGE_KEY = "cp-canvas-legend-collapsed";

@localized()
@customElement("cp-canvas-legend")
export class CanvasLegend extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        position: absolute;
        bottom: 12px;
        left: 12px;
        z-index: 10;
        pointer-events: auto;
      }

      .legend {
        background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 6px 12px;
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 10px;
        color: var(--text-muted);
        backdrop-filter: blur(4px);
      }

      .legend.collapsed {
        padding: 4px 8px;
        gap: 0;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .toggle-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
        padding: 2px;
        line-height: 1;
        opacity: 0.7;
      }

      .toggle-btn:hover {
        opacity: 1;
      }
    `,
  ];

  @state() private _collapsed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    try {
      this._collapsed = localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      /* intentionally ignored — localStorage may be unavailable */
    }
  }

  private _toggle(): void {
    this._collapsed = !this._collapsed;
    try {
      localStorage.setItem(STORAGE_KEY, String(this._collapsed));
    } catch {
      /* intentionally ignored */
    }
  }

  override render() {
    if (this._collapsed) {
      return html`
        <div class="legend collapsed">
          <button
            class="toggle-btn"
            title=${msg("Show legend", { id: "legend-show" })}
            @click=${this._toggle}
          >
            ◧
          </button>
        </div>
      `;
    }

    return html`
      <div class="legend">
        <div class="legend-item">
          <svg width="36" height="10">
            ${svg`
              <defs>
                <marker id="leg-arrow-del" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#666" />
                </marker>
              </defs>
              <line x1="0" y1="5" x2="30" y2="5" stroke="#666" stroke-width="1" stroke-dasharray="2 3" marker-end="url(#leg-arrow-del)" />
            `}
          </svg>
          ${msg("Delegation", { id: "legend-delegation" })}
        </div>
        <div class="legend-item">
          <svg width="30" height="10">
            ${svg`<line x1="0" y1="5" x2="28" y2="5" stroke="#64748b" stroke-width="1.5" stroke-dasharray="6 4" />`}
          </svg>
          ${msg("Messaging", { id: "legend-messaging" })}
        </div>
        <button
          class="toggle-btn"
          title=${msg("Hide legend", { id: "legend-hide" })}
          @click=${this._toggle}
        >
          ✕
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-canvas-legend": CanvasLegend;
  }
}
