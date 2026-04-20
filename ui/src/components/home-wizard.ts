// ui/src/components/home-wizard.ts
//
// cp-home-wizard — First-run setup form.
// Collects: AI provider + API key + model, user profile (name, language, timezone).

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import { fetchProviders, createNamedKey, ensureSystemInstance, patchProfile } from "../api.js";
import { allLocales } from "../localization.js";
import type { SupportedLocale } from "../localization.js";
import type { ProviderInfo } from "../types.js";

const COMMON_TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Lisbon",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Africa/Johannesburg",
  "UTC",
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function detectLanguage(): SupportedLocale {
  const lang = navigator.language ?? "en";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("it")) return "it";
  if (lang.startsWith("pt")) return "pt";
  return "en";
}

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
      max-width: 480px;
      width: 100%;
      margin: 0 auto;
      padding: 48px 24px 32px;
      overflow-y: auto;
    }

    .wizard-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary, #e0e0e0);
      margin: 0 0 6px;
    }

    .wizard-subtitle {
      font-size: 14px;
      color: var(--text-secondary, #888);
      margin: 0 0 32px;
      line-height: 1.5;
    }

    /* --- Sections --- */

    .section {
      margin-bottom: 28px;
    }

    .section-header {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted, #666);
      padding-bottom: 10px;
      border-bottom: 1px solid var(--bg-border, #2a2a3a);
      margin-bottom: 16px;
    }

    /* --- Fields --- */

    .field-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field.full-width {
      grid-column: 1 / -1;
    }

    .field-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted, #666);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .field-input {
      padding: 8px 12px;
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--bg-border, #2a2a3a);
      background: var(--bg-base, #0f1117);
      color: var(--text-primary, #e0e0e0);
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }

    .field-input:focus {
      border-color: var(--accent, #4f6ef7);
      box-shadow: 0 0 0 2px rgba(79, 110, 247, 0.15);
    }

    select.field-input {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
      cursor: pointer;
    }

    .field-hint {
      font-size: 11px;
      color: var(--text-muted, #666);
    }

    /* --- Error --- */

    .error-banner {
      padding: 10px 14px;
      border-radius: var(--radius-md, 8px);
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: var(--state-error, #ef4444);
      font-size: 13px;
      margin-bottom: 16px;
    }

    /* --- Button --- */

    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }

    .btn-primary {
      padding: 10px 28px;
      border-radius: var(--radius-md, 8px);
      border: none;
      background: var(--accent, #4f6ef7);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .btn-primary:hover {
      opacity: 0.9;
    }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
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

  // --- Provider fields ---
  @state() private _providers: ProviderInfo[] = [];
  @state() private _selectedProvider = "";
  @state() private _apiKey = "";
  @state() private _keyName = "";
  @state() private _selectedModel = "";

  // --- Profile fields ---
  @state() private _displayName = "";
  @state() private _language: SupportedLocale = detectLanguage();
  @state() private _timezone = detectTimezone();

  // --- UI state ---
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

  private _isFormValid(): boolean {
    const provider = this._getSelectedProviderInfo();
    if (!provider) return false;
    if (provider.requiresKey && !this._apiKey.trim()) return false;
    if (!this._selectedModel) return false;
    return true;
  }

  private async _handleSubmit(): Promise<void> {
    if (!this._isFormValid() || this._submitting) return;

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

      // 2. Save profile. The agent language (used for greetings and prompt
      // injection) comes from this row — silently swallowing a failure here
      // leaves the profile empty and makes the agent reply in English even
      // when the user picked another language.
      await patchProfile({
        ...(this._displayName ? { displayName: this._displayName } : {}),
        language: this._language,
        ...(this._timezone ? { timezone: this._timezone } : {}),
      });

      // 3. Provision and start system instance
      await ensureSystemInstance(result.key.id);

      // 4. Notify parent
      this.dispatchEvent(new CustomEvent("wizard-complete", { bubbles: true, composed: true }));
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._submitting = false;
    }
  }

  override render() {
    const provider = this._getSelectedProviderInfo();

    return html`
      <div class="wizard-container">
        <h1 class="wizard-title">
          ${msg("Welcome to ClawPilot!", { id: "wizard-welcome-title" })}
        </h1>
        <p class="wizard-subtitle">
          ${msg("Set up your AI provider and profile to get started.", {
            id: "wizard-welcome-subtitle",
          })}
        </p>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}

        <!-- AI Provider section -->
        <div class="section">
          <div class="section-header">${msg("AI Provider", { id: "wizard-provider-section" })}</div>
          <div class="field-grid">
            <div class="field">
              <label class="field-label">
                ${msg("Provider", { id: "wizard-provider-label" })}
              </label>
              <select
                class="field-input"
                .value=${this._selectedProvider}
                @change=${(e: Event) => {
                  this._selectedProvider = (e.target as HTMLSelectElement).value;
                  const p = this._getSelectedProviderInfo();
                  if (p) this._selectedModel = p.defaultModel;
                }}
              >
                ${this._providers.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
              </select>
            </div>

            <div class="field">
              <label class="field-label">
                ${msg("Default model", { id: "wizard-model-label" })}
              </label>
              <select
                class="field-input"
                .value=${this._selectedModel}
                @change=${(e: Event) => {
                  this._selectedModel = (e.target as HTMLSelectElement).value;
                }}
              >
                ${(provider?.models ?? []).map((m) => html`<option value=${m}>${m}</option>`)}
              </select>
            </div>

            ${provider?.requiresKey
              ? html`
                  <div class="field full-width">
                    <label class="field-label">
                      ${msg("API Key", { id: "wizard-api-key-label" })}
                    </label>
                    <input
                      class="field-input"
                      type="password"
                      placeholder="sk-..."
                      .value=${this._apiKey}
                      @input=${(e: Event) => {
                        this._apiKey = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                `
              : ""}

            <div class="field full-width">
              <label class="field-label">
                ${msg("Key name", { id: "wizard-key-name-label" })}
              </label>
              <input
                class="field-input"
                type="text"
                placeholder="${this._selectedProvider}-key"
                .value=${this._keyName}
                @input=${(e: Event) => {
                  this._keyName = (e.target as HTMLInputElement).value;
                }}
              />
              <span class="field-hint">
                ${msg("Optional — helps identify this key later.", {
                  id: "wizard-key-name-hint",
                })}
              </span>
            </div>
          </div>
        </div>

        <!-- Profile section -->
        <div class="section">
          <div class="section-header">${msg("Your Profile", { id: "wizard-profile-section" })}</div>
          <div class="field-grid">
            <div class="field full-width">
              <label class="field-label">
                ${msg("Display name", { id: "wizard-display-name-label" })}
              </label>
              <input
                class="field-input"
                type="text"
                placeholder=${msg("Your name", { id: "wizard-display-name-placeholder" })}
                .value=${this._displayName}
                @input=${(e: Event) => {
                  this._displayName = (e.target as HTMLInputElement).value;
                }}
              />
            </div>

            <div class="field">
              <label class="field-label">
                ${msg("Language", { id: "wizard-language-label" })}
              </label>
              <select
                class="field-input"
                .value=${this._language}
                @change=${(e: Event) => {
                  this._language = (e.target as HTMLSelectElement).value as SupportedLocale;
                }}
              >
                ${allLocales.map((l) => html`<option value=${l.code}>${l.flag} ${l.name}</option>`)}
              </select>
            </div>

            <div class="field">
              <label class="field-label">
                ${msg("Timezone", { id: "wizard-timezone-label" })}
              </label>
              <select
                class="field-input"
                .value=${this._timezone}
                @change=${(e: Event) => {
                  this._timezone = (e.target as HTMLSelectElement).value;
                }}
              >
                ${COMMON_TIMEZONES.map(
                  (tz) => html`<option value=${tz}>${tz.replace(/_/g, " ")}</option>`,
                )}
              </select>
            </div>
          </div>
        </div>

        <!-- Submit -->
        <div class="actions">
          <button
            class="btn-primary"
            ?disabled=${!this._isFormValid() || this._submitting}
            @click=${() => void this._handleSubmit()}
          >
            ${this._submitting
              ? html`<span class="spinner-small"></span>${msg("Setting up...", {
                    id: "wizard-setting-up",
                  })}`
              : msg("Get Started", { id: "wizard-get-started" })}
          </button>
        </div>
      </div>
    `;
  }
}
