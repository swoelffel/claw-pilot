// ui/src/components/flow-editor.ts
//
// Dialog component for creating and editing flow definitions.
// Create mode: flowId is undefined. Edit mode: flowId is set.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { DialogMixin } from "../lib/dialog-mixin.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import {
  sectionLabelStyles,
  spinnerStyles,
  errorBannerStyles,
  buttonStyles,
} from "../styles/shared.js";

// --- Types ---

interface FlowStep {
  id: string;
  agentId: string;
  prompt: string;
  dependencies: string;
  timeout: number;
  retries: number;
  _advancedOpen: boolean;
}

type TriggerType = "manual" | "bus";

interface FlowPayload {
  name: string;
  description: string;
  triggerType: TriggerType;
  steps: Array<{
    id: string;
    agentId: string;
    prompt: string;
    dependencies: string[];
    timeout: number;
    retries: number;
  }>;
}

interface FlowResponse extends FlowPayload {
  flowId: number;
}

// --- Helpers ---

let _stepCounter = 0;

function createEmptyStep(): FlowStep {
  _stepCounter += 1;
  return {
    id: `step-${_stepCounter}`,
    agentId: "",
    prompt: "",
    dependencies: "",
    timeout: 60,
    retries: 0,
    _advancedOpen: false,
  };
}

// --- Component ---

@localized()
@customElement("cp-flow-editor")
export class FlowEditor extends DialogMixin(LitElement) {
  static override styles = [
    tokenStyles,
    sectionLabelStyles,
    spinnerStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 100;
        display: flex;
        justify-content: center;
        padding: 0;
      }

      .dialog {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 640px;
        max-height: 80vh;
        margin: 60px auto 0;
        overflow-y: auto;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid var(--bg-border);
      }

