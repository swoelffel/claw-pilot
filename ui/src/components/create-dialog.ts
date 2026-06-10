import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  AgentDefinition,
  Blueprint,
  CreateInstanceRequest,
  NamedApiKey,
  ProviderInfo,
  ProvidersResponse,
} from "../types.js";
import {
  fetchNextPort,
  createInstance,
  fetchProviders,
  fetchBlueprints,
  fetchNamedKeys,
  importBuiltinBlueprint,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { DialogMixin } from "../lib/dialog-mixin.js";
import { tokenStyles } from "../styles/tokens.js";
import {
  sectionLabelStyles,
  spinnerStyles,
  errorBannerStyles,
  buttonStyles,
} from "../styles/shared.js";

@localized()
@customElement("cp-create-dialog")
export class CreateDialog extends DialogMixin(LitElement) {
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

      /* Overlay backdrop */
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

      /* Dialog panel */
      .dialog {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 560px;
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
      .close-btn:hover {
        color: var(--text-primary);
      }

      .dialog-body {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      /* Section grouping */
      .section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Form fields */
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
      input[type="password"],
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
      input[type="number"]:focus,
      input[type="password"]:focus,
      select:focus {
        border-color: var(--accent);
      }
      input.invalid {
        border-color: var(--state-error);
      }

      .field-hint {
        font-size: 11px;
        color: var(--text-muted);
      }
      .field-error {
        font-size: 11px;
        color: var(--state-error);
      }

      /* Agents section */
      .agent-mode-toggle {
        display: flex;
        gap: 8px;
      }

      .toggle-btn {
        flex: 1;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-base);
        color: var(--state-stopped);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
      }
      .toggle-btn.active {
        background: var(--accent-subtle);
        border-color: var(--accent-border);
        color: var(--accent);
      }

      .agents-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .agent-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 8px;
        align-items: center;
      }

      .agent-remove {
        background: none;
        border: none;
        color: rgba(239, 68, 68, 0.5);
        cursor: pointer;
        font-size: 16px;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        transition: color 0.15s;
      }
      .agent-remove:hover {
        color: var(--state-error);
      }

      .add-agent-btn {
        background: none;
        border: 1px dashed var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--accent);
        font-size: 13px;
        padding: 8px;
        cursor: pointer;
        transition: all 0.15s;
        width: 100%;
      }
      .add-agent-btn:hover {
        border-color: var(--accent-border);
        background: var(--accent-subtle);
      }

      /* Divider */
      .divider {
        border: none;
        border-top: 1px solid var(--bg-border);
        margin: 0;
      }

      /* Spinner overlay */
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

      .spinner-msg {
        color: var(--state-stopped);
        font-size: 13px;
      }

      /* Footer actions */
      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 24px 20px;
        border-top: 1px solid var(--bg-border);
      }
    `,
  ];

  // --- Form state ---
  @state() private _slug = "";
  @state() private _slugError = "";
  @state() private _displayName = "";
  // Track last auto-generated display name to detect manual edits
  private _autoDisplayName = "";
  @state() private _port = 0;
  @state() private _portLoading = true;
  @state() private _portError = "";
  @state() private _model = "";
  @state() private _providers: ProviderInfo[] = [];
  @state() private _providersLoading = true;
  @state() private _providersError = "";

  @state() private _namedKeys: NamedApiKey[] = [];
  @state() private _namedKeysLoading = true;
  @state() private _namedKeysError = "";
  @state() private _namedKeyId: number | null = null;

  @state() private _blueprints: Blueprint[] = [];
  @state() private _blueprintsLoading = false;
  @state() private _selectedBlueprintId: number | null = null;
  /** Slug of the selected builtin blueprint (only set when _selectedBlueprintId === -1) */
  @state() private _selectedBuiltinSlug: string | null = null;

  // --- Submit state ---
  @state() private _submitting = false;
  @state() private _submitError = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadNextPort();
    this._loadProviders();
    this._loadNamedKeys();
    this._loadBlueprints();
  }

  private async _loadNextPort(): Promise<void> {
    this._portLoading = true;
    this._portError = "";
    try {
      this._port = await fetchNextPort();
    } catch (err) {
      this._portError = userMessage(err);
      this._port = 18790;
    } finally {
      this._portLoading = false;
    }
  }

  private async _loadProviders(): Promise<void> {
    this._providersLoading = true;
    this._providersError = "";
    try {
      const data: ProvidersResponse = await fetchProviders();
      this._providers = data.providers;
    } catch (err) {
      this._providersError = userMessage(err);
      this._providers = [
        {
          id: "anthropic",
          label: "Anthropic",
          requiresKey: true,
          defaultModel: "anthropic/claude-sonnet-4-6",
          models: ["anthropic/claude-sonnet-4-6"],
        },
      ];
    } finally {
      this._providersLoading = false;
    }
  }

  private async _loadNamedKeys(): Promise<void> {
    this._namedKeysLoading = true;
    this._namedKeysError = "";
    try {
      const data = await fetchNamedKeys();
      this._namedKeys = data.keys;
      // Auto-select first key if available
      if (data.keys.length > 0) {
        const first = data.keys[0]!;
        this._namedKeyId = first.id;
        this._model = first.defaultModel;
      }
    } catch (err) {
      this._namedKeysError = userMessage(err);
      this._namedKeys = [];
    } finally {
      this._namedKeysLoading = false;
    }
  }

  private async _loadBlueprints(): Promise<void> {
    this._blueprintsLoading = true;
    try {
      this._blueprints = await fetchBlueprints();
    } catch {
      this._blueprints = [];
    } finally {
      this._blueprintsLoading = false;
    }
  }

  /** Called when the user picks a different named key — resets model to key's default */
  private _onNamedKeyChange(e: Event): void {
    const id = parseInt((e.target as HTMLSelectElement).value, 10);
    const key = this._namedKeys.find((k) => k.id === id) ?? null;
    this._namedKeyId = key?.id ?? null;
    // Auto-select the default model for this key's provider
    this._model = key?.defaultModel ?? "";
  }

  /** Get the ProviderInfo for the currently selected named key */
  private get _selectedProvider(): ProviderInfo | null {
    if (this._namedKeyId == null) return null;
    const key = this._namedKeys.find((k) => k.id === this._namedKeyId);
    if (!key) return null;
    return this._providers.find((p) => p.id === key.providerId) ?? null;
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _validateSlug(value: string): string {
    if (!value) return msg("Slug is required", { id: "error-slug-required" });
    if (!/^[a-z][a-z0-9-]*$/.test(value))
      return msg("Lowercase letters, numbers, hyphens only", { id: "error-slug-format" });
    if (value.length < 2 || value.length > 30)
      return msg("Must be 2-30 characters", { id: "error-slug-length" });
    return "";
  }

  private _onSlugInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    this._slug = val;
    this._slugError = this._validateSlug(val);
    // Auto-fill display name only if user hasn't manually edited it
    const auto = val.charAt(0).toUpperCase() + val.slice(1).replace(/-/g, " ");
    if (!this._displayName || this._displayName === this._autoDisplayName) {
      this._autoDisplayName = auto;
      this._displayName = auto;
    }
  }

  private _buildAgents(): AgentDefinition[] {
    return [{ id: "pilot", name: "Pilot", isDefault: true }];
  }

  private _isFormValid(): boolean {
    if (this._validateSlug(this._slug)) return false;
    if (!this._port || this._port < 1024 || this._port > 65535) return false;
    if (!this._model) return false;
    if (this._namedKeyId == null) return false;
    return true;
  }

  private async _submit(): Promise<void> {
    if (!this._isFormValid() || this._submitting) return;

    this._submitting = true;
    this._submitError = "";

    try {
      let blueprintId = this._selectedBlueprintId;

      // Auto-import builtin blueprint before provisioning
      if (blueprintId === -1 && this._selectedBuiltinSlug) {
        const imported = await importBuiltinBlueprint(this._selectedBuiltinSlug);
        blueprintId = imported.id;
      }

      const request: CreateInstanceRequest = {
        slug: this._slug,
        displayName: this._displayName || this._slug.charAt(0).toUpperCase() + this._slug.slice(1),
        port: this._port,
        defaultModel: this._model,
        namedKeyId: this._namedKeyId!,
        agents: this._buildAgents(),
        ...(blueprintId != null && { blueprintId }),
      };

      await createInstance(request);
      this.dispatchEvent(new CustomEvent("instance-created", { bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._submitError = userMessage(err);
    } finally {
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>
          ${msg("Provisioning instance", { id: "spinner-provisioning" })}
          <strong>${this._slug}</strong>...
        </div>
        ${this._selectedBlueprintId
          ? html`
              <div class="spinner-msg">
                ${msg("Deploying blueprint agents...", { id: "cd-deploying" })}
              </div>
            `
          : html`
              <div class="spinner-msg">
                ${msg("This may take 20-30 seconds (startup + health check)", {
                  id: "spinner-wait",
                })}
              </div>
            `}
      </div>
    `;
  }

  private _renderProviderSection() {
    if (this._namedKeysLoading || this._providersLoading) {
      return html`
        <div class="section">
          <div class="section-label">${msg("API Key", { id: "section-api-key" })}</div>
          <span class="field-hint">${msg("Loading...", { id: "hint-loading-keys" })}</span>
        </div>
      `;
    }

    if (this._namedKeysError) {
      return html`
        <div class="section">
          <div class="section-label">${msg("API Key", { id: "section-api-key" })}</div>
          <span class="field-error">${this._namedKeysError}</span>
        </div>
      `;
    }

    if (this._namedKeys.length === 0) {
      return html`
        <div class="section">
          <div class="section-label">${msg("API Key", { id: "section-api-key" })}</div>
          <span class="field-hint">
            ${msg("No API keys configured. Go to Profile > API Keys to create one.", {
              id: "hint-no-named-keys",
            })}
          </span>
        </div>
      `;
    }

    const selectedKey = this._namedKeys.find((k) => k.id === this._namedKeyId);
    const provider = this._selectedProvider;
    const models = provider?.models ?? [];

    return html`
      <div class="section">
        <div class="section-label">${msg("API Key", { id: "section-api-key" })}</div>

        ${this._providersError
          ? html`<span class="field-error">${this._providersError}</span>`
          : ""}

        <div class="field">
          <label for="named-key">${msg("API Key *", { id: "label-named-key" })}</label>
          <select id="named-key" @change=${this._onNamedKeyChange}>
            ${this._namedKeys.map(
              (k) => html`
                <option value=${k.id} ?selected=${this._namedKeyId === k.id}>
                  ${k.name} (${k.providerId})
                </option>
              `,
            )}
          </select>
          ${selectedKey ? html`<span class="field-hint">${selectedKey.apiKeyMasked}</span>` : ""}
        </div>

        <div class="field">
          <label for="model">${msg("Default model *", { id: "label-default-model-form" })}</label>
          <select
            id="model"
            .value=${this._model}
            @change=${(e: Event) => {
              this._model = (e.target as HTMLSelectElement).value;
            }}
          >
            ${models.map(
              (m) => html`
                <option value=${m} ?selected=${this._model === m}>${m.split("/")[1] ?? m}</option>
              `,
            )}
          </select>
        </div>
      </div>
    `;
  }

  private _renderForm() {
    return html`
      <div class="dialog-body">
        <!-- Identity -->
        <div class="section">
          <div class="section-label">${msg("Identity", { id: "section-identity" })}</div>
          <div class="field-row">
            <div class="field">
              <label for="slug">${msg("Slug *", { id: "label-slug" })}</label>
              <input
                id="slug"
                type="text"
                placeholder=${msg("e.g. dev-team", { id: "placeholder-slug" })}
                .value=${this._slug}
                class=${this._slugError ? "invalid" : ""}
                @input=${this._onSlugInput}
              />
              ${this._slugError
                ? html`<span class="field-error">${this._slugError}</span>`
                : html`<span class="field-hint"
                    >${msg("Lowercase, 2-30 chars", { id: "hint-slug" })}</span
                  >`}
            </div>
            <div class="field">
              <label for="display-name">${msg("Display name", { id: "label-display-name" })}</label>
              <input
                id="display-name"
                type="text"
                placeholder=${msg("e.g. Dev Team", { id: "placeholder-display-name" })}
                .value=${this._displayName}
                @input=${(e: Event) => {
                  this._displayName = (e.target as HTMLInputElement).value;
                }}
              />
            </div>
          </div>
        </div>

        <hr class="divider" />

        <!-- Configuration -->
        <div class="section">
          <div class="section-label">${msg("Configuration", { id: "section-configuration" })}</div>
          <div class="field">
            <label for="port">${msg("Gateway port *", { id: "label-gateway-port" })}</label>
            <input
              id="port"
              type="number"
              min="1024"
              max="65535"
              .value=${this._portLoading ? "" : String(this._port)}
              ?disabled=${this._portLoading}
              placeholder=${this._portLoading
                ? msg("Loading...", { id: "placeholder-loading" })
                : ""}
              @input=${(e: Event) => {
                this._port = parseInt((e.target as HTMLInputElement).value) || 0;
              }}
            />
            ${this._portError
              ? html`<span class="field-error">${this._portError}</span>`
              : html`<span class="field-hint"
                  >${msg("Auto-suggested from free range", { id: "hint-port" })}</span
                >`}
          </div>
        </div>

        <hr class="divider" />

        <!-- Named API Key + Model -->
        ${this._renderProviderSection()}

        <hr class="divider" />

        <!-- Blueprint -->
        <div class="section">
          <div class="section-label">${msg("Team Blueprint", { id: "cd-blueprint" })}</div>
          <div class="field">
            <label for="blueprint">${msg("Team Blueprint", { id: "cd-blueprint" })}</label>
            <select
              id="blueprint"
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                if (!val) {
                  this._selectedBlueprintId = null;
                  this._selectedBuiltinSlug = null;
                } else if (val.startsWith("builtin:")) {
                  this._selectedBlueprintId = -1;
                  this._selectedBuiltinSlug = val.slice("builtin:".length);
                } else {
                  this._selectedBlueprintId = Number(val);
                  this._selectedBuiltinSlug = null;
                }
              }}
            >
              <option value="">${msg("Default (Main only)", { id: "cd-blueprint-none" })}</option>
              ${this._blueprints.map(
                (bp) => html`
                  <option value="${bp._builtin && bp._slug ? `builtin:${bp._slug}` : bp.id}">
                    ${bp.icon ? `${bp.icon} ` : ""}${bp.name}${bp.agent_count
                      ? ` (${bp.agent_count} agents)`
                      : ""}
                  </option>
                `,
              )}
            </select>
            <span class="field-hint"
              >${msg("Optionally deploy a team of agents", { id: "cd-blueprint-hint" })}</span
            >
          </div>
        </div>

        ${this._submitError ? html`<div class="error-banner">${this._submitError}</div>` : ""}
      </div>

      <div class="dialog-footer">
        <button class="btn btn-ghost" @click=${this._close}>
          ${msg("Cancel", { id: "btn-cancel-dialog" })}
        </button>
        <button class="btn btn-primary" ?disabled=${!this._isFormValid()} @click=${this._submit}>
          ${msg("Create Instance", { id: "btn-create-instance" })}
        </button>
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
            <span class="dialog-title">${msg("New Instance", { id: "dialog-title" })}</span>
            <button
              class="close-btn"
              aria-label="Fermer"
              @click=${this._close}
              ?disabled=${this._submitting}
            >
              ✕
            </button>
          </div>
          ${this._submitting ? this._renderSpinner() : this._renderForm()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-create-dialog": CreateDialog;
  }
}
