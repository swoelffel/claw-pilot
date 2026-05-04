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
  updateTrigger,
  type CreateTriggerInput,
  type FlowTrigger,
  type InputMappingEntry,
  type UpdateTriggerInput,
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
        background: rgba(0, 0, 0, 0.6);
        z-index: 500;
        font-family: var(--font-ui);
      }
      .panel {
        background: var(--bg-surface);
        color: var(--text-primary);
        max-width: 600px;
        width: 90vw;
        margin: 5vh auto;
        border-radius: var(--radius-lg);
        border: 1px solid var(--bg-border);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .panel-header {
        padding: 20px 24px;
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
      }
      .panel-body {
        padding: 24px;
        overflow: auto;
        flex: 1;
      }
      .panel-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .footer-cluster {
        display: flex;
        gap: 10px;
      }
      label {
        display: block;
        margin-top: 12px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
      }
      input,
      select,
      textarea {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        font-family: var(--font-ui);
        font-size: 13px;
        box-sizing: border-box;
      }
      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--accent);
        outline: none;
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
        background: var(--bg-border);
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
        border: 2px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 12px;
        cursor: pointer;
        text-align: center;
        background: var(--bg-base);
      }
      .kind-card:hover {
        border-color: var(--accent-border);
      }
      .kind-card.selected {
        border-color: var(--accent);
        background: var(--accent-subtle);
      }
      .kind-card.disabled {
        opacity: 0.5;
        pointer-events: none;
        cursor: not-allowed;
      }
      .kind-card .label {
        font-weight: 600;
        color: var(--text-primary);
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
        border-radius: var(--radius-sm);
        font-size: 11px;
        font-weight: 600;
      }
      .owner-readonly {
        font-size: 13px;
        color: var(--text-primary);
        padding: 8px 12px;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
      }
      .empty-flows {
        margin-top: 8px;
        padding: 12px;
        background: var(--bg-base);
        border: 1px dashed var(--bg-border);
        border-radius: var(--radius-md);
        font-size: 13px;
        color: var(--text-secondary);
      }
      .empty-flows a {
        color: var(--accent);
        text-decoration: underline;
      }
      .preview-block {
        margin-top: 12px;
        padding: 10px 12px;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        font-size: 12px;
        color: var(--text-secondary);
      }
      .preview-block .human {
        color: var(--text-primary);
        font-weight: 500;
      }
      .preview-block .cron {
        font-family: var(--font-mono);
        margin-top: 4px;
      }
      .checkbox-row {
        margin-top: 12px;
      }
      .checkbox-row label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 16px;
        margin-bottom: 0;
        text-transform: none;
        letter-spacing: normal;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
      }
      .checkbox-row input[type="checkbox"] {
        width: auto;
        margin: 0;
        padding: 0;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  /** Username to display in the read-only owner row. Optional. */
  @property({ type: String }) currentUsername = "";
  /**
   * When set, the wizard runs in edit mode: kind locked, fields pre-filled
   * from this trigger, Save submits a PATCH instead of a POST. The component
   * detects edit mode purely by the presence of this property.
   */
  @property({ attribute: false }) existingTrigger: FlowTrigger | undefined = undefined;

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

  /** True when editing an existing trigger (vs creating a new one). */
  private get _isEditMode(): boolean {
    return this.existingTrigger !== undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.existingTrigger) {
      this._hydrateFromExisting(this.existingTrigger);
    }
    void this._loadFlows();
  }

  /**
   * Pre-fill all wizard fields from an existing trigger, lock the kind, and
   * jump straight to Step 2 (Step 1 is hidden in edit mode).
   */
  private _hydrateFromExisting(t: FlowTrigger): void {
    this._kind = t.kind;
    this._flowId = String(t.flowId);
    this._name = t.name;
    this._enabled = t.enabled;
    this._allowConcurrent = t.allowConcurrent;
    this._cronExpr = t.cronExpr ?? "0 9 * * *";
    this._cronTz = t.cronTz ?? "Europe/Paris";
    this._webhookSlug = t.webhookSlug ?? "";
    this._mapping = t.inputMapping ?? [];
    this._step = 2;
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
      if (this._isEditMode && this.existingTrigger) {
        // Edit mode — PATCH only the user-editable fields. Kind, flow, owner
        // are locked once a trigger exists.
        const patch: UpdateTriggerInput = {
          name: this._name,
          enabled: this._enabled,
          allowConcurrent: this._allowConcurrent,
        };
        if (this._kind === "cron") {
          patch.cronExpr = this._cronExpr;
          if (this._cronTz) patch.cronTz = this._cronTz;
        } else {
          patch.webhookSlug = this._webhookSlug;
        }
        if (this._mapping.length > 0) patch.inputMapping = this._mapping;
        const updated = await updateTrigger(this.instanceSlug, this.existingTrigger.id, patch);
        this.dispatchEvent(
          new CustomEvent("updated", { detail: updated, bubbles: true, composed: true }),
        );
        return;
      }

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
        ?disabled=${this._isEditMode}
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
              .initialValue=${this._isEditMode ? this._cronExpr : undefined}
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
      <div class="checkbox-row">
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

  /** Lower bound on `_back()` — Step 1 is hidden in edit mode. */
  private _minStep(): number {
    return this._isEditMode ? 2 : 1;
  }

  override render() {
    const editMode = this._isEditMode;
    const headerLabel = editMode
      ? msg("Edit trigger", { id: "wizard-header-edit" })
      : msg("New trigger", { id: "wizard-header-create" });
    const submitLabel = editMode
      ? msg("Save", { id: "btn-wizard-save" })
      : msg("Create", { id: "btn-wizard-create" });
    return html`
      <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
        <div class="panel-header">
          <h2>${headerLabel}</h2>
          <button
            class="btn btn-ghost"
            type="button"
            @click=${this._close}
            aria-label=${msg("Close", { id: "trigger-wiz-close" })}
          >
            ${msg("Close", { id: "trigger-wiz-close" })}
          </button>
        </div>
        <div class="panel-body">
          <div class="step-indicator">
            ${editMode
              ? html`
                  <div class="dot ${this._step >= 2 ? "active" : ""}"></div>
                  <div class="dot ${this._step >= 3 ? "active" : ""}"></div>
                `
              : html`
                  <div class="dot ${this._step >= 1 ? "active" : ""}"></div>
                  <div class="dot ${this._step >= 2 ? "active" : ""}"></div>
                  <div class="dot ${this._step >= 3 ? "active" : ""}"></div>
                `}
          </div>
          ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
          ${this._step === 1 && !editMode ? this._renderStep1() : ""}
          ${this._step === 2 ? this._renderStep2() : ""}
          ${this._step === 3 ? this._renderStep3() : ""}
        </div>
        <div class="panel-footer">
          <button class="btn btn-ghost" type="button" @click=${this._close}>
            ${msg("Cancel", { id: "trigger-wiz-cancel" })}
          </button>
          <div class="footer-cluster">
            ${this._step > this._minStep()
              ? html`<button class="btn btn-ghost" type="button" @click=${this._back}>
                  ${msg("Back", { id: "trigger-wiz-back" })}
                </button>`
              : ""}
            ${this._step < 3
              ? html`<button
                  class="btn btn-primary"
                  type="button"
                  ?disabled=${!this._canAdvance()}
                  @click=${this._next}
                >
                  ${msg("Next", { id: "trigger-wiz-next" })}
                </button>`
              : html`<button
                  class="btn btn-primary"
                  type="button"
                  ?disabled=${this._saving || !this._name || !this._flowId}
                  @click=${this._submit}
                >
                  ${submitLabel}
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