      .dialog-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--state-stopped);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 4px;
        border-radius: var(--radius-sm);
        transition: color 0.15s;
      }
      .close-btn:hover {
        color: var(--text-primary);
      }

      .dialog-body {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      label {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
      }

      input[type="text"],
      input[type="number"],
      select,
      textarea {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 14px;
        padding: 8px 12px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.15s;
        font-family: inherit;
      }
      input[type="text"]:focus,
      input[type="number"]:focus,
      select:focus,
      textarea:focus {
        border-color: var(--accent);
      }

      textarea {
        resize: vertical;
        min-height: 60px;
      }

      .field-hint {
        font-size: 11px;
        color: var(--text-muted);
      }

      .divider {
        border: none;
        border-top: 1px solid var(--bg-border);
        margin: 0;
      }

      /* --- Step cards --- */

      .steps-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .step-card {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: relative;
      }

      .step-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .step-number {
        font-size: 11px;
        font-weight: 600;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .remove-step-btn {
        background: none;
        border: none;
        color: var(--state-stopped);
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        transition: color 0.15s;
      }
      .remove-step-btn:hover {
        color: var(--state-error);
      }

      .advanced-toggle {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
        padding: 4px 0;
        text-align: left;
        transition: color 0.15s;
      }
      .advanced-toggle:hover {
        color: var(--text-secondary);
      }

      .advanced-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 4px;
      }

      .spinner-overlay {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 48px 24px;
        color: var(--text-secondary);
        font-size: 14px;
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 24px 20px;
        border-top: 1px solid var(--bg-border);
      }

      .btn-add-step {
        background: transparent;
        color: var(--accent);
        border: 1px dashed var(--accent);
        border-radius: var(--radius-md);
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background 0.15s,
          border-color 0.15s;
        font-family: var(--font-ui);
      }
      .btn-add-step:hover {
        background: rgba(99, 102, 241, 0.08);
      }
    `,
  ];

  /** Instance slug — required. */
  @property({ type: String }) slug = "";

  /** Flow ID — undefined = create mode, number = edit mode. */
  @property({ type: Number }) flowId?: number;

  // --- Internal state ---

  @state() private _name = "";
  @state() private _description = "";
  @state() private _steps: FlowStep[] = [createEmptyStep()];
  @state() private _triggerType: TriggerType = "manual";
  @state() private _saving = false;
  @state() private _loading = false;
  @state() private _error = "";

  // --- Lifecycle ---

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.flowId !== undefined) {
      void this._loadFlow();
    }
  }

  // --- Data fetching ---

  private async _loadFlow(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const res = await fetch(`/api/instances/${this.slug}/flows/${this.flowId}`, {
        headers: {
          Authorization: `Bearer ${this._getToken()}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          message = body.error ?? res.statusText;
        } catch {
          // Not JSON — keep statusText
        }
        throw new Error(message);
      }
      const flow = (await res.json()) as FlowResponse;
      this._name = flow.name;
      this._description = flow.description ?? "";
      this._triggerType = flow.triggerType ?? "manual";
      this._steps = flow.steps.map((s, i) => ({
        id: s.id ?? `step-${i + 1}`,
        agentId: s.agentId ?? "",
        prompt: s.prompt ?? "",
        dependencies: Array.isArray(s.dependencies) ? s.dependencies.join(", ") : "",
        timeout: s.timeout ?? 60,
        retries: s.retries ?? 0,
        _advancedOpen: false,
      }));
      // Update counter so new steps don't collide
      _stepCounter = this._steps.length;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _getToken(): string {
    // Reuse the same auth token pattern as the rest of the UI
    return localStorage.getItem("cp:token") ?? "";
  }

  // --- Actions ---

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _addStep(): void {
    this._steps = [...this._steps, createEmptyStep()];
  }

  private _removeStep(index: number): void {
    this._steps = this._steps.filter((_, i) => i !== index);
  }

  private _updateStep(
    index: number,
    field: keyof FlowStep,
    value: string | number | boolean,
  ): void {
    this._steps = this._steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
  }

  private _toggleAdvanced(index: number): void {
    this._updateStep(index, "_advancedOpen", !this._steps[index]!._advancedOpen);
  }

  private _isFormValid(): boolean {
    if (!this._name.trim()) return false;
    if (this._steps.length === 0) return false;
    // Every step must have an ID and an agent ID
    return this._steps.every((s) => s.id.trim() && s.agentId.trim());
  }

  private async _save(): Promise<void> {
    if (!this._isFormValid() || this._saving) return;
    this._saving = true;
    this._error = "";

    const payload: FlowPayload = {
      name: this._name.trim(),
      description: this._description.trim(),
      triggerType: this._triggerType,
      steps: this._steps.map((s) => ({
        id: s.id.trim(),
        agentId: s.agentId.trim(),
        prompt: s.prompt.trim(),
        dependencies: s.dependencies
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
        timeout: s.timeout,
        retries: s.retries,
      })),
    };

    const isEdit = this.flowId !== undefined;
    const url = isEdit
      ? `/api/instances/${this.slug}/flows/${this.flowId}`
      : `/api/instances/${this.slug}/flows`;
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this._getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = (await res.json()) as { error?: string };
          message = body.error ?? res.statusText;
        } catch {
          // Not JSON — keep statusText
        }
        throw new Error(message);
      }

      this.dispatchEvent(new CustomEvent("flow-saved", { bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  // --- Rendering ---

  private _renderStepCard(step: FlowStep, index: number) {
    return html`
      <div class="step-card">
        <div class="step-card-header">
          <span class="step-number">${msg("Step", { id: "fe-step-label" })} ${index + 1}</span>
          <button
            class="remove-step-btn"
            aria-label=${msg("Remove step", { id: "fe-remove-step" })}
            @click=${() => this._removeStep(index)}
            ?disabled=${this._saving}
          >
            &times;
          </button>
        </div>

        <div class="field-row">
          <div class="field">
            <label>${msg("Step ID", { id: "fe-label-step-id" })}</label>
            <input
              type="text"
              .value=${step.id}
              @input=${(e: Event) =>
                this._updateStep(index, "id", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label>${msg("Agent ID", { id: "fe-label-agent-id" })}</label>
            <input
              type="text"
              .value=${step.agentId}
              placeholder=${msg("e.g. researcher", { id: "fe-placeholder-agent" })}
              @input=${(e: Event) =>
                this._updateStep(index, "agentId", (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="field">
          <label>${msg("Prompt", { id: "fe-label-prompt" })}</label>
          <textarea
            .value=${step.prompt}
            placeholder=${msg("Instructions for this step...", { id: "fe-placeholder-prompt" })}
            @input=${(e: Event) =>
              this._updateStep(index, "prompt", (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div class="field">
          <label>${msg("Dependencies", { id: "fe-label-deps" })}</label>
          <input
            type="text"
            .value=${step.dependencies}
            placeholder=${msg("e.g. step-1, step-2", { id: "fe-placeholder-deps" })}
            @input=${(e: Event) =>
              this._updateStep(index, "dependencies", (e.target as HTMLInputElement).value)}
          />
          <span class="field-hint"
            >${msg("Comma-separated step IDs that must complete first", {
              id: "fe-hint-deps",
            })}</span
          >
        </div>

        <button class="advanced-toggle" @click=${() => this._toggleAdvanced(index)}>
          ${step._advancedOpen ? "\u25BE" : "\u25B8"}
          ${msg("Advanced", { id: "fe-advanced-toggle" })}
        </button>

        ${step._advancedOpen
          ? html`
              <div class="advanced-section">
                <div class="field-row">
                  <div class="field">
                    <label>${msg("Timeout (seconds)", { id: "fe-label-timeout" })}</label>
                    <input
                      type="number"
                      min="1"
                      .value=${String(step.timeout)}
                      @input=${(e: Event) =>
                        this._updateStep(
                          index,
                          "timeout",
                          parseInt((e.target as HTMLInputElement).value, 10) || 60,
                        )}
                    />
                  </div>
                  <div class="field">
                    <label>${msg("Retries", { id: "fe-label-retries" })}</label>
                    <input
                      type="number"
                      min="0"
                      .value=${String(step.retries)}
                      @input=${(e: Event) =>
                        this._updateStep(
                          index,
                          "retries",
                          parseInt((e.target as HTMLInputElement).value, 10) || 0,
                        )}
                    />
                  </div>
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderForm() {
    return html`
      <div class="dialog-body">
        <!-- Flow metadata -->
        <div class="section">
          <div class="section-label">
            ${msg("Flow definition", { id: "fe-section-definition" })}
          </div>
          <div class="field">
            <label for="flow-name">${msg("Name *", { id: "fe-label-name" })}</label>
            <input
              id="flow-name"
              type="text"
              placeholder=${msg("e.g. Research & Report", { id: "fe-placeholder-name" })}
              .value=${this._name}
              @input=${(e: Event) => {
                this._name = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label for="flow-description"
              >${msg("Description", { id: "fe-label-description" })}</label
            >
            <textarea
              id="flow-description"
              placeholder=${msg("What does this flow do?", { id: "fe-placeholder-description" })}
              .value=${this._description}
              @input=${(e: Event) => {
                this._description = (e.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
          </div>
          <div class="field">
            <label for="flow-trigger">${msg("Trigger", { id: "fe-label-trigger" })}</label>
            <select
              id="flow-trigger"
              @change=${(e: Event) => {
                this._triggerType = (e.target as HTMLSelectElement).value as TriggerType;
              }}
            >
              <option value="manual" ?selected=${this._triggerType === "manual"}>
                ${msg("Manual", { id: "fe-trigger-manual" })}
              </option>
              <option value="bus" ?selected=${this._triggerType === "bus"}>
                ${msg("Bus event", { id: "fe-trigger-bus" })}
              </option>
            </select>
          </div>
        </div>

        <hr class="divider" />

        <!-- Steps -->
        <div class="section">
          <div class="steps-header">
            <div class="section-label">${msg("Steps", { id: "fe-section-steps" })}</div>
            <span class="field-hint"
              >${this._steps.length} ${msg("step(s)", { id: "fe-step-count" })}</span
            >
          </div>
          ${this._steps.map((step, i) => this._renderStepCard(step, i))}
          <button class="btn-add-step" @click=${this._addStep} ?disabled=${this._saving}>
            + ${msg("Add step", { id: "fe-btn-add-step" })}
          </button>
        </div>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
      </div>

      <div class="dialog-footer">
        <button class="btn btn-ghost" @click=${this._close} ?disabled=${this._saving}>
          ${msg("Cancel", { id: "fe-btn-cancel" })}
        </button>
        <button
          class="btn btn-primary"
          ?disabled=${!this._isFormValid() || this._saving}
          @click=${this._save}
        >
          ${this._saving
            ? msg("Saving...", { id: "fe-btn-saving" })
            : this.flowId !== undefined
              ? msg("Save flow", { id: "fe-btn-save" })
              : msg("Create flow", { id: "fe-btn-create" })}
        </button>
      </div>
    `;
  }

  private _renderLoading() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>${msg("Loading flow...", { id: "fe-loading" })}</div>
      </div>
    `;
  }

  override render() {
    return html`
      <div
        class="overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._close();
        }}
      >
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">
              ${this.flowId !== undefined
                ? msg("Edit flow", { id: "fe-title-edit" })
                : msg("New flow", { id: "fe-title-create" })}
            </span>
            <button
              class="close-btn"
              aria-label="Close"
              @click=${this._close}
              ?disabled=${this._saving}
            >
              &#10005;
            </button>
          </div>
          ${this._loading ? this._renderLoading() : this._renderForm()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-flow-editor": FlowEditor;
  }
}
