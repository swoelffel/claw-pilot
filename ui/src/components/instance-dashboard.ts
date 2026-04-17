import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";

@localized()
@customElement("cp-instance-dashboard")
export class InstanceDashboard extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1200px;
        margin: 0 auto;
      }
    `,
  ];

  @property({ type: String }) slug = "";

  override render() {
    return html`<div>${msg("Dashboard", { id: "dashboard-title" })} — ${this.slug}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-dashboard": InstanceDashboard;
  }
}
