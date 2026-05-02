// ui/src/components/triggers/cp-trigger-wizard.ts
//
// 3-step wizard dialog to create a new trigger:
//   1. Pick kind (cron / webhook)
//   2. Select instance + flow + owner
//   3. Kind-specific params + input mapping + name + enabled
//
// Emits `created` with the new trigger row, or `cancelled`.

import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, errorBannerStyles } from "../../styles/shared.js";
import { createTrigger, type CreateTriggerInput, type InputMappingEntry } from "../../api.js";
import { userMessage } from "../../lib/error-messages.js";
import "./cp-input-mapping-editor.js";

@localized()
@customElement("cp-trigger-wizard")
export class CpTriggerWizard extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 100;
        font-family: var(--font-ui);
      }
      .panel {
        background: var(--surface);
        color: var(--text-primary);
        max-width: 560px;
        margin: 5vh auto;
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--border);
        max-height: 90vh;
        overflow: auto;
      }
      h2 {
        margin: 0 0 16px;
        font-size: 18px;
      }
      label {
        display: block;
        margin-top: 12px;
        font-size: 13px;
        color: var(--text-secondary);
      }
      input,
      select,
      textarea {
        width: 100%;
        padding: 6px 8px;
        margin-top: 4px;
        background: var(--surface-alt);
        color: var(--text-primary);
        border: 1px solid var(--border);
        border-radius: 4px;
        font-family: var(--font-ui);
        font-size: 13px;
        box-sizing: border-box;
      }
      .actions {
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
        gap: 8px;
      }
      .step-indicator {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
      }
      .dot {
        width: 24px;
        height: 4px;
        border-radius: 2px;
        background: var(--border);
      }
      .dot.active {
        background: var(--accent);
      }
      .kind-pick {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 8px;
      }
      .kind-card {
        border: 2px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        cursor: pointer;
        text-align: center;
      }
      .kind-card.selected {
        border-color: var(--accent);
      }
      .kind-card .label {
        font-weight: 600;
      }
      .kind-card .desc {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 4px;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";

  @state() private _step = 1;
  @state() private _kind: "cron" | "webhook" | "" = "";
  @state() private _instanceSlug = "";
  @state() private _flowId = "";
  @state() private _ownerUserId = "";
  @state() private _name = "";
  @state() private _enabled = true;
  @state() private _allowConcurrent = false;
  @state() private _cronExpr = "0 9 * * *";
  @state() private _cronTz = "Europe/Paris";
  @state() private _webhookSlug = "";
  @state() private _webhookSecret = "";
  @state() private _mapping: InputMappingEntry[] = [];
  @state() private _saving = false;
  @state() private _error = "";

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.instanceSlug) this._instanceSlug = this.instanceSlug;
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("cancelled", { bubbles: true, composed: true }));
  }

  private _next(): void {
    if (this._step < 3) this._step += 1;
  }

  private _back(): void {
    if (this._step > 1) this._step -= 1;
  }

  private async _submit(): Promise<void> {
    if (!this._kind) return;
    this._saving = true;
    this._error = "";
    try {
      const input: CreateTriggerInput = {
        instanceSlug: this._instanceSlug,
        flowId: Number(this._flowId),
        kind: this._kind,
        name: this._name,
        enabled: this._enabled,
        allowConcurrent: this._allowConcurrent,
      };
      if (this._ownerUserId) input.ownerUserId = Number(this._ownerUserId);
      if (this._kind === "cron") {
        input.cronExpr = this._cronExpr;
        if (this._cronTz) input.cronTz = this._cronTz;
      } else {
        input.webhookSlug = this._webhookSlug;
        input.webhookSecret = this._webhookSecret;
      }
      if (this._mapping.length > 0) input.inputMapping = this._mapping;

      const created = await createTrigger(input);
      this.dispatchEvent(
        new CustomEvent("created", { detail: created, bubbles: true, composed: true }),
      );
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  private _renderStep1() {
    return html`
      <p>${msg("Pick the trigger kind:", { id: "trigger-wiz-step1-prompt" })}</p>
      <div class="kind-pick">
        <div
          class="kind-card ${this._kind === "cron" ? "selected" : ""}"
          @click=${() => (this._kind = "cron")}
        >
          <div class="label">${msg("Cron", { id: "trigger-wiz-kind-cron" })}</div>
          <div class="desc">
            ${msg("Periodic schedule (e.g. 09:00 every day)", { id: "trigger-wiz-kind-cron-desc" })}
          </div>
        </div>
        <div
          class="kind-card ${this._kind === "webhook" ? "selected" : ""}"
          @click=${() => (this._kind = "webhook")}
        >
          <div class="label">${msg("Webhook", { id: "trigger-wiz-kind-webhook" })}</div>
          <div class="desc">
            ${msg("HMAC-signed external HTTP call", { id: "trigger-wiz-kind-webhook-desc" })}
          </div>
        </div>
      </div>
    `;
  }

  private _renderStep2() {
    return html`
      <label>${msg("Instance slug", { id: "trigger-wiz-instance" })}</label>
      <input
        type="text"
        .value=${this._instanceSlug}
        @input=${(e: Event) => (this._instanceSlug = (e.target as HTMLInputElement).value)}
      />
      <label>${msg("Flow ID", { id: "trigger-wiz-flow" })}</label>
      <input
        type="number"
        .value=${this._flowId}
        @input=${(e: Event) => (this._flowId = (e.target as HTMLInputElement).value)}
      />
      <label
        >${msg("Owner user ID (optional — falls back to current user)", {
          id: "trigger-wiz-owner",
        })}</label
      >
      <input
        type="number"
        .value=${this._ownerUserId}
        @input=${(e: Event) => (this._ownerUserId = (e.target as HTMLInputElement).value)}
      />
    `;
  }

  private _renderStep3() {
    return html`
      <label>${msg("Trigger name", { id: "trigger-wiz-name" })}</label>
      <input
        type="text"
        .value=${this._name}
        @input=${(e: Event) => (this._name = (e.target as HTMLInputElement).value)}
      />
      ${this._kind === "cron"
        ? html`
            <label>${msg("Cron expression", { id: "trigger-wiz-cron-expr" })}</label>
            <input
              type="text"
              .value=${this._cronExpr}
              @input=${(e: Event) => (this._cronExpr = (e.target as HTMLInputElement).value)}
            />
            <label>${msg("Timezone", { id: "trigger-wiz-cron-tz" })}</label>
            <input
              type="text"
              .value=${this._cronTz}
              @input=${(e: Event) => (this._cronTz = (e.target as HTMLInputElement).value)}
            />
          `
        : html`
            <label>${msg("Webhook slug (a-z 0-9 -)", { id: "trigger-wiz-webhook-slug" })}</label>
            <input
              type="text"
              .value=${this._webhookSlug}
              @input=${(e: Event) => (this._webhookSlug = (e.target as HTMLInputElement).value)}
            />
            <label
              >${msg("Webhook shared secret (HMAC)", {
                id: "trigger-wiz-webhook-secret",
              })}</label
            >
            <input
              type="text"
              .value=${this._webhookSecret}
              @input=${(e: Event) => (this._webhookSecret = (e.target as HTMLInputElement).value)}
            />
          `}
      <label>${msg("Input mapping (optional)", { id: "trigger-wiz-mapping" })}</label>
      <cp-input-mapping-editor
        .value=${this._mapping}
        @change=${(e: CustomEvent<InputMappingEntry[]>) => (this._mapping = e.detail)}
      ></cp-input-mapping-editor>
      <label>
        <input
          type="checkbox"
          .checked=${this._enabled}
          @change=${(e: Event) => (this._enabled = (e.target as HTMLInputElement).checked)}
        />
        ${msg("Enabled", { id: "trigger-wiz-enabled" })}
      </label>
      <label>
        <input
          type="checkbox"
          .checked=${this._allowConcurrent}
          @change=${(e: Event) => (this._allowConcurrent = (e.target as HTMLInputElement).checked)}
        />
        ${msg("Allow concurrent runs", { id: "trigger-wiz-concurrent" })}
      </label>
    `;
  }

  override render() {
    return html`
      <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
        <h2>${msg("New trigger", { id: "trigger-wiz-title" })}</h2>
        <div class="step-indicator">
          <div class="dot ${this._step >= 1 ? "active" : ""}"></div>
          <div class="dot ${this._step >= 2 ? "active" : ""}"></div>
          <div class="dot ${this._step >= 3 ? "active" : ""}"></div>
        </div>
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
        ${this._step === 1 ? this._renderStep1() : ""}
        ${this._step === 2 ? this._renderStep2() : ""}
        ${this._step === 3 ? this._renderStep3() : ""}
        <div class="actions">
          <button class="btn" type="button" @click=${this._close}>
            ${msg("Cancel", { id: "trigger-wiz-cancel" })}
          </button>
          <div>
            ${this._step > 1
              ? html`<button class="btn" type="button" @click=${this._back}>
                  ${msg("Back", { id: "trigger-wiz-back" })}
                </button>`
              : ""}
            ${this._step < 3
              ? html`<button
                  class="btn primary"
                  type="button"
                  ?disabled=${this._step === 1 && !this._kind}
                  @click=${this._next}
                >
                  ${msg("Next", { id: "trigger-wiz-next" })}
                </button>`
              : html`<button
                  class="btn primary"
                  type="button"
                  ?disabled=${this._saving || !this._name}
                  @click=${this._submit}
                >
                  ${msg("Create", { id: "trigger-wiz-create" })}
                </button>`}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-trigger-wizard": CpTriggerWizard;
  }
}
