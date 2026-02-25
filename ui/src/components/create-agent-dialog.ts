// ui/src/components/create-agent-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { BuilderData, CreateAgentRequest, ProviderInfo, ProvidersResponse } from "../types.js";
import { fetchProviders, createAgent } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-create-agent-dialog")
export class CreateAgentDialog extends LitElement {
  static styles = [tokenStyles, sectionLabelStyles, spinnerStyles, errorBannerStyles, buttonStyles, css`
    :host { display: block; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .dialog {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 480px;
      max-height: 90vh;
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
    .close-btn:hover { color: var(--text-primary); }

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
    select {
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
    select:focus { border-color: var(--accent); }
    input.invalid { border-color: var(--state-error); }

    .field-hint { font-size: 11px; color: var(--text-muted); }
    .field-error { font-size: 11px; color: var(--state-error); }

    .divider {
      border: none;
      border-top: 1px solid var(--bg-border);
      margin: 0;
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
  `];

  @property({ type: String }) slug = "";
  @property({ type: Array }) existingAgentIds: string[] = [];

  @state() private _agentSlug = "";
  @state() private _slugError = "";
  @state() private _name = "";
  private _autoName = "";
  @state() private _role = "";
  @state() private _providers: ProviderInfo[] = [];
  @state() private _selectedProvider: ProviderInfo | null = null;
  @state() private _model = "";
  @state() private _providersLoading = true;
  @state() private _submitting = false;
  @state() private _submitError = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadProviders();
  }

  private async _loadProviders(): Promise<void> {
    this._providersLoading = true;
    try {
      const data: ProvidersResponse = await fetchProviders();
      this._providers = data.providers;
      const defaultProvider = data.providers.find((p) => p.isDefault) ?? data.providers[0] ?? null;
      this._selectedProvider = defaultProvider;
      this._model = defaultProvider?.defaultModel ?? defaultProvider?.models[0] ?? "";
    } catch {
      this._providers = [{
        id: "anthropic",
        label: "Anthropic",
        requiresKey: true,
        defaultModel: "anthropic/claude-sonnet-4-6",
        models: ["anthropic/claude-sonnet-4-6"],
      }];
      this._selectedProvider = this._providers[0]!;
      this._model = "anthropic/claude-sonnet-4-6";
    } finally {
      this._providersLoading = false;
    }
  }

  private _onProviderChange(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    const provider = this._providers.find((p) => p.id === id) ?? null;
    this._selectedProvider = provider;
    this._model = provider?.defaultModel ?? provider?.models[0] ?? "";
  }

  private _validateSlug(value: string): string {
    if (!value) return msg("Agent ID is required", { id: "cad-error-slug-required" });
    if (!/^[a-z][a-z0-9-]*$/.test(value)) return msg("ID must be 2-30 lowercase chars", { id: "cad-error-slug-invalid" });
    if (value.length < 2 || value.length > 30) return msg("ID must be 2-30 lowercase chars", { id: "cad-error-slug-invalid" });
    if (this.existingAgentIds.includes(value)) return msg("This ID is already used", { id: "cad-error-slug-taken" });
    return "";
  }

  private _onSlugInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    this._agentSlug = val;
    this._slugError = this._validateSlug(val);
    // Auto-fill name from slug
    const auto = val.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    if (!this._name || this._name === this._autoName) {
      this._autoName = auto;
      this._name = auto;
    }
  }

  private _isFormValid(): boolean {
    if (this._validateSlug(this._agentSlug)) return false;
    if (!this._name.trim()) return false;
    if (!this._model) return false;
    if (!this._selectedProvider) return false;
    return true;
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private async _submit(): Promise<void> {
    if (!this._isFormValid() || this._submitting) return;
    this._submitting = true;
    this._submitError = "";

    const request: CreateAgentRequest = {
      agentSlug: this._agentSlug,
      name: this._name.trim(),
      role: this._role.trim(),
      provider: this._selectedProvider?.id ?? "anthropic",
      model: this._model.includes("/") ? this._model.split("/")[1]! : this._model,
    };

    try {
      const builderData = await createAgent(this.slug, request);
      this.dispatchEvent(new CustomEvent("agent-created", {
        detail: builderData,
        bubbles: true,
        composed: true,
      }));
      this._close();
    } catch (err) {
      this._submitError = err instanceof Error ? err.message : msg("Failed to create agent", { id: "cad-error-create" });
    } finally {
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>${msg("Creating agent", { id: "cad-spinner-creating" })} <strong>${this._agentSlug}</strong>...</div>
      </div>
    `;
  }

  private _renderForm() {
    return html`
      <div class="dialog-body">
        <!-- Identity -->
        <div class="section">
          <div class="section-label">${msg("Identity", { id: "cad-section-identity" })}</div>
          <div class="field-row">
            <div class="field">
              <label for="agent-slug">${msg("Agent ID *", { id: "cad-label-slug" })}</label>
              <input
                id="agent-slug"
                type="text"
                placeholder=${msg("e.g. qa-engineer", { id: "cad-placeholder-slug" })}
                .value=${this._agentSlug}
                class=${this._slugError ? "invalid" : ""}
                @input=${this._onSlugInput}
              />
              ${this._slugError
                ? html`<span class="field-error">${this._slugError}</span>`
                : html`<span class="field-hint">${msg("Lowercase letters, numbers and hyphens", { id: "cad-hint-slug" })}</span>`}
            </div>
            <div class="field">
              <label for="agent-name">${msg("Display name *", { id: "cad-label-name" })}</label>
              <input
                id="agent-name"
                type="text"
                placeholder=${msg("e.g. QA Engineer", { id: "cad-placeholder-name" })}
                .value=${this._name}
                @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}
              />
            </div>
          </div>
          <div class="field">
            <label for="agent-role">${msg("Role", { id: "cad-label-role" })}</label>
            <input
              id="agent-role"
              type="text"
              placeholder=${msg("e.g. Quality Assurance", { id: "cad-placeholder-role" })}
              .value=${this._role}
              @input=${(e: Event) => { this._role = (e.target as HTMLInputElement).value; }}
            />
          </div>
        </div>

        <hr class="divider" />

        <!-- Provider + Model -->
        <div class="section">
          <div class="section-label">${msg("Model", { id: "cad-section-model" })}</div>
          ${this._providersLoading
            ? html`<span class="field-hint">${msg("Loading providers...", { id: "cad-loading-providers" })}</span>`
            : html`
              <div class="field-row">
                <div class="field">
                  <label for="agent-provider">${msg("Provider", { id: "cad-label-provider" })}</label>
                  <select id="agent-provider" @change=${this._onProviderChange}>
                    ${this._providers.map((p) => html`
                      <option value=${p.id} ?selected=${this._selectedProvider?.id === p.id}>${p.label}</option>
                    `)}
                  </select>
                </div>
                <div class="field">
                  <label for="agent-model">${msg("Model", { id: "cad-label-model" })}</label>
                  <select
                    id="agent-model"
                    @change=${(e: Event) => { this._model = (e.target as HTMLSelectElement).value; }}
                  >
                    ${(this._selectedProvider?.models ?? []).map((m) => html`
                      <option value=${m} ?selected=${this._model === m}>${m.split("/")[1] ?? m}</option>
                    `)}
                  </select>
                </div>
              </div>
            `}
        </div>

        ${this._submitError
          ? html`<div class="error-banner">${this._submitError}</div>`
          : ""}
      </div>

      <div class="dialog-footer">
        <button class="btn btn-ghost" @click=${this._close}>${msg("Cancel", { id: "cad-btn-cancel" })}</button>
        <button
          class="btn btn-primary"
          ?disabled=${!this._isFormValid() || this._providersLoading}
          @click=${this._submit}
        >${msg("Create agent", { id: "cad-btn-submit" })}</button>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("New agent", { id: "cad-title" })}</span>
            <button class="close-btn" aria-label="Close" @click=${this._close} ?disabled=${this._submitting}>✕</button>
          </div>
          ${this._submitting ? this._renderSpinner() : this._renderForm()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-create-agent-dialog": CreateAgentDialog;
  }
}
