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
        padding: var(--space-6);
        font-family: var(--font-ui);
      }
      header.section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
      }
      h1.title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }
      .count {
        margin-left: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-muted);
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";

  @state() private _triggers: FlowTrigger[] = [];
  @state() private _error = "";
  @state() private _wizardOpen = false;
  @state() private _wizardEditTarget: FlowTrigger | null = null;
  @state() private _drawerOpen = false;
  @state() private _drawerTargetId: number | null = null;

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

  private _closeWizard(): void {
    this._wizardOpen = false;
    this._wizardEditTarget = null;
  }

  private _onWizCreated(e: Event): void {
    const t = (e as CustomEvent<FlowTrigger>).detail;
    this._triggers = [...this._triggers, t];
    this._closeWizard();
  }

  private _onWizUpdated(e: Event): void {
    const t = (e as CustomEvent<FlowTrigger>).detail;
    this._triggers = this._triggers.map((x) => (x.id === t.id ? t : x));
    this._closeWizard();
  }

  private _onUpdated(e: Event): void {
    const t = (e as CustomEvent<FlowTrigger>).detail;
    this._triggers = this._triggers.map((x) => (x.id === t.id ? t : x));
  }

  private _onEdit(e: CustomEvent<{ trigger: FlowTrigger }>): void {
    this._wizardEditTarget = e.detail.trigger;
    this._wizardOpen = true;
  }

  private _onHistory(e: CustomEvent<{ id: number }>): void {
    this._drawerTargetId = e.detail.id;
    this._drawerOpen = true;
  }

  private _closeDrawer(): void {
    this._drawerOpen = false;
    this._drawerTargetId = null;
  }

  private _onDeleted(e: Event): void {
    const { id } = (e as CustomEvent<{ id: number }>).detail;
    this._triggers = this._triggers.filter((x) => x.id !== id);
    if (this._drawerTargetId === id) this._closeDrawer();
  }

  override render() {
    return html`
      <header class="section-header">
        <h1 class="title">
          ${msg("Triggers", { id: "trigger-page-title" })}
          <span class="count">${this._triggers.length}</span>
        </h1>
        <button
          class="btn btn-primary"
          type="button"
          @click=${() => {
            this._wizardEditTarget = null;
            this._wizardOpen = true;
          }}
        >
          ${msg("+ New trigger", { id: "trigger-page-new" })}
        </button>
      </header>
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
      <cp-trigger-list
        .instanceSlug=${this.instanceSlug}
        .triggers=${this._triggers}
        @trigger-edit=${this._onEdit}
        @trigger-history=${this._onHistory}
        @trigger-updated=${this._onUpdated}
        @trigger-deleted=${this._onDeleted}
      ></cp-trigger-list>
      ${this._wizardOpen
        ? html`<cp-trigger-wizard
            .instanceSlug=${this.instanceSlug}
            .existingTrigger=${this._wizardEditTarget ?? undefined}
            @created=${this._onWizCreated}
            @updated=${this._onWizUpdated}
            @cancelled=${this._closeWizard}
          ></cp-trigger-wizard>`
        : ""}
      ${this._drawerOpen && this._drawerTargetId !== null
        ? html`<cp-trigger-detail
            .instanceSlug=${this.instanceSlug}
            .triggerId=${this._drawerTargetId}
            @close=${this._closeDrawer}
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
