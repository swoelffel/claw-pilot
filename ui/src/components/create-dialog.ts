import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { AgentDefinition, CreateInstanceRequest } from "../types.js";
import { fetchNextPort, createInstance } from "../api.js";

const MODELS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

@customElement("cp-create-dialog")
export class CreateDialog extends LitElement {
  static styles = css`
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
      background: #1a1d27;
      border: 1px solid #2a2d3a;
      border-radius: 12px;
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
      border-bottom: 1px solid #2a2d3a;
    }

    .dialog-title {
      font-size: 16px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: -0.01em;
    }

    .close-btn {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .close-btn:hover { color: #e2e8f0; }

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

    .section-label {
      font-size: 11px;
      font-weight: 600;
      color: #6c63ff;
      text-transform: uppercase;
      letter-spacing: 0.08em;
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
      color: #94a3b8;
    }

    input[type="text"],
    input[type="number"],
    input[type="password"],
    select {
      background: #0f1117;
      border: 1px solid #2a2d3a;
      border-radius: 6px;
      color: #e2e8f0;
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
      border-color: #6c63ff;
    }
    input.invalid {
      border-color: #ef4444;
    }

    .field-hint {
      font-size: 11px;
      color: #4a5568;
    }
    .field-error {
      font-size: 11px;
      color: #ef4444;
    }

    /* API key toggle */
    .radio-group {
      display: flex;
      gap: 12px;
    }

    .radio-option {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 13px;
      color: #94a3b8;
    }
    .radio-option input[type="radio"] {
      accent-color: #6c63ff;
      width: auto;
    }

    /* Agents section */
    .agent-mode-toggle {
      display: flex;
      gap: 8px;
    }

    .toggle-btn {
      flex: 1;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid #2a2d3a;
      background: #0f1117;
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      text-align: center;
    }
    .toggle-btn.active {
      background: #6c63ff20;
      border-color: #6c63ff60;
      color: #6c63ff;
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
      color: #ef444480;
      cursor: pointer;
      font-size: 16px;
      padding: 4px 6px;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .agent-remove:hover { color: #ef4444; }

    .add-agent-btn {
      background: none;
      border: 1px dashed #2a2d3a;
      border-radius: 6px;
      color: #6c63ff;
      font-size: 13px;
      padding: 8px;
      cursor: pointer;
      transition: all 0.15s;
      width: 100%;
    }
    .add-agent-btn:hover {
      border-color: #6c63ff60;
      background: #6c63ff10;
    }

    /* Divider */
    .divider {
      border: none;
      border-top: 1px solid #2a2d3a;
      margin: 0;
    }

    /* Error banner */
    .error-banner {
      background: #ef444420;
      border: 1px solid #ef444440;
      border-radius: 8px;
      padding: 12px 16px;
      color: #ef4444;
      font-size: 13px;
    }

    /* Spinner overlay */
    .spinner-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 48px 24px;
      color: #94a3b8;
      font-size: 14px;
    }

    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #2a2d3a;
      border-top-color: #6c63ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner-msg {
      color: #64748b;
      font-size: 13px;
    }

    /* Footer actions */
    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 24px 20px;
      border-top: 1px solid #2a2d3a;
    }

    .btn {
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-cancel {
      background: #2a2d3a;
      color: #94a3b8;
    }
    .btn-cancel:hover:not(:disabled) { background: #363a4a; }

    .btn-create {
      background: #6c63ff;
      color: #fff;
    }
    .btn-create:hover:not(:disabled) { background: #7c73ff; }
  `;

  // --- Form state ---
  @state() private _slug = "";
  @state() private _slugError = "";
  @state() private _displayName = "";
  @state() private _port = 0;
  @state() private _portLoading = true;
  @state() private _portError = "";
  @state() private _model = "anthropic/claude-sonnet-4-6";
  @state() private _apiKeyMode: "reuse" | "new" = "reuse";
  @state() private _apiKey = "";
  @state() private _agentMode: "minimal" | "custom" = "minimal";
  @state() private _customAgents: Array<{ id: string; name: string }> = [];

