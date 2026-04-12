// ui/src/components/home-wizard.ts
//
// cp-home-wizard — First-run setup wizard with a chat-styled UI.
// Guides the user through: provider selection → API key → model → confirm.

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import { fetchProviders, createNamedKey, ensureSystemInstance } from "../api.js";
import type { ProviderInfo } from "../types.js";

type WizardStep = "welcome" | "provider" | "credentials" | "model" | "confirm" | "done";

@customElement("cp-home-wizard")
export class HomeWizard extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .wizard-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      max-width: 640px;
      margin: 0 auto;
      padding: 32px 20px;
      gap: 0;
      overflow-y: auto;
    }

    /* Chat-style bubble layout */
    .bubble {
      padding: 14px 18px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.6;
      max-width: 85%;
      margin-bottom: 12px;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .bubble.system {
      background: var(--surface, #1a1a2e);
      border: 1px solid var(--border, #333);
      color: var(--text-primary, #e0e0e0);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .bubble.user {
      background: var(--accent, #7c5cfc);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }

    label {
      font-size: 12px;
      color: var(--text-secondary, #888);
      font-weight: 500;
    }

    select,
    input {
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border, #333);
      background: var(--bg, #0d0d1a);
      color: var(--text-primary, #e0e0e0);
      font-size: 14px;
      outline: none;
    }

    select:focus,
    input:focus {
      border-color: var(--accent, #7c5cfc);
    }

    .btn-primary {
      padding: 10px 24px;
      border-radius: 8px;
      border: none;
      background: var(--accent, #7c5cfc);
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 12px;
      align-self: flex-end;
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error {
      color: var(--danger, #ef4444);
      font-size: 12px;
      margin-top: 4px;
    }

    .success-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .spinner-small {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  @state() private _step: WizardStep = "welcome";
  @state() private _providers: ProviderInfo[] = [];
  @state() private _selectedProvider = "";
  @state() private _apiKey = "";
  @state() private _selectedModel = "";
  @state() private _keyName = "";
  @state() private _error: string | null = null;
  @state() private _submitting = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadProviders();
  }

  private async _loadProviders(): Promise<void> {
    try {
      const { providers } = await fetchProviders();
      this._providers = providers;
      // Default to first provider that requires a key
      const first = providers.find((p) => p.requiresKey) ?? providers[0];
      if (first) {
        this._selectedProvider = first.id;
        this._selectedModel = first.defaultModel;
      }
    } catch (err) {
      this._error = String(err);
    }
  }

  private _getSelectedProviderInfo(): ProviderInfo | undefined {
    return this._providers.find((p) => p.id === this._selectedProvider);
  }

  private async _handleConfirm(): Promise<void> {
    this._submitting = true;
    this._error = null;

    try {
      // 1. Create the named key
      const result = await createNamedKey({
        name: this._keyName || `${this._selectedProvider}-key`,
        providerId: this._selectedProvider,
        apiKey: this._apiKey,
        defaultModel: this._selectedModel,
      });

      // 2. Provision and start system instance
      await ensureSystemInstance(result.key.id);

      this._step = "done";

      // 3. Notify parent
      this.dispatchEvent(new CustomEvent("wizard-complete", { bubbles: true, composed: true }));
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._submitting = false;
    }
  }

  override render() {
    return html`
      <div class="wizard-container">
        ${this._renderWelcome()} ${this._step !== "welcome" ? this._renderProviderStep() : ""}
        ${this._step === "credentials" ||
        this._step === "model" ||
        this._step === "confirm" ||
        this._step === "done"
          ? this._renderApiKeyStep()
          : ""}
        ${this._step === "model" || this._step === "confirm" || this._step === "done"
          ? this._renderModelStep()
          : ""}
        ${this._step === "confirm" || this._step === "done" ? this._renderConfirmStep() : ""}
        ${this._step === "done" ? this._renderDoneStep() : ""}
      </div>
    `;
  }

  private _renderWelcome() {
    return html`
      <div class="bubble system">
        <strong>${msg("Welcome to ClawPilot!", { id: "wizard-welcome-title" })}</strong><br />
        ${msg(
          "I'm your system assistant. Before we begin, let's set up your first AI provider API key so I can start helping you manage your agents.",
          { id: "wizard-welcome-body" },
        )}
      </div>
      ${this._step === "welcome"
        ? html`
            <button
              class="btn-primary"
              @click=${() => {
                this._step = "provider";
              }}
            >
              ${msg("Let's get started", { id: "wizard-start-btn" })}
            </button>
          `
        : ""}
    `;
  }

  private _renderProviderStep() {
    const provider = this._getSelectedProviderInfo();
    return html`
      <div class="bubble system">
        ${msg("Which AI provider would you like to use?", { id: "wizard-provider-question" })}
        <div class="form-group">
          <select
            .value=${this._selectedProvider}
            @change=${(e: Event) => {
              this._selectedProvider = (e.target as HTMLSelectElement).value;
              const p = this._getSelectedProviderInfo();
              if (p) this._selectedModel = p.defaultModel;
            }}
            ?disabled=${this._step !== "provider"}
          >
            ${this._providers.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
          </select>
        </div>
      </div>
      ${this._step === "provider" && provider
        ? html`
            <div class="bubble user">${provider.label}</div>
            <button
              class="btn-primary"
              @click=${() => {
                this._step = provider.requiresKey ? "credentials" : "model";
              }}
            >
              ${msg("Continue", { id: "wizard-continue" })}
            </button>
          `
        : ""}
    `;
  }

  private _renderApiKeyStep() {
    return html`
      <div class="bubble system">
        ${msg("Enter your API key:", { id: "wizard-credentials-label" })}
        <div class="form-group">
          <label>${msg("Key name (optional)", { id: "wizard-key-name" })}</label>
          <input
            type="text"
            placeholder="My API Key"
            .value=${this._keyName}
            @input=${(e: Event) => {
              this._keyName = (e.target as HTMLInputElement).value;
            }}
            ?disabled=${this._step !== "credentials"}
          />
          <label>${msg("API Key", { id: "wizard-credentials-input" })}</label>
          <input
            type="password"
            placeholder="sk-..."
            .value=${this._apiKey}
            @input=${(e: Event) => {
              this._apiKey = (e.target as HTMLInputElement).value;
            }}
            ?disabled=${this._step !== "credentials"}
          />
        </div>
      </div>
      ${this._step === "credentials"
        ? html`
            <button
              class="btn-primary"
              ?disabled=${!this._apiKey.trim()}
              @click=${() => {
                this._step = "model";
              }}
            >
              ${msg("Continue", { id: "wizard-continue" })}
            </button>
          `
        : ""}
    `;
  }

  private _renderModelStep() {
    const provider = this._getSelectedProviderInfo();
    const models = provider?.models ?? [];
    return html`
      <div class="bubble system">
        ${msg("Choose your default model:", { id: "wizard-model-label" })}
        <div class="form-group">
          <select
            .value=${this._selectedModel}
            @change=${(e: Event) => {
              this._selectedModel = (e.target as HTMLSelectElement).value;
            }}
            ?disabled=${this._step !== "model"}
          >
            ${models.map((m) => html`<option value=${m}>${m}</option>`)}
          </select>
        </div>
      </div>
      ${this._step === "model"
        ? html`
            <div class="bubble user">${this._selectedModel}</div>
            <button
              class="btn-primary"
              @click=${() => {
                this._step = "confirm";
              }}
            >
              ${msg("Continue", { id: "wizard-continue" })}
            </button>
          `
        : ""}
    `;
  }

  private _renderConfirmStep() {
    return html`
      <div class="bubble system">
        ${msg("Everything is ready! Here's a summary:", { id: "wizard-confirm-title" })}<br /><br />
        <strong>${msg("Provider:", { id: "wizard-summary-provider" })}</strong>
        ${this._getSelectedProviderInfo()?.label ?? this._selectedProvider}<br />
        <strong>${msg("Model:", { id: "wizard-summary-model" })}</strong>
        ${this._selectedModel}<br />
        <strong>${msg("Key name:", { id: "wizard-summary-key" })}</strong>
        ${this._keyName || `${this._selectedProvider}-key`}
        ${this._error ? html`<div class="error">${this._error}</div>` : ""}
      </div>
      ${this._step === "confirm"
        ? html`
            <button
              class="btn-primary"
              ?disabled=${this._submitting}
              @click=${() => void this._handleConfirm()}
            >
              ${this._submitting
                ? html`<span class="spinner-small"></span>${msg("Setting up...", {
                      id: "wizard-setting-up",
                    })}`
                : msg("Get Started", { id: "wizard-get-started" })}
            </button>
          `
        : ""}
    `;
  }

  private _renderDoneStep() {
    return html`
      <div class="bubble system">
        ${msg("System instance is being set up. One moment...", { id: "wizard-done" })}
      </div>
    `;
  }
}
