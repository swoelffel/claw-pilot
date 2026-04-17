import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

@localized()
@customElement("cp-dashboard-pilot")
export class DashboardPilot extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        height: 100%;
        min-height: 400px;
      }
      .pilot-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-3);
        border-bottom: 1px solid var(--bg-border);
      }
      .pilot-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        cursor: pointer;
      }
      .pilot-label:hover {
        color: var(--accent);
      }
      .pilot-body {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        font-size: 13px;
      }
    `,
  ];

  @property({ type: String }) slug = "";

  override render() {
    return html`
      <div class="pilot-header">
        <span
          class="pilot-label"
          @click=${() => {
            this.dispatchEvent(
              new CustomEvent("navigate", {
                detail: { view: "pilot", slug: this.slug },
                bubbles: true,
                composed: true,
              }),
            );
          }}
          >${msg("Pilot", { id: "dashboard-pilot-title" })} →</span
        >
      </div>
      <div class="pilot-body">${msg("Loading pilot…", { id: "dashboard-pilot-loading" })}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-dashboard-pilot": DashboardPilot;
  }
}
