// ui/src/components/triggers/cp-trigger-wizard.ts
//
// 3-step wizard dialog to create a new trigger:
//   1. Pick kind — Cron is the only enabled choice in v1; Webhook is dimmed
//      with a "Coming soon" pill (TRIGGER-001b ships cron only end-to-end).
//   2. Flow + owner — instance slug is implicit (passed in as a property),
//      Flow is a dropdown sourced from the instance's flows, owner is auto-
//      bound to the current session user (single-user CE assumption).
//   3. Schedule + name + flags — uses `cp-cron-picker` with a mode switcher
//      between visual "Set Interval" and raw "Cron Expression". A live preview
//      (human-readable + compiled cron) is shown at the bottom.
//
// Emits `created` with the new trigger row, or `cancelled`.

import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, errorBannerStyles } from "../../styles/shared.js";
import {
  createTrigger,
  listFlows,
  type CreateTriggerInput,
  type InputMappingEntry,
} from "../../api.js";
import type { FlowDefinitionWithLastRun } from "../../types.js";
import { userMessage } from "../../lib/error-messages.js";
import "./cp-input-mapping-editor.js";
import "./cp-cron-picker.js";

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
        max-width: 600px;
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
        position: relative;
        border: 2px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        cursor: pointer;
        text-align: center;
      }
      .kind-card.selected {
        border-color: var(--accent);
      }
      .kind-card.disabled {
        opacity: 0.5;
        pointer-events: none;
        cursor: not-allowed;
      }
      .kind-card .label {
        font-weight: 600;
      }
      .kind-card .desc {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: 4px;
      }
      .pill {
        display: inline-block;
        padding: 2px 8px;
        margin-top: 6px;
        background: var(--state-info);
        color: #fff;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
      }
      .owner-readonly {
        margin-top: 4px;
        font-size: 13px;
        color: var(--text-primary);
        padding: 6px 8px;
        background: var(--surface-alt);
        border: 1px solid var(--border);
        border-radius: 4px;
      }
      .empty-flows {
        margin-top: 8px;
        padding: 8px;
        background: var(--surface-alt);
        border: 1px dashed var(--border);
        border-radius: 4px;
        font-size: 13px;
        color: var(--text-secondary);
      }
      .empty-flows a {
        color: var(--accent);
        text-decoration: underline;
      }
      .preview-block {
        margin-top: 12px;
        padding: 8px 10px;
        background: var(--surface-alt);
        border-radius: 4px;
        font-size: 12px;
        color: var(--text-secondary);
      }
      .preview-block .human {
        color: var(--text-primary);
        font-weight: 500;
      }
      .preview-block .cron {
        font-family: var(--font-mono, monospace);
        margin-top: 4px;
      }
      .checkbox-row label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 16px;
      }
      .checkbox-row input[type="checkbox"] {
        width: auto;
        margin: 0;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  /** Username to display in the read-only owner row. Optional. */
  @property({ type: String }) currentUsername = "";

  @state() private _step = 1;
  @state() private _kind: "cron" | "webhook" | "" = "";
  @state() private _flowId = "";
  @state() private _name = "";
  @state() private _enabled = true;
  @state() private _allowConcurrent = false;
  @state() private _cronExpr = "0 9 * * *";
  @state() private _cronHuman = "Runs every day at 09:00";
  @state() private _cronTz = "Europe/Paris";
  @state() private _webhookSlug = "";
  @state() private _webhookSecret = "";
  @state() private _mapping: InputMappingEntry[] = [];
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _flows: FlowDefinitionWithLastRun[] = [];
  @state() private _flowsLoading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadFlows();
  }

  private async _loadFlows(): Promise<void> {
    if (!this.instanceSlug) return;
    this._flowsLoading = true;
    try {
      this._flows = await listFlows(this.instanceSlug);
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._flowsLoading = false;
    }
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
        flowId: Number(this._flowId),
        kind: this._kind,
        name: this._name,
        enabled: this._enabled,
        allowConcurrent: this._allowConcurrent,
      };
      if (this._kind === "cron") {
        // Always submit the compiled cron expression, never the structured
        // interval state — the backend stores a single canonical cronExpr.
        input.cronExpr = this._cronExpr;
        if (this._cronTz) input.cronTz = this._cronTz;
      } else {
        // Webhook branch is unreachable while step 1 forces cron, but the
        // payload is preserved for forward-compat once webhook is re-enabled.
        input.webhookSlug = this._webhookSlug;
        input.webhookSecret = this._webhookSecret;
      }
      if (this._mapping.length > 0) input.inputMapping = this._mapping;

      const created = await createTrigger(this.instanceSlug, input);
      this.dispatchEvent(
        new CustomEvent("created", { detail: created, bubbles: true, composed: true }),
      );
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  private _onCronChange(e: CustomEvent<{ cron: string; humanReadable: string }>): void {
    this._cronExpr = e.detail.cron;
    this._cronHuman = e.detail.humanReadable;
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  private _renderStep1() {
    const webhookTooltip = msg(
      "Webhook triggers will land in a future release — use Cron for now.",
      { id: "trigger-wiz-webhook-tooltip" },
    );
    return html`
      <p>${msg("Pick the trigger kind:", { id: "trigger-wiz-step1-prompt" })}</p>
      <div class="kind-pick">
        <div
          class="kind-card ${this._kind === "cron" ? "selected" : ""}"
          @click=${() => (this._kind = "cron")}
        >
          <div class="label">${msg("Cron", { id: "trigger-wiz-kind-cron" })}</div>
          <div class="desc">
            ${msg("Periodic schedule (e.g. 09:00 every day)", {
              id: "trigger-wiz-kind-cron-desc",
            })}
          </div>
        </div>
        <div class="kind-card disabled" aria-disabled="true" title=${webhookTooltip}>
          <div class="label">${msg("Webhook", { id: "trigger-wiz-kind-webhook" })}</div>
          <div class="desc">
            ${msg("HMAC-signed external HTTP call", { id: "trigger-wiz-kind-webhook-desc" })}
          </div>
          <div class="pill">${msg("Coming soon", { id: "trigger-wiz-coming-soon" })}</div>
        </div>
      </div>
    `;
  }

  private _renderFlowDropdown() {
    if (this._flowsLoading) {
      return html`<div class="empty-flows">
        ${msg("Loading flows...", { id: "trigger-wiz-flows-loading" })}
      </div>`;
    }
    if (this._flows.length === 0) {
      return html`<div class="empty-flows">
        ${msg("This instance has no flows yet — create one first", {
          id: "trigger-wiz-flows-empty",
        })}
        <a href=${`#/instances/${this.instanceSlug}/flows`}>
          ${msg("Open flows", { id: "trigger-wiz-flows-link" })}
        </a>
      </div>`;
    }
    const sorted = [...this._flows].sort((a, b) => a.name.localeCompare(b.name));
    return html`
      <select
        .value=${this._flowId}
        @change=${(e: Event) => (this._flowId = (e.target as HTMLSelectElement).value)}
      >
        <option value="" disabled ?selected=${!this._flowId}>
          ${msg("— select a flow —", { id: "trigger-wiz-flow-placeholder" })}
        </option>
        ${sorted.map((f) => {
          const disabled = f.enabled === 0;
          const label = `${f.name} (#${f.id})${disabled ? " (disabled)" : ""}`;
          return html`<option value=${String(f.id)} ?disabled=${disabled}>${label}</option>`;
        })}
      </select>
    `;
  }

  private _renderStep2() {
    const ownerLabel = this.currentUsername
      ? `${this.currentUsername} (you)`
      : msg("Current user", { id: "trigger-wiz-owner-fallback" });
    return html`
      <label>${msg("Flow", { id: "trigger-wiz-flow" })}</label>
      ${this._renderFlowDropdown()}
      <label>${msg("Owner", { id: "trigger-wiz-owner" })}</label>
      <div class="owner-readonly">
        ${msg("Owner: ", { id: "trigger-wiz-owner-prefix" })}${ownerLabel}
      </div>
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
            <label>${msg("Schedule", { id: "trigger-wiz-schedule" })}</label>
            <cp-cron-picker
              .value=${this._cronExpr}
              .timezone=${this._cronTz}
              @change=${(e: CustomEvent<{ cron: string; humanReadable: string }>) =>
                this._onCronChange(e)}
            ></cp-cron-picker>
            <label>${msg("Timezone", { id: "trigger-wiz-cron-tz" })}</label>
            <input
              type="text"
              .value=${this._cronTz}
              @input=${(e: Event) => (this._cronTz = (e.target as HTMLInputElement).value)}
            />
            <div class="preview-block">
              <div class="human">${this._cronHuman} ${this._cronTz}</div>
              <div class="cron">cron: ${this._cronExpr}</div>
            </div>
          `
        : html`
            <!--
              Webhook branch — unreachable in v1 (step 1 forces cron). Kept
              identical to the v1 layout so it lights up automatically once
              webhook is re-enabled.
            -->
            <label>${msg("Webhook slug (a-z 0-9 -)", { id: "trigger-wiz-webhook-slug" })}</label>
            <input
              type="text"
              .value=${this._webhookSlug}
              @input=${(e: Event) => (this._webhookSlug = (e.target as HTMLInputElement).value)}
            />
            <label>
              ${msg("Webhook shared secret (HMAC)", { id: "trigger-wiz-webhook-secret" })}
            </label>
            <input
              type="text"
              .value=${this._webhookSecret}
              @input=${(e: Event) => (this._webhookSecret = (e.target as HTMLInputElement).value)}
            />
            <label>${msg("Input mapping (optional)", { id: "trigger-wiz-mapping" })}</label>
            <cp-input-mapping-editor
              .value=${this._mapping}
              @change=${(e: CustomEvent<InputMappingEntry[]>) => (this._mapping = e.detail)}
            ></cp-input-mapping-editor>
          `}
      <div class="checkbox-row" style="margin-top: 12px;">
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
            @change=${(e: Event) =>
              (this._allowConcurrent = (e.target as HTMLInputElement).checked)}
          />
          ${msg("Allow concurrent runs", { id: "trigger-wiz-concurrent" })}
        </label>
      </div>
    `;
  }

  private _canAdvance(): boolean {
    if (this._step === 1) return this._kind === "cron";
    if (this._step === 2) return this._flowId !== "";
    return false;
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
                  ?disabled=${!this._canAdvance()}
                  @click=${this._next}
                >
                  ${msg("Next", { id: "trigger-wiz-next" })}
                </button>`
              : html`<button
                  class="btn primary"
                  type="button"
                  ?disabled=${this._saving || !this._name || !this._flowId}
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
