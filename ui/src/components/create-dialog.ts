import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentDefinition, Blueprint, CreateInstanceRequest, ProviderInfo, ProvidersResponse } from "../types.js";
import { fetchNextPort, createInstance, fetchProviders, fetchBlueprints } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-create-dialog")
export class CreateDialog extends LitElement {
  static styles = [tokenStyles, sectionLabelStyles, spinnerStyles, errorBannerStyles, buttonStyles, css`
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
    .close-btn:hover { color: var(--text-primary); }

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
    .agent-remove:hover { color: var(--state-error); }

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
  `];

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
  @state() private _canReuseCredentials = false;
  @state() private _providersLoading = true;
  @state() private _providersError = "";
  @state() private _selectedProvider: ProviderInfo | null = null;
  @state() private _apiKey = "";
  @state() private _agentMode: "minimal" | "custom" = "minimal";
  @state() private _customAgents: Array<{ id: string; name: string }> = [];
  @state() private _blueprints: Blueprint[] = [];
  @state() private _blueprintsLoading = false;
  @state() private _selectedBlueprintId: number | null = null;

  // --- Submit state ---
  @state() private _submitting = false;
  @state() private _submitError = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadNextPort();
    this._loadProviders();
    this._loadBlueprints();
  }

  private async _loadNextPort(): Promise<void> {
    this._portLoading = true;
    this._portError = "";
    try {
      this._port = await fetchNextPort();
    } catch (err) {
      this._portError = err instanceof Error ? err.message : msg("Could not fetch next port", { id: "error-fetch-port" });
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
      this._canReuseCredentials = data.canReuseCredentials;
      const defaultProvider = data.providers.find((p) => p.isDefault) ?? data.providers[0] ?? null;
      this._selectedProvider = defaultProvider;
      this._model = defaultProvider?.defaultModel ?? defaultProvider?.models[0] ?? "";
    } catch (err) {
      this._providersError = err instanceof Error ? err.message : msg("Could not load providers", { id: "error-load-providers" });
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

  /** Called when the user picks a different provider — resets model to provider default */
  private _onProviderChange(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    const provider = this._providers.find((p) => p.id === id) ?? null;
    this._selectedProvider = provider;
    this._apiKey = "";
    // Auto-select the default model for this provider
    this._model = provider?.defaultModel ?? provider?.models[0] ?? "";
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _validateSlug(value: string): string {
    if (!value) return msg("Slug is required", { id: "error-slug-required" });
    if (!/^[a-z][a-z0-9-]*$/.test(value)) return msg("Lowercase letters, numbers, hyphens only", { id: "error-slug-format" });
    if (value.length < 2 || value.length > 30) return msg("Must be 2-30 characters", { id: "error-slug-length" });
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

  private _addAgent(): void {
    this._customAgents = [...this._customAgents, { id: "", name: "" }];
  }

  private _removeAgent(idx: number): void {
    this._customAgents = this._customAgents.filter((_, i) => i !== idx);
  }

  private _updateAgent(idx: number, field: "id" | "name", value: string): void {
    this._customAgents = this._customAgents.map((a, i) =>
      i === idx ? { ...a, [field]: field === "id" ? value.toLowerCase().replace(/[^a-z0-9-]/g, "") : value } : a
    );
  }

  private _buildAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = [{ id: "main", name: "Main", isDefault: true }];
    if (this._agentMode === "custom") {
      for (const a of this._customAgents) {
        if (a.id && a.name) {
          agents.push({ id: a.id, name: a.name });
        }
      }
    }
    return agents;
  }

  private _isFormValid(): boolean {
    if (this._validateSlug(this._slug)) return false;
    if (!this._port || this._port < 1024 || this._port > 65535) return false;
    if (!this._model) return false;
    if (!this._selectedProvider) return false;
    if (this._selectedProvider.requiresKey && !this._apiKey.trim()) return false;
    if (this._agentMode === "custom") {
      for (const a of this._customAgents) {
        if (!a.id || !a.name) return false;
        if (!/^[a-z][a-z0-9-]*$/.test(a.id)) return false;
      }
    }
    return true;
  }

  private async _submit(): Promise<void> {
    if (!this._isFormValid() || this._submitting) return;

    this._submitting = true;
    this._submitError = "";

    const request: CreateInstanceRequest = {
      slug: this._slug,
      displayName: this._displayName || this._slug.charAt(0).toUpperCase() + this._slug.slice(1),
      port: this._port,
      defaultModel: this._model,
      provider: this._selectedProvider?.id ?? "anthropic",
      apiKey: this._selectedProvider?.requiresKey ? this._apiKey.trim() : "",
      agents: this._buildAgents(),
      blueprintId: this._selectedBlueprintId ?? undefined,
    };

    try {
      await createInstance(request);
      this.dispatchEvent(new CustomEvent("instance-created", { bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._submitError = err instanceof Error ? err.message : msg("Provisioning failed", { id: "error-provisioning" });
    } finally {
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>${msg("Provisioning instance", { id: "spinner-provisioning" })} <strong>${this._slug}</strong>...</div>
        ${this._selectedBlueprintId ? html`
          <div class="spinner-msg">${msg("Deploying blueprint agents...", { id: "cd-deploying" })}</div>
        ` : html`
          <div class="spinner-msg">${msg("This may take 20-30 seconds (systemd start + health check)", { id: "spinner-wait" })}</div>
        `}
      </div>
    `;
  }

  private _renderProviderSection() {
    if (this._providersLoading) {
      return html`
        <div class="section">
          <div class="section-label">${msg("Provider", { id: "section-provider" })}</div>
          <span class="field-hint">${msg("Loading providers...", { id: "hint-loading-providers" })}</span>
        </div>
      `;
    }

    const selected = this._selectedProvider;

    return html`
      <div class="section">
        <div class="section-label">${msg("Provider", { id: "section-provider" })}</div>

        ${this._providersError
          ? html`<span class="field-error">${this._providersError}</span>`
          : ""}

        <div class="field">
          <label for="provider">${msg("AI Provider *", { id: "label-ai-provider" })}</label>
          <select id="provider" @change=${this._onProviderChange}>
            ${this._providers.map((p) => html`
              <option value=${p.id} ?selected=${selected?.id === p.id}>${p.label}</option>
            `)}
          </select>
        </div>

        <div class="field">
          <label for="model">${msg("Default model *", { id: "label-default-model-form" })}</label>
          <select
            id="model"
            .value=${this._model}
            @change=${(e: Event) => { this._model = (e.target as HTMLSelectElement).value; }}
          >
            ${(selected?.models ?? []).map((m) => html`
              <option value=${m} ?selected=${this._model === m}>${m.split("/")[1] ?? m}</option>
            `)}
          </select>
        </div>

        ${selected?.requiresKey
          ? html`
              <div class="field">
                <label for="api-key">${msg("API Key *", { id: "label-api-key" })}</label>
                <input
                  id="api-key"
                  type="password"
                  placeholder=${this._getApiKeyPlaceholder(selected.id)}
                  .value=${this._apiKey}
                  @input=${(e: Event) => { this._apiKey = (e.target as HTMLInputElement).value; }}
                />
                <span class="field-hint">${msg("Your API key", { id: "hint-api-key" })} (${selected.label})</span>
              </div>
            `
          : html`
              <span class="field-hint">
                ${selected?.id === "opencode"
                  ? msg("Uses the OpenCode runtime — no API key required", { id: "hint-opencode-no-key" })
                  : msg("Credentials will be reused from the existing instance", { id: "hint-reuse-credentials" })}
              </span>
            `}
      </div>
    `;
  }

  private _getApiKeyPlaceholder(providerId: string): string {
    const placeholders: Record<string, string> = {
      anthropic:  "sk-ant-...",
      openai:     "sk-...",
      openrouter: "sk-or-...",
      gemini:     "AIza...",
      mistral:    "...",
    };
    return placeholders[providerId] ?? "API key";
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
                : html`<span class="field-hint">${msg("Lowercase, 2-30 chars", { id: "hint-slug" })}</span>`}
            </div>
            <div class="field">
              <label for="display-name">${msg("Display name", { id: "label-display-name" })}</label>
              <input
                id="display-name"
                type="text"
                placeholder=${msg("e.g. Dev Team", { id: "placeholder-display-name" })}
                .value=${this._displayName}
                @input=${(e: Event) => { this._displayName = (e.target as HTMLInputElement).value; }}
              />
            </div>
          </div>
        </div>

        <hr class="divider" />

        <!-- Port -->
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
              placeholder=${this._portLoading ? msg("Loading...", { id: "placeholder-loading" }) : ""}
              @input=${(e: Event) => { this._port = parseInt((e.target as HTMLInputElement).value) || 0; }}
            />
            ${this._portError
              ? html`<span class="field-error">${this._portError}</span>`
              : html`<span class="field-hint">${msg("Auto-suggested from free range", { id: "hint-port" })}</span>`}
          </div>
        </div>

        <hr class="divider" />

        <!-- Provider + API Key -->
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
                this._selectedBlueprintId = val ? Number(val) : null;
              }}
            >
              <option value="">${msg("None", { id: "cd-blueprint-none" })}</option>
              ${this._blueprints.map(bp => html`
                <option value="${bp.id}">
                  ${bp.icon ? `${bp.icon} ` : ""}${bp.name}${bp.agent_count ? ` (${bp.agent_count} agents)` : ""}
                </option>
              `)}
            </select>
            <span class="field-hint">${msg("Optionally deploy a team of agents", { id: "cd-blueprint-hint" })}</span>
          </div>
        </div>

        <hr class="divider" />

        <!-- Agents -->
        <div class="section">
          <div class="section-label">${msg("Agent team", { id: "section-agent-team" })}</div>
          <div class="agent-mode-toggle">
            <button
              class="toggle-btn ${this._agentMode === "minimal" ? "active" : ""}"
              @click=${() => { this._agentMode = "minimal"; }}
            >${msg("Minimal (main only)", { id: "toggle-minimal" })}</button>
            <button
              class="toggle-btn ${this._agentMode === "custom" ? "active" : ""}"
              @click=${() => { this._agentMode = "custom"; }}
            >${msg("Custom agents", { id: "toggle-custom" })}</button>
          </div>

          ${this._agentMode === "custom"
            ? html`
                <div class="agents-list">
                  <!-- Main agent (always present, read-only) -->
                  <div class="agent-row">
                    <input type="text" value="main" disabled />
                    <input type="text" value="Main" disabled />
                    <span style="width:28px"></span>
                  </div>
                  <!-- Custom agents -->
                  ${this._customAgents.map((agent, idx) => html`
                    <div class="agent-row">
                      <input
                        type="text"
                        placeholder=${msg("agent-id", { id: "placeholder-agent-id" })}
                        .value=${agent.id}
                        @input=${(e: Event) => this._updateAgent(idx, "id", (e.target as HTMLInputElement).value)}
                      />
                      <input
                        type="text"
                        placeholder=${msg("Display name", { id: "placeholder-agent-name" })}
                        .value=${agent.name}
                        @input=${(e: Event) => this._updateAgent(idx, "name", (e.target as HTMLInputElement).value)}
                      />
                      <button class="agent-remove" aria-label="Supprimer l'agent" @click=${() => this._removeAgent(idx)}>✕</button>
                    </div>
                  `)}
                  <button class="add-agent-btn" @click=${this._addAgent}>${msg("+ Add agent", { id: "btn-add-agent" })}</button>
                </div>
              `
            : html`<span class="field-hint">${msg("Single main agent — you can add more later via CLI", { id: "hint-minimal-agent" })}</span>`}
        </div>

        ${this._submitError
          ? html`<div class="error-banner">${this._submitError}</div>`
          : ""}

      </div>

      <div class="dialog-footer">
        <button class="btn btn-ghost" @click=${this._close}>${msg("Cancel", { id: "btn-cancel-dialog" })}</button>
        <button
          class="btn btn-primary"
          ?disabled=${!this._isFormValid()}
          @click=${this._submit}
        >${msg("Create Instance", { id: "btn-create-instance" })}</button>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("New Instance", { id: "dialog-title" })}</span>
            <button class="close-btn" aria-label="Fermer" @click=${this._close} ?disabled=${this._submitting}>✕</button>
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
