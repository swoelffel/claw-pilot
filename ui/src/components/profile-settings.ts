// ui/src/components/profile-settings.ts
//
// User profile management page — accessible via #/profile.
// Follows the same sidebar + content pattern as cp-instance-settings.

import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { profileSettingsStyles } from "../styles/profile-settings.styles.js";
import {
  fetchProfile,
  patchProfile,
  fetchProfileProviders,
  upsertProfileProvider,
  deleteProfileProvider,
  patchProfileProviderKey,
  discoverProviderModels,
} from "../api.js";
import type { ProfileSection, UserProfile, UserProvider, DiscoveredModel } from "../types.js";

// Known providers for the "Add provider" dropdown
const KNOWN_PROVIDERS = [
  { id: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", envVar: "OPENAI_API_KEY" },
  { id: "google", envVar: "GEMINI_API_KEY" },
  { id: "openrouter", envVar: "OPENROUTER_API_KEY" },
  { id: "mistral", envVar: "MISTRAL_API_KEY" },
  { id: "xai", envVar: "XAI_API_KEY" },
  { id: "ollama", envVar: "" },
];

@localized()
@customElement("cp-profile-settings")
export class ProfileSettings extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    profileSettingsStyles,
  ];

  // --- State ---
  @state() private _profile: UserProfile | null = null;
  @state() private _providers: UserProvider[] = [];
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _activeSection: ProfileSection = "general";
  @state() private _toast: { message: string; type: "success" | "warning" | "error" } | null = null;
  @state() private _dirty: Record<string, unknown> = {};

  // Provider editing state
  @state() private _editingKeyFor: string | null = null;
  @state() private _editKeyValue = "";
  @state() private _addingProvider = false;
  @state() private _newProviderId = "";
  @state() private _newProviderEnvVar = "";
  @state() private _newProviderKey = "";
  @state() private _newProviderBaseUrl = "";

  // Dynamic model discovery state
  @state() private _discoveredModels: Map<string, DiscoveredModel[]> = new Map();
  @state() private _discoveryErrors: Map<string, string> = new Map();
  @state() private _discoveringProviders: Set<string> = new Set();

  // --- Lifecycle ---

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadAll();
  }

  private async _loadAll(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const [profileRes, providersRes] = await Promise.all([
        fetchProfile(),
        fetchProfileProviders(),
      ]);
      this._profile = profileRes.profile;
      this._providers = providersRes.providers;

      // Auto-discover models for providers that have an API key
      void this._discoverAllModels();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  /** Discover models for all providers that have an API key set */
  private async _discoverAllModels(): Promise<void> {
    const providersWithKey = this._providers.filter((p) => p.hasApiKey);
    await Promise.allSettled(providersWithKey.map((p) => this._discoverModelsFor(p.providerId)));
  }

  private async _discoverModelsFor(providerId: string): Promise<void> {
    this._discoveringProviders = new Set([...this._discoveringProviders, providerId]);
    this.requestUpdate();

    try {
      const res = await discoverProviderModels(providerId);
      const newModels = new Map(this._discoveredModels);
      const newErrors = new Map(this._discoveryErrors);

      if (res.error) {
        newErrors.set(providerId, res.error);
        newModels.delete(providerId);
      } else {
        newModels.set(providerId, res.models);
        newErrors.delete(providerId);
      }

      this._discoveredModels = newModels;
      this._discoveryErrors = newErrors;
    } catch (err) {
      const newErrors = new Map(this._discoveryErrors);
      newErrors.set(providerId, err instanceof Error ? err.message : String(err));
      this._discoveryErrors = newErrors;
    } finally {
      const updated = new Set(this._discoveringProviders);
      updated.delete(providerId);
      this._discoveringProviders = updated;
      this.requestUpdate();
    }
  }

  // --- Dirty tracking ---

  private _setDirty(key: string, value: unknown): void {
    this._dirty = { ...this._dirty, [key]: value };
  }

  private _getDirty<T>(key: string, fallback: T): T {
    return key in this._dirty ? (this._dirty[key] as T) : fallback;
  }

  private get _hasChanges(): boolean {
    return Object.keys(this._dirty).length > 0;
  }

  // --- Toast ---

  private _showToast(message: string, type: "success" | "warning" | "error" = "success"): void {
    this._toast = { message, type };
    setTimeout(() => {
      this._toast = null;
    }, 4000);
  }

  // --- Save (General + Instructions) ---

  private async _save(): Promise<void> {
    if (!this._hasChanges) return;
    this._saving = true;
    try {
      await patchProfile(this._dirty as Record<string, string | null>);
      this._dirty = {};
      const res = await fetchProfile();
      this._profile = res.profile;
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._saving = false;
    }
  }

  private _cancelChanges(): void {
    this._dirty = {};
  }

  // --- Navigation ---

  private _navigateBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", { detail: { view: "cluster" }, bubbles: true, composed: true }),
    );
  }

  // --- All discovered models (aggregated) ---

  private get _allModels(): Array<{ providerId: string; models: DiscoveredModel[] }> {
    const result: Array<{ providerId: string; models: DiscoveredModel[] }> = [];
    for (const [providerId, models] of this._discoveredModels) {
      if (models.length > 0) result.push({ providerId, models });
    }
    return result;
  }

  // --- Render ---

  override render() {
    if (this._loading) {
      return html`<div class="loading-container">
        <div class="spinner"></div>
        ${msg("Loading profile...", { id: "profile-loading" })}
      </div>`;
    }

    if (this._error) {
      return html`<div class="error-banner">${this._error}</div>`;
    }

    return html`
      <div class="settings-header">
        <div class="header-left">
          <button class="back-btn" @click=${this._navigateBack}>
            ← ${msg("Back", { id: "profile-back" })}
          </button>
          <div class="header-title">👤 ${msg("Profile", { id: "profile-title" })}</div>
        </div>
        <div class="header-right">
          ${this._hasChanges
            ? html`
                <button class="btn btn-ghost" @click=${this._cancelChanges}>
                  ${msg("Cancel", { id: "profile-cancel" })}
                </button>
                <button class="btn btn-primary" ?disabled=${this._saving} @click=${this._save}>
                  ${this._saving
                    ? msg("Saving...", { id: "profile-saving" })
                    : msg("Save", { id: "profile-save" })}
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="settings-layout">
        <nav class="sidebar">
          <div class="sidebar-nav">
            ${this._renderSidebarItem("general", msg("General", { id: "profile-general" }))}
            ${this._renderSidebarItem(
              "providers",
              msg("Providers", { id: "profile-providers" }),
              this._providers.length,
            )}
            ${this._renderSidebarItem(
              "instructions",
              msg("Instructions", { id: "profile-instructions" }),
            )}
          </div>
        </nav>

        <div class="content">${this._renderActiveSection()}</div>
      </div>

      ${this._toast
        ? html`<div class="toast ${this._toast.type}">${this._toast.message}</div>`
        : nothing}
    `;
  }

  private _renderSidebarItem(section: ProfileSection, label: string, count?: number) {
    return html`
      <button
        class="sidebar-item ${this._activeSection === section ? "active" : ""}"
        @click=${() => {
          this._activeSection = section;
        }}
      >
        ${label}
        ${count !== undefined && count > 0
          ? html`<span class="sidebar-badge">${count}</span>`
          : nothing}
      </button>
    `;
  }

  private _renderActiveSection() {
    switch (this._activeSection) {
      case "general":
        return this._renderGeneralSection();
      case "providers":
        return this._renderProvidersSection();
      case "instructions":
        return this._renderInstructionsSection();
    }
  }

  // -----------------------------------------------------------------------
  // General section
  // -----------------------------------------------------------------------

  private _renderGeneralSection() {
    const p = this._profile;
    const currentModel = this._getDirty("defaultModel", p?.defaultModel ?? "") as string;

    return html`
      <div class="section">
        <div class="section-header">${msg("General", { id: "profile-general" })}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label"
              >${msg("Display name", { id: "profile-display-name" })}</label
            >
            <input
              class="field-input ${"displayName" in this._dirty ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("displayName", p?.displayName ?? "")}
              @input=${(e: Event) =>
                this._setDirty("displayName", (e.target as HTMLInputElement).value || null)}
            />
          </div>

          <div class="field">
            <label class="field-label">${msg("Language", { id: "profile-language" })}</label>
            <select
              class="field-input ${"language" in this._dirty ? "changed" : ""}"
              .value=${this._getDirty("language", p?.language ?? "fr")}
              @change=${(e: Event) =>
                this._setDirty("language", (e.target as HTMLSelectElement).value)}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="it">Italiano</option>
              <option value="pt">Português</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">${msg("Timezone", { id: "profile-timezone" })}</label>
            <input
              class="field-input ${"timezone" in this._dirty ? "changed" : ""}"
              type="text"
              placeholder="Europe/Paris"
              .value=${this._getDirty("timezone", p?.timezone ?? "")}
              @input=${(e: Event) =>
                this._setDirty("timezone", (e.target as HTMLInputElement).value || null)}
            />
          </div>

          <div class="field">
            <label class="field-label"
              >${msg("Communication style", { id: "profile-communication-style" })}</label
            >
            <select
              class="field-input ${"communicationStyle" in this._dirty ? "changed" : ""}"
              .value=${this._getDirty("communicationStyle", p?.communicationStyle ?? "concise")}
              @change=${(e: Event) =>
                this._setDirty("communicationStyle", (e.target as HTMLSelectElement).value)}
            >
              <option value="concise">${msg("Concise", { id: "profile-style-concise" })}</option>
              <option value="detailed">${msg("Detailed", { id: "profile-style-detailed" })}</option>
              <option value="technical">
                ${msg("Technical", { id: "profile-style-technical" })}
              </option>
            </select>
          </div>

          <div class="field full-width">
            <label class="field-label">${msg("Avatar URL", { id: "profile-avatar-url" })}</label>
            <div class="avatar-row">
              <div class="avatar-preview">
                ${p?.avatarUrl || ("avatarUrl" in this._dirty && this._dirty["avatarUrl"])
                  ? html`<img
                      src=${this._getDirty("avatarUrl", p?.avatarUrl ?? "") as string}
                      alt=""
                      @error=${(e: Event) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />`
                  : "👤"}
              </div>
              <input
                class="field-input ${"avatarUrl" in this._dirty ? "changed" : ""}"
                type="text"
                placeholder="https://..."
                .value=${this._getDirty("avatarUrl", p?.avatarUrl ?? "")}
                @input=${(e: Event) =>
                  this._setDirty("avatarUrl", (e.target as HTMLInputElement).value || null)}
                style="flex:1"
              />
            </div>
          </div>

          <div class="field full-width">
            <label class="field-label"
              >${msg("Default model", { id: "profile-default-model" })}</label
            >
            <div class="avatar-row">
              <select
                class="field-input ${"defaultModel" in this._dirty ? "changed" : ""}"
                .value=${currentModel}
                @change=${(e: Event) =>
                  this._setDirty("defaultModel", (e.target as HTMLSelectElement).value || null)}
                style="flex:1"
              >
                <option value="">
                  ${msg("Select default model...", { id: "profile-select-model" })}
                </option>
                ${this._allModels.map(
                  (group) => html`
                    <optgroup label=${group.providerId}>
                      ${group.models.map(
                        (m) => html`
                          <option value="${group.providerId}/${m.id}">${m.name || m.id}</option>
                        `,
                      )}
                    </optgroup>
                  `,
                )}
                ${currentModel &&
                !this._allModels.some((g) =>
                  g.models.some((m) => `${g.providerId}/${m.id}` === currentModel),
                )
                  ? html`<option value=${currentModel} selected>${currentModel}</option>`
                  : nothing}
              </select>
              <button
                class="btn btn-ghost"
                @click=${() => void this._discoverAllModels()}
                title=${msg("Refresh", { id: "profile-refresh-models" })}
              >
                ↻
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Providers section
  // -----------------------------------------------------------------------

  private _renderProvidersSection() {
    return html`
      <div class="section">
        <div class="section-header">${msg("Providers", { id: "profile-providers" })}</div>

        ${this._providers.length === 0 && !this._addingProvider
          ? html`<div class="empty-state">
              ${msg("No providers configured.", { id: "profile-no-providers" })}
            </div>`
          : nothing}
        ${this._providers.map((p) => this._renderProviderCard(p))}
        ${this._addingProvider ? this._renderAddProviderForm() : nothing}

        <div style="margin-top: 12px">
          <button
            class="btn btn-ghost"
            @click=${() => {
              this._addingProvider = !this._addingProvider;
              this._newProviderId = "";
              this._newProviderEnvVar = "";
              this._newProviderKey = "";
              this._newProviderBaseUrl = "";
            }}
          >
            ${this._addingProvider ? "−" : "+"}
            ${msg("Add provider", { id: "profile-add-provider" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderProviderCard(p: UserProvider) {
    const modelCount = this._discoveredModels.get(p.providerId)?.length;
    const discoveryError = this._discoveryErrors.get(p.providerId);
    const isDiscovering = this._discoveringProviders.has(p.providerId);

    return html`
      <div class="provider-card">
        <div class="provider-header">
          <div class="provider-header-left">
            <span class="provider-name">${p.providerId}</span>
            <span class="provider-id">${p.apiKeyEnvVar}</span>
            ${modelCount !== undefined
              ? html`<span class="key-status set"
                  >${modelCount} ${msg("models", { id: "profile-models-available" })}</span
                >`
              : nothing}
            ${discoveryError
              ? html`<span class="key-status missing"
                  >${msg("Connection failed", { id: "profile-models-error" })}</span
                >`
              : nothing}
          </div>
          <div class="provider-actions">
            <button
              class="btn-change-key"
              ?disabled=${isDiscovering}
              @click=${() => void this._discoverModelsFor(p.providerId)}
            >
              ${isDiscovering ? "..." : msg("Test", { id: "profile-test-provider" })}
            </button>
            <button class="btn-change-key" @click=${() => this._startEditKey(p.providerId)}>
              ${msg("Change key", { id: "profile-change-key" })}
            </button>
            <button class="btn-remove-provider" @click=${() => this._removeProvider(p.providerId)}>
              ${msg("Remove", { id: "profile-remove-provider" })}
            </button>
          </div>
        </div>
        <div class="provider-key-row">
          ${p.hasApiKey
            ? html`
                <span class="key-status set">✓</span>
                <span class="masked-key">${p.apiKeyMasked}</span>
              `
            : html`<span class="key-status missing"
                >${msg("Not set", { id: "profile-key-not-set" })}</span
              >`}
        </div>
        ${this._editingKeyFor === p.providerId ? this._renderKeyEditRow(p.providerId) : nothing}
      </div>
    `;
  }

  private _renderKeyEditRow(providerId: string) {
    return html`
      <div class="key-edit-row">
        <input
          class="field-input mono"
          type="password"
          placeholder="${msg("API key", { id: "profile-api-key" })}"
          .value=${this._editKeyValue}
          @input=${(e: Event) => {
            this._editKeyValue = (e.target as HTMLInputElement).value;
          }}
        />
        <button
          class="btn btn-primary"
          ?disabled=${!this._editKeyValue}
          @click=${() => this._saveProviderKey(providerId)}
        >
          ${msg("Save", { id: "profile-save" })}
        </button>
        <button
          class="btn btn-ghost"
          @click=${() => {
            this._editingKeyFor = null;
            this._editKeyValue = "";
          }}
        >
          ${msg("Cancel", { id: "profile-cancel" })}
        </button>
      </div>
    `;
  }

  private _renderAddProviderForm() {
    return html`
      <div class="add-form">
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${msg("Provider ID", { id: "profile-provider-id" })}</label>
            <select
              class="field-input"
              .value=${this._newProviderId}
              @change=${(e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                this._newProviderId = id;
                const known = KNOWN_PROVIDERS.find((p) => p.id === id);
                if (known) this._newProviderEnvVar = known.envVar;
              }}
            >
              <option value="">—</option>
              ${KNOWN_PROVIDERS.filter(
                (kp) => !this._providers.some((p) => p.providerId === kp.id),
              ).map((kp) => html`<option value=${kp.id}>${kp.id}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">${msg("Env variable", { id: "profile-env-var" })}</label>
            <input
              class="field-input mono"
              .value=${this._newProviderEnvVar}
              @input=${(e: Event) => {
                this._newProviderEnvVar = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("API key", { id: "profile-api-key" })}</label>
            <input
              class="field-input mono"
              type="password"
              .value=${this._newProviderKey}
              @input=${(e: Event) => {
                this._newProviderKey = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Base URL", { id: "profile-base-url" })}</label>
            <input
              class="field-input mono"
              placeholder="https://..."
              .value=${this._newProviderBaseUrl}
              @input=${(e: Event) => {
                this._newProviderBaseUrl = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
        </div>
        <div class="add-form-actions">
          <button
            class="btn btn-primary"
            ?disabled=${!this._newProviderId || !this._newProviderEnvVar}
            @click=${this._addProvider}
          >
            ${msg("Add provider", { id: "profile-add-provider" })}
          </button>
        </div>
      </div>
    `;
  }

  private _startEditKey(providerId: string): void {
    this._editingKeyFor = providerId;
    this._editKeyValue = "";
  }

  private async _saveProviderKey(providerId: string): Promise<void> {
    try {
      await patchProfileProviderKey(providerId, this._editKeyValue);
      this._editingKeyFor = null;
      this._editKeyValue = "";
      const res = await fetchProfileProviders();
      this._providers = res.providers;
      // Auto-discover models for the updated provider
      void this._discoverModelsFor(providerId);
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async _removeProvider(providerId: string): Promise<void> {
    try {
      await deleteProfileProvider(providerId);
      const res = await fetchProfileProviders();
      this._providers = res.providers;
      // Remove discovered models for this provider
      const newModels = new Map(this._discoveredModels);
      newModels.delete(providerId);
      this._discoveredModels = newModels;
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async _addProvider(): Promise<void> {
    try {
      await upsertProfileProvider(this._newProviderId, {
        apiKeyEnvVar: this._newProviderEnvVar,
        ...(this._newProviderBaseUrl ? { baseUrl: this._newProviderBaseUrl } : {}),
      });

      if (this._newProviderKey) {
        await patchProfileProviderKey(this._newProviderId, this._newProviderKey);
      }

      const addedProviderId = this._newProviderId;
      this._addingProvider = false;
      this._newProviderId = "";
      this._newProviderEnvVar = "";
      this._newProviderKey = "";
      this._newProviderBaseUrl = "";

      const res = await fetchProfileProviders();
      this._providers = res.providers;
      // Auto-discover models for the new provider
      void this._discoverModelsFor(addedProviderId);
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  // -----------------------------------------------------------------------
  // Instructions section
  // -----------------------------------------------------------------------

  private _renderInstructionsSection() {
    const current = this._getDirty(
      "customInstructions",
      this._profile?.customInstructions ?? "",
    ) as string;
    const charCount = current.length;
    return html`
      <div class="section">
        <div class="section-header">${msg("Instructions", { id: "profile-instructions" })}</div>
        <div class="field-hint">
          ${msg("Markdown supported. Max 10,000 characters.", { id: "profile-instructions-hint" })}
        </div>
        <textarea
          class="instructions-textarea"
          maxlength="10000"
          .value=${current}
          @input=${(e: Event) =>
            this._setDirty("customInstructions", (e.target as HTMLTextAreaElement).value || null)}
        ></textarea>
        <div class="char-counter ${charCount > 9000 ? "warning" : ""}">
          ${charCount} / 10 000 ${msg("characters", { id: "profile-char-count" })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-profile-settings": ProfileSettings;
  }
}
