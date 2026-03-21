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
  fetchProfileModels,
  replaceProfileModels,
  importProvidersFromInstance,
  fetchInstances,
} from "../api.js";
import type {
  ProfileSection,
  UserProfile,
  UserProvider,
  UserModelAlias,
  InstanceInfo,
} from "../types.js";

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
  @state() private _models: UserModelAlias[] = [];
  @state() private _instances: InstanceInfo[] = [];
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

  // Model alias editing state
  @state() private _addingAlias = false;
  @state() private _newAliasId = "";
  @state() private _newAliasProvider = "";
  @state() private _newAliasModel = "";

  // Import state
  @state() private _importSlug = "";
  @state() private _importing = false;
  @state() private _importResult: {
    providers: number;
    modelAliases: number;
    apiKeys: number;
  } | null = null;

  // --- Lifecycle ---

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadAll();
  }

  private async _loadAll(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const [profileRes, providersRes, modelsRes, instancesRes] = await Promise.all([
        fetchProfile(),
        fetchProfileProviders(),
        fetchProfileModels(),
        fetchInstances(),
      ]);
      this._profile = profileRes.profile;
      this._providers = providersRes.providers;
      this._models = modelsRes.models;
      this._instances = instancesRes;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
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
      // Reload profile
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
              "models",
              msg("Models", { id: "profile-models" }),
              this._models.length,
            )}
            ${this._renderSidebarItem(
              "instructions",
              msg("Instructions", { id: "profile-instructions" }),
            )}
            ${this._renderSidebarItem("import", msg("Import", { id: "profile-import" }))}
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
      case "models":
        return this._renderModelsSection();
      case "instructions":
        return this._renderInstructionsSection();
      case "import":
        return this._renderImportSection();
    }
  }

  // -----------------------------------------------------------------------
  // General section
  // -----------------------------------------------------------------------

  private _renderGeneralSection() {
    const p = this._profile;
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

          <div class="field">
            <label class="field-label"
              >${msg("Default model", { id: "profile-default-model" })}</label
            >
            <input
              class="field-input mono ${"defaultModel" in this._dirty ? "changed" : ""}"
              type="text"
              placeholder="anthropic/claude-sonnet-4-5"
              .value=${this._getDirty("defaultModel", p?.defaultModel ?? "")}
              @input=${(e: Event) =>
                this._setDirty("defaultModel", (e.target as HTMLInputElement).value || null)}
            />
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
    return html`
      <div class="provider-card">
        <div class="provider-header">
          <div class="provider-header-left">
            <span class="provider-name">${p.providerId}</span>
            <span class="provider-id">${p.apiKeyEnvVar}</span>
          </div>
          <div class="provider-actions">
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

      this._addingProvider = false;
      this._newProviderId = "";
      this._newProviderEnvVar = "";
      this._newProviderKey = "";
      this._newProviderBaseUrl = "";

      const res = await fetchProfileProviders();
      this._providers = res.providers;
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  // -----------------------------------------------------------------------
  // Models section
  // -----------------------------------------------------------------------

  private _renderModelsSection() {
    return html`
      <div class="section">
        <div class="section-header">${msg("Models", { id: "profile-models" })}</div>

        ${this._models.length === 0 && !this._addingAlias
          ? html`<div class="empty-state">
              ${msg("No model aliases configured.", { id: "profile-no-models" })}
            </div>`
          : nothing}
        ${this._models.length > 0
          ? html`
              <table class="model-table">
                <thead>
                  <tr>
                    <th>${msg("Alias", { id: "profile-alias-id" })}</th>
                    <th>${msg("Provider", { id: "profile-model-provider" })}</th>
                    <th>${msg("Model", { id: "profile-model-name" })}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${this._models.map(
                    (m) => html`
                      <tr>
                        <td>${m.aliasId}</td>
                        <td>${m.provider}</td>
                        <td>${m.model}</td>
                        <td>
                          <button
                            class="btn-remove-provider"
                            @click=${() => this._removeModelAlias(m.aliasId)}
                          >
                            ${msg("Remove", { id: "profile-remove-alias" })}
                          </button>
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `
          : nothing}
        ${this._addingAlias ? this._renderAddAliasForm() : nothing}

        <div style="margin-top: 12px">
          <button
            class="btn btn-ghost"
            @click=${() => {
              this._addingAlias = !this._addingAlias;
              this._newAliasId = "";
              this._newAliasProvider = "";
              this._newAliasModel = "";
            }}
          >
            ${this._addingAlias ? "−" : "+"} ${msg("Add alias", { id: "profile-add-alias" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderAddAliasForm() {
    return html`
      <div class="add-form">
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${msg("Alias", { id: "profile-alias-id" })}</label>
            <input
              class="field-input"
              placeholder="fast"
              .value=${this._newAliasId}
              @input=${(e: Event) => {
                this._newAliasId = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Provider", { id: "profile-model-provider" })}</label>
            <input
              class="field-input"
              placeholder="anthropic"
              .value=${this._newAliasProvider}
              @input=${(e: Event) => {
                this._newAliasProvider = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field full-width">
            <label class="field-label">${msg("Model", { id: "profile-model-name" })}</label>
            <input
              class="field-input mono"
              placeholder="claude-haiku-3-5"
              .value=${this._newAliasModel}
              @input=${(e: Event) => {
                this._newAliasModel = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
        </div>
        <div class="add-form-actions">
          <button
            class="btn btn-primary"
            ?disabled=${!this._newAliasId || !this._newAliasProvider || !this._newAliasModel}
            @click=${this._addModelAlias}
          >
            ${msg("Add alias", { id: "profile-add-alias" })}
          </button>
        </div>
      </div>
    `;
  }

  private async _addModelAlias(): Promise<void> {
    const newAlias: UserModelAlias = {
      aliasId: this._newAliasId,
      provider: this._newAliasProvider,
      model: this._newAliasModel,
      contextWindow: null,
    };
    const updated = [...this._models, newAlias];
    try {
      await replaceProfileModels(updated);
      const res = await fetchProfileModels();
      this._models = res.models;
      this._addingAlias = false;
      this._newAliasId = "";
      this._newAliasProvider = "";
      this._newAliasModel = "";
      this._showToast(msg("Profile saved", { id: "profile-saved" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async _removeModelAlias(aliasId: string): Promise<void> {
    const updated = this._models.filter((m) => m.aliasId !== aliasId);
    try {
      await replaceProfileModels(updated);
      const res = await fetchProfileModels();
      this._models = res.models;
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

  // -----------------------------------------------------------------------
  // Import section
  // -----------------------------------------------------------------------

  private _renderImportSection() {
    return html`
      <div class="section">
        <div class="section-header">${msg("Import", { id: "profile-import" })}</div>
        <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px">
          ${msg("Import from instance", { id: "profile-import-from" })}
        </p>
        <div class="import-row">
          <select
            class="field-input"
            .value=${this._importSlug}
            @change=${(e: Event) => {
              this._importSlug = (e.target as HTMLSelectElement).value;
              this._importResult = null;
            }}
          >
            <option value="">
              ${msg("Select instance...", { id: "profile-select-instance" })}
            </option>
            ${this._instances.map(
              (inst) =>
                html`<option value=${inst.slug}>
                  ${inst.display_name || inst.slug} (${inst.slug})
                </option>`,
            )}
          </select>
          <button
            class="btn btn-primary"
            ?disabled=${!this._importSlug || this._importing}
            @click=${this._doImport}
          >
            ${this._importing
              ? msg("Importing...", { id: "profile-importing" })
              : msg("Import", { id: "profile-import-btn" })}
          </button>
        </div>

        ${this._importResult
          ? html`
              <div class="import-result">
                ✓ ${msg("Import successful", { id: "profile-import-success" })} —
                ${this._importResult.providers} providers, ${this._importResult.modelAliases}
                aliases, ${this._importResult.apiKeys} keys
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private async _doImport(): Promise<void> {
    this._importing = true;
    this._importResult = null;
    try {
      const res = await importProvidersFromInstance(this._importSlug);
      this._importResult = res.imported;
      // Reload providers and models
      const [providersRes, modelsRes] = await Promise.all([
        fetchProfileProviders(),
        fetchProfileModels(),
      ]);
      this._providers = providersRes.providers;
      this._models = modelsRes.models;
      // Reload profile too (defaultModel may have changed)
      const profileRes = await fetchProfile();
      this._profile = profileRes.profile;
      this._showToast(msg("Import successful", { id: "profile-import-success" }));
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._importing = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-profile-settings": ProfileSettings;
  }
}