  // --- Submit state ---
  @state() private _submitting = false;
  @state() private _submitError = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadNextPort();
  }

  private async _loadNextPort(): Promise<void> {
    this._portLoading = true;
    this._portError = "";
    try {
      this._port = await fetchNextPort();
    } catch (err) {
      this._portError = err instanceof Error ? err.message : "Could not fetch next port";
      this._port = 18790;
    } finally {
      this._portLoading = false;
    }
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
  }

  private _validateSlug(value: string): string {
    if (!value) return "Slug is required";
    if (!/^[a-z][a-z0-9-]*$/.test(value)) return "Lowercase letters, numbers, hyphens only";
    if (value.length < 2 || value.length > 30) return "Must be 2-30 characters";
    return "";
  }

  private _onSlugInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    this._slug = val;
    this._slugError = this._validateSlug(val);
    // Auto-fill display name if not manually set
    if (!this._displayName || this._displayName === this._slug.slice(0, -1)) {
      this._displayName = val.charAt(0).toUpperCase() + val.slice(1);
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
    if (this._apiKeyMode === "new" && !this._apiKey.trim()) return false;
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
      anthropicApiKey: this._apiKeyMode === "reuse" ? "reuse" : this._apiKey.trim(),
      agents: this._buildAgents(),
    };

    try {
      await createInstance(request);
      this.dispatchEvent(new CustomEvent("instance-created", { bubbles: true, composed: true }));
      this._close();
    } catch (err) {
      this._submitError = err instanceof Error ? err.message : "Provisioning failed";
    } finally {
      this._submitting = false;
    }
  }

  private _renderSpinner() {
    return html`
      <div class="spinner-overlay">
        <div class="spinner"></div>
        <div>Provisioning instance <strong>${this._slug}</strong>...</div>
        <div class="spinner-msg">This may take 20-30 seconds (systemd start + health check)</div>
      </div>
    `;
  }

  private _renderForm() {
    return html`
      <div class="dialog-body">

        <!-- Identity -->
        <div class="section">
          <div class="section-label">Identity</div>
          <div class="field-row">
            <div class="field">
              <label for="slug">Slug *</label>
              <input
                id="slug"
                type="text"
                placeholder="e.g. dev-team"
                .value=${this._slug}
                class=${this._slugError ? "invalid" : ""}
                @input=${this._onSlugInput}
              />
              ${this._slugError
                ? html`<span class="field-error">${this._slugError}</span>`
                : html`<span class="field-hint">Lowercase, 2-30 chars</span>`}
            </div>
            <div class="field">
              <label for="display-name">Display name</label>
              <input
                id="display-name"
                type="text"
                placeholder="e.g. Dev Team"
                .value=${this._displayName}
                @input=${(e: Event) => { this._displayName = (e.target as HTMLInputElement).value; }}
              />
            </div>
          </div>
        </div>

        <hr class="divider" />

        <!-- Port + Model -->
        <div class="section">
          <div class="section-label">Configuration</div>
          <div class="field-row">
            <div class="field">
              <label for="port">Gateway port *</label>
              <input
                id="port"
                type="number"
                min="1024"
                max="65535"
                .value=${this._portLoading ? "" : String(this._port)}
                ?disabled=${this._portLoading}
                placeholder=${this._portLoading ? "Loading..." : ""}
                @input=${(e: Event) => { this._port = parseInt((e.target as HTMLInputElement).value) || 0; }}
              />
              ${this._portError
                ? html`<span class="field-error">${this._portError}</span>`
                : html`<span class="field-hint">Auto-suggested from free range</span>`}
            </div>
            <div class="field">
              <label for="model">Default model *</label>
              <select
                id="model"
                .value=${this._model}
                @change=${(e: Event) => { this._model = (e.target as HTMLSelectElement).value; }}
              >
                ${MODELS.map((m) => html`
                  <option value=${m.value} ?selected=${this._model === m.value}>${m.label}</option>
                `)}
              </select>
            </div>
          </div>
        </div>

        <hr class="divider" />

        <!-- API Key -->
        <div class="section">
          <div class="section-label">Anthropic API Key</div>
          <div class="radio-group">
            <label class="radio-option">
              <input
                type="radio"
                name="apikey"
                value="reuse"
                ?checked=${this._apiKeyMode === "reuse"}
                @change=${() => { this._apiKeyMode = "reuse"; }}
              />
              Reuse from existing instance
            </label>
            <label class="radio-option">
              <input
                type="radio"
                name="apikey"
                value="new"
                ?checked=${this._apiKeyMode === "new"}
                @change=${() => { this._apiKeyMode = "new"; }}
              />
              Enter new key
            </label>
          </div>
          ${this._apiKeyMode === "new"
            ? html`
                <div class="field">
                  <input
                    type="password"
                    placeholder="sk-ant-..."
                    .value=${this._apiKey}
                    @input=${(e: Event) => { this._apiKey = (e.target as HTMLInputElement).value; }}
                  />
                </div>
              `
            : html`<span class="field-hint">Will copy ANTHROPIC_API_KEY from the first registered instance</span>`}
        </div>

        <hr class="divider" />

        <!-- Agents -->
        <div class="section">
          <div class="section-label">Agent team</div>
          <div class="agent-mode-toggle">
            <button
              class="toggle-btn ${this._agentMode === "minimal" ? "active" : ""}"
              @click=${() => { this._agentMode = "minimal"; }}
            >Minimal (main only)</button>
            <button
              class="toggle-btn ${this._agentMode === "custom" ? "active" : ""}"
              @click=${() => { this._agentMode = "custom"; }}
            >Custom agents</button>
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
                        placeholder="agent-id"
                        .value=${agent.id}
                        @input=${(e: Event) => this._updateAgent(idx, "id", (e.target as HTMLInputElement).value)}
                      />
                      <input
                        type="text"
                        placeholder="Display name"
                        .value=${agent.name}
                        @input=${(e: Event) => this._updateAgent(idx, "name", (e.target as HTMLInputElement).value)}
                      />
                      <button class="agent-remove" @click=${() => this._removeAgent(idx)}>✕</button>
                    </div>
                  `)}
                  <button class="add-agent-btn" @click=${this._addAgent}>+ Add agent</button>
                </div>
              `
            : html`<span class="field-hint">Single main agent — you can add more later via CLI</span>`}
        </div>

        ${this._submitError
          ? html`<div class="error-banner">${this._submitError}</div>`
          : ""}

      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click=${this._close}>Cancel</button>
        <button
          class="btn btn-create"
          ?disabled=${!this._isFormValid()}
          @click=${this._submit}
        >Create Instance</button>
      </div>
    `;
  }

  override render() {
    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">New Instance</span>
            <button class="close-btn" @click=${this._close} ?disabled=${this._submitting}>✕</button>
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
