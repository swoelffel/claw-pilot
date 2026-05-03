// ui/src/components/triggers/cp-triggers-view.ts
//
// Instance-scoped "Triggers" tab. Hosts the list, the create wizard, and the
// detail drawer for a single instance's triggers.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, sectionLabelStyles, errorBannerStyles } from "../../styles/shared.js";
import { listTriggers, type FlowTrigger } from "../../api.js";
import { userMessage } from "../../lib/error-messages.js";
import "./cp-trigger-list.js";
import "./cp-trigger-wizard.js";
import "./cp-trigger-detail.js";

@localized()
@customElement("cp-triggers-view")
export class CpTriggersView extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    sectionLabelStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        padding: 16px;
        font-family: var(--font-ui);
      }
      header.section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      h1 {
        margin: 0;
        font-size: 22px;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";

  @state() private _triggers: FlowTrigger[] = [];
  @state() private _error = "";
  @state() private _showWizard = false;
  @state() private _detailId: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("instanceSlug")) void this._load();
  }

  private async _load(): Promise<void> {
    if (!this.instanceSlug) return;
    try {
      this._triggers = await listTriggers(this.instanceSlug);
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _onWizCreated(e: Event): void {
    const t = (e as CustomEvent<FlowTrigger>).detail;
    this._triggers = [...this._triggers, t];
    this._showWizard = false;
  }

  private _onUpdated(e: Event): void {
    const t = (e as CustomEvent<FlowTrigger>).detail;
    this._triggers = this._triggers.map((x) => (x.id === t.id ? t : x));
  }

  private _onDeleted(e: Event): void {
    const { id } = (e as CustomEvent<{ id: number }>).detail;
    this._triggers = this._triggers.filter((x) => x.id !== id);
    if (this._detailId === id) this._detailId = null;
  }

  override render() {
    return html`
      <header class="section-header">
        <h1>${msg("Triggers", { id: "trigger-page-title" })}</h1>
        <button class="btn primary" type="button" @click=${() => (this._showWizard = true)}>
          ${msg("New trigger", { id: "trigger-page-new" })}
        </button>
      </header>
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
      <cp-trigger-list
        .instanceSlug=${this.instanceSlug}
        .triggers=${this._triggers}
        @trigger-open=${(e: CustomEvent<{ id: number }>) => (this._detailId = e.detail.id)}
        @trigger-updated=${this._onUpdated}
        @trigger-deleted=${this._onDeleted}
        @trigger-fired=${() => void this._load()}
      ></cp-trigger-list>
      ${this._showWizard
        ? html`<cp-trigger-wizard
            .instanceSlug=${this.instanceSlug}
            @created=${this._onWizCreated}
            @cancelled=${() => (this._showWizard = false)}
          ></cp-trigger-wizard>`
        : ""}
      ${this._detailId !== null
        ? html`<cp-trigger-detail
            .instanceSlug=${this.instanceSlug}
            .triggerId=${this._detailId}
            @close=${() => (this._detailId = null)}
          ></cp-trigger-detail>`
        : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-triggers-view": CpTriggersView;
  }
}
