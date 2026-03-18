import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  InstanceConfig,
  ConfigPatchResult,
  ProviderInfo,
  ProviderEntry,
  AgentBuilderInfo,
  AgentLink,
  PanelContext,
  SidebarSection,
} from "../types.js";
import {
  fetchInstanceConfig,
  patchInstanceConfig,
  fetchProviders,
  fetchBuilderData,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { instanceSettingsStyles } from "../styles/instance-settings.styles.js";
import "./agent-detail-panel.js";
import "./instance-mcp.js";
import "./instance-permissions.js";
import "./instance-config.js";
import "./instance-channels.js";

@localized()
@customElement("cp-instance-settings")
export class InstanceSettings extends LitElement {
  static override styles = [
    tokenStyles,
    badgeStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    instanceSettingsStyles,
  ];

  // ── Public properties ────────────────────────────────────────────────────

  @property({ type: String }) slug = "";
  @property({ type: String }) initialSection: SidebarSection = "general";

  // ── Config state ─────────────────────────────────────────────────────────

  @state() private _config: InstanceConfig | null = null;
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _activeSection: SidebarSection = "general";
  @state() private _toast: { message: string; type: "success" | "warning" | "error" } | null = null;
  @state() private _instanceState: string = "unknown";
  @state() private _saveWarning = "";

  // Dirty tracking — stores modified values
  @state() private _dirty: Record<string, unknown> = {};
  @state() private _heartbeatEveryError = "";

  // ── Providers state ───────────────────────────────────────────────────────

  // Catalog from /api/providers — used for "Add provider" dropdown
  @state() private _providerCatalog: ProviderInfo[] = [];
  @state() private _editingKeyForProvider: string | null = null;
  @state() private _editingBaseUrlForProvider: string | null = null;
  @state() private _addedProviders: Array<{ id: string; apiKey: string; baseUrl?: string }> = [];
  @state() private _removedProviders: string[] = [];
  @state() private _updatedKeys: Record<string, string> = {};
  @state() private _updatedBaseUrls: Record<string, string | null> = {};
  @state() private _showAddProvider = false;

  // ── MCP badge state ───────────────────────────────────────────────────────

  @state() private _mcpConnectedCount = 0;

  // ── Permissions badge state ───────────────────────────────────────────────

  @state() private _pendingPermissionsCount = 0;

  // ── Agent panel state ─────────────────────────────────────────────────────

  @state() private _editingAgent: AgentBuilderInfo | null = null;
  @state() private _editingAgentLinks: AgentLink[] = [];
  @state() private _editingAgentAllAgents: AgentBuilderInfo[] = [];
  @state() private _loadingAgentPanel = false;
  @state() private _agentPanelError = "";
  @state() private _panelExpanded = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.initialSection) this._activeSection = this.initialSection;
    this._loadConfig();
    this._loadProviderCatalog();
  }

  // ── Config management ────────────────────────────────────────────────────

  private async _loadConfig(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const config = await fetchInstanceConfig(this.slug);
      this._config = config;
      this._dirty = {};
      this._heartbeatEveryError = "";
      this._addedProviders = [];
      this._removedProviders = [];
      this._updatedKeys = {};
      this._updatedBaseUrls = {};
      this._editingKeyForProvider = null;
      this._editingBaseUrlForProvider = null;
      this._showAddProvider = false;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadProviderCatalog(): Promise<void> {
    try {
      const data = await fetchProviders();
      this._providerCatalog = data.providers;
    } catch {
      // Non-fatal — add provider dropdown will be empty
    }
  }

  private _setDirty(key: string, value: unknown): void {
    this._dirty = { ...this._dirty, [key]: value };
    this.requestUpdate();
  }

  private _getDirty<T>(key: string, fallback: T): T {
    return key in this._dirty ? (this._dirty[key] as T) : fallback;
  }

  private _isDirty(key: string): boolean {
    return key in this._dirty;
  }

  private get _hasChanges(): boolean {
    return (
      Object.keys(this._dirty).length > 0 ||
      this._addedProviders.length > 0 ||
      this._removedProviders.length > 0 ||
      Object.keys(this._updatedKeys).length > 0 ||
      Object.keys(this._updatedBaseUrls).length > 0
    );
  }

  private _buildPatch(): Record<string, unknown> {
    if (!this._config) return {};
    const patch: Record<string, unknown> = {};

    // General section
    const general: Record<string, unknown> = {};
    if (this._isDirty("general.displayName"))
      general["displayName"] = this._dirty["general.displayName"];
    if (this._isDirty("general.defaultModel"))
      general["defaultModel"] = this._dirty["general.defaultModel"];
    if (Object.keys(general).length > 0) patch["general"] = general;

    // Providers section
    const providersAdd = this._addedProviders.map((p) => ({
      id: p.id,
      apiKey: p.apiKey || undefined,
      ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl || undefined } : {}),
    }));
    const providersUpdate: Array<{ id: string; apiKey?: string; baseUrl?: string | null }> = [
      ...Object.entries(this._updatedKeys).map(([id, apiKey]) => ({
        id,
        apiKey,
        ...(id in this._updatedBaseUrls ? { baseUrl: this._updatedBaseUrls[id] } : {}),
      })),
      ...Object.entries(this._updatedBaseUrls)
        .filter(([id]) => !(id in this._updatedKeys))
        .map(([id, baseUrl]) => ({ id, baseUrl })),
    ];
    const providersRemove = [...this._removedProviders];

    if (providersAdd.length > 0 || providersUpdate.length > 0 || providersRemove.length > 0) {
      const providersPatch: Record<string, unknown> = {};
      if (providersAdd.length > 0) providersPatch["add"] = providersAdd;
      if (providersUpdate.length > 0) providersPatch["update"] = providersUpdate;
      if (providersRemove.length > 0) providersPatch["remove"] = providersRemove;
      patch["providers"] = providersPatch;
    }

    // Agent defaults (compaction, subagents) — mapped to runtime.json top-level fields
    const agentDefaults: Record<string, unknown> = {};
    if (
      this._isDirty("agentDefaults.compaction.mode") ||
      this._isDirty("agentDefaults.compaction.reserveTokensFloor")
    ) {
      const comp: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.compaction.mode"))
        comp["mode"] = this._dirty["agentDefaults.compaction.mode"];
      if (this._isDirty("agentDefaults.compaction.reserveTokensFloor"))
        comp["reservedTokens"] = this._dirty["agentDefaults.compaction.reserveTokensFloor"];
      agentDefaults["compaction"] = comp;
    }
    if (Object.keys(agentDefaults).length > 0) patch["agentDefaults"] = agentDefaults;

    return patch;
  }

  private async _save(): Promise<void> {
    if (!this._hasChanges || this._saving) return;
    if (this._heartbeatEveryError) return;
    this._saving = true;
    this._saveWarning = "";
    try {
      const patch = this._buildPatch();
      const result: ConfigPatchResult = await patchInstanceConfig(this.slug, patch);
      if (result.ok) {
        if (result.requiresRestart) {
          this._showToast(
            result.restartReason
              ? `${msg("Configuration saved", { id: "settings-saved" })} — ${msg("instance restarted", { id: "settings-restarted" })} (${result.restartReason})`
              : `${msg("Configuration saved", { id: "settings-saved" })} — ${msg("instance restarted", { id: "settings-restarted" })}`,
            "warning",
          );
        } else {
          this._showToast(
            `${msg("Configuration saved", { id: "settings-saved" })} — ${msg("hot-reload applied", { id: "settings-hot-reload" })}`,
            "success",
          );
        }
        // Reload config to get fresh state
        await this._loadConfig();
      }
    } catch (err) {
      this._showToast(userMessage(err), "error");
    } finally {
      this._saving = false;
    }
  }

  private _cancel(): void {
    this._dirty = {};
    this._heartbeatEveryError = "";
    this._addedProviders = [];
    this._removedProviders = [];
    this._updatedKeys = {};
    this._updatedBaseUrls = {};
    this._editingKeyForProvider = null;
    this._editingBaseUrlForProvider = null;
    this._showAddProvider = false;
    this.requestUpdate();
  }

  /**
   * Validate and normalize a heartbeat interval string.
   * - Bare number (e.g. "5") → auto-corrected to "5m"
   * - Valid units: ms, s, m, h, d — single or composite (e.g. "1h30m")
   * - Returns { value, error } — error is empty string when valid
   */
  private _normalizeHeartbeatEvery(raw: string): { value: string; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { value: "", error: "" }; // empty = disabled, OK

    // Auto-correct bare number → append "m"
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return { value: `${trimmed}m`, error: "" };
    }

    // Validate: single token with unit
    const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.test(trimmed);
    // Validate: composite form (e.g. "1h30m", "2m500ms")
    const composite = (() => {
      let consumed = 0;
      const tokenRe = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
      for (const match of trimmed.matchAll(tokenRe)) {
        if ((match.index ?? -1) !== consumed) return false;
        consumed += match[0].length;
      }
      return consumed === trimmed.length && consumed > 0;
    })();

    if (!single && !composite) {
      return {
        value: trimmed,
        error: msg("Invalid format. Use e.g. 30m, 1h, 1h30m", {
          id: "settings-heartbeat-every-invalid",
        }),
      };
    }

    return { value: trimmed, error: "" };
  }

  private _showToast(message: string, type: "success" | "warning" | "error"): void {
    this._toast = { message, type };
    setTimeout(() => {
      this._toast = null;
    }, 4000);
  }

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { slug: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _scrollToSection(section: SidebarSection): void {
    this._activeSection = section;
  }

  // ── Provider management ───────────────────────────────────────────────────

  private _addProvider(id: string): void {
    if (!id) return;
    this._addedProviders = [...this._addedProviders, { id, apiKey: "" }];
    this._showAddProvider = false;
    this.requestUpdate();
  }

  private _removeProvider(id: string): void {
    const c = this._config!;
    const defaultModel = this._getDirty("general.defaultModel", c.general.defaultModel);
    // Block removal if this provider is used by the default model
    if (defaultModel.startsWith(`${id}/`)) return;

    // If it was a newly added provider, just remove from _addedProviders
    const addedIdx = this._addedProviders.findIndex((p) => p.id === id);
    if (addedIdx >= 0) {
      this._addedProviders = this._addedProviders.filter((p) => p.id !== id);
    } else {
      this._removedProviders = [...this._removedProviders, id];
    }
    // Clean up any pending key update
    const updated = { ...this._updatedKeys };
    delete updated[id];
    this._updatedKeys = updated;
    if (this._editingKeyForProvider === id) this._editingKeyForProvider = null;
    this.requestUpdate();
  }

  private _isDefaultModelProvider(id: string): boolean {
    if (!this._config) return false;
    const defaultModel = this._getDirty("general.defaultModel", this._config.general.defaultModel);
    return defaultModel.startsWith(`${id}/`);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  private _renderSidebar() {
    const sections: Array<{ id: SidebarSection; label: string; badge?: number }> = [
      { id: "general", label: msg("General", { id: "settings-general" }) },
      { id: "agents", label: msg("Agents", { id: "settings-agents" }) },
      { id: "channels" as const, label: msg("Channels", { id: "settings-channels" }) },
      {
        id: "mcp" as const,
        label: "MCP",
        ...(this._mcpConnectedCount > 0 ? { badge: this._mcpConnectedCount } : {}),
      },
      {
        id: "permissions" as const,
        label: msg("Permissions", { id: "settings-permissions" }),
        ...(this._pendingPermissionsCount > 0 ? { badge: this._pendingPermissionsCount } : {}),
      },
      {
        id: "config",
        label: msg("Config", { id: "settings-config" }),
      },
    ];

    return html`
      <aside class="sidebar">
        <nav class="sidebar-nav">
          ${sections.map(
            (s) => html`
              <button
                class="sidebar-item ${this._activeSection === s.id ? "active" : ""}"
                @click=${() => this._scrollToSection(s.id)}
              >
                ${s.label}
                ${s.badge !== undefined
                  ? html`<span class="sidebar-mcp-badge">${s.badge}</span>`
                  : nothing}
              </button>
            `,
          )}
        </nav>
      </aside>
    `;
  }

  private _renderProviderCard(p: ProviderEntry, isNew: boolean) {
    const isEditingKey = this._editingKeyForProvider === p.id;
    const isEditingUrl = this._editingBaseUrlForProvider === p.id;
    const isDefaultProvider = this._isDefaultModelProvider(p.id);
    const baseUrl =
      this._updatedBaseUrls[p.id] !== undefined ? this._updatedBaseUrls[p.id] : p.baseUrl;

    return html`
      <div class="provider-card">
        <div class="provider-header">
          <div class="provider-header-left">
            <span class="provider-name">${p.label}</span>
            <span class="provider-id">${p.id}</span>
            ${isNew ? html`<span class="badge-new">new</span>` : nothing}
          </div>
          <button
            class="btn-remove-provider"
            ?disabled=${isDefaultProvider}
            title=${isDefaultProvider
              ? msg("Default model uses this provider. Change it first.", {
                  id: "settings-remove-provider-blocked",
                })
              : msg("Remove provider", { id: "settings-remove-provider" })}
            @click=${() => this._removeProvider(p.id)}
          >
            ${msg("Remove", { id: "settings-remove" })}
          </button>
        </div>
        <div class="provider-key-row">
          <span class="provider-env-var">${p.envVar || "—"}</span>
          ${isEditingKey
            ? html`
                <input
                  class="field-input mono changed"
                  style="flex:1"
                  type="text"
                  placeholder=${p.requiresKey
                    ? msg("Enter API key", { id: "settings-enter-api-key" })
                    : msg("Optional API key", { id: "settings-optional-api-key" })}
                  @input=${(e: Event) => {
                    this._updatedKeys = {
                      ...this._updatedKeys,
                      [p.id]: (e.target as HTMLInputElement).value,
                    };
                    this.requestUpdate();
                  }}
                />
                <button
                  class="btn-reveal"
                  @click=${() => {
                    this._editingKeyForProvider = null;
                    const updated = { ...this._updatedKeys };
                    delete updated[p.id];
                    this._updatedKeys = updated;
                    this.requestUpdate();
                  }}
                >
                  ${msg("Cancel", { id: "settings-cancel" })}
                </button>
              `
            : html`
                <span class="field-readonly" style="flex:1"
                  >${p.apiKeyMasked ??
                  (p.requiresKey
                    ? msg("Not set", { id: "settings-not-set" })
                    : msg("Optional", { id: "settings-optional" }))}</span
                >
                <button
                  class="btn-reveal"
                  @click=${() => {
                    this._editingKeyForProvider = p.id;
                    this.requestUpdate();
                  }}
                >
                  ${msg("Change", { id: "settings-change" })}
                </button>
              `}
        </div>
        ${baseUrl
          ? html`
              <div class="provider-url-row">
                <span style="font-size:11px;color:var(--text-muted)">Base URL</span>
                ${isEditingUrl
                  ? html`
                      <input
                        class="field-input changed"
                        style="flex:1"
                        type="url"
                        placeholder="https://api.example.com"
                        .value=${baseUrl}
                        @input=${(e: Event) => {
                          this._updatedBaseUrls = {
                            ...this._updatedBaseUrls,
                            [p.id]: (e.target as HTMLInputElement).value || null,
                          };
                          this.requestUpdate();
                        }}
                      />
                      <button
                        class="btn-reveal"
                        @click=${() => {
                          this._editingBaseUrlForProvider = null;
                          const updated = { ...this._updatedBaseUrls };
                          delete updated[p.id];
                          this._updatedBaseUrls = updated;
                          this.requestUpdate();
                        }}
                      >
                        ${msg("Cancel", { id: "settings-cancel" })}
                      </button>
                    `
                  : html`
                      <span class="field-readonly mono" style="flex:1;font-size:12px"
                        >${baseUrl}</span
                      >
                      <button
                        class="btn-reveal"
                        @click=${() => {
                          this._editingBaseUrlForProvider = p.id;
                          this.requestUpdate();
                        }}
                      >
                        ${msg("Edit", { id: "settings-edit" })}
                      </button>
                    `}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderNewProviderCard(p: { id: string; apiKey: string; baseUrl?: string }) {
    // Build a synthetic ProviderEntry from catalog info
    const catalogEntry = this._providerCatalog.find((c) => c.id === p.id);
    const entry: ProviderEntry = {
      id: p.id,
      label: catalogEntry?.label ?? p.id,
      envVar: "",
      apiKeyMasked: null,
      apiKeySet: false,
      requiresKey: catalogEntry?.requiresKey ?? true,
      baseUrl: null,
      source: "models",
    };

    return html`
      <div class="provider-card">
        <div class="provider-header">
          <div class="provider-header-left">
            <span class="provider-name">${entry.label}</span>
            <span class="provider-id">${entry.id}</span>
            <span class="badge-new">new</span>
          </div>
          <button class="btn-remove-provider" @click=${() => this._removeProvider(p.id)}>
            ${msg("Remove", { id: "settings-remove" })}
          </button>
        </div>
        <div class="provider-key-row">
          <span class="provider-env-var" style="font-size:11px;color:var(--text-muted)">
            ${entry.requiresKey
              ? msg("API key required", { id: "settings-api-key-required" })
              : msg("API key optional", { id: "settings-api-key-optional" })}
          </span>
          <input
            class="field-input mono changed"
            style="flex:1"
            type="text"
            placeholder=${entry.requiresKey
              ? msg("Enter API key", { id: "settings-enter-api-key" })
              : msg("Optional API key", { id: "settings-optional-api-key" })}
            .value=${p.apiKey}
            @input=${(e: Event) => {
              const val = (e.target as HTMLInputElement).value;
              this._addedProviders = this._addedProviders.map((ap) =>
                ap.id === p.id ? { ...ap, apiKey: val } : ap,
              );
              this.requestUpdate();
            }}
          />
        </div>
        <div class="provider-url-row">
          <span style="font-size:11px;color:var(--text-muted)">Base URL (optional)</span>
          <input
            class="field-input changed"
            style="flex:1"
            type="url"
            placeholder="https://api.example.com"
            .value=${p.baseUrl ?? ""}
            @input=${(e: Event) => {
              const val = (e.target as HTMLInputElement).value;
              this._addedProviders = this._addedProviders.map((ap) => {
                if (ap.id !== p.id) return ap;
                const updated: typeof ap = { id: ap.id, apiKey: ap.apiKey };
                if (val) updated.baseUrl = val;
                return updated;
              });
              this.requestUpdate();
            }}
          />
        </div>
      </div>
    `;
  }

  private _renderProviders() {
    const c = this._config!;
    // Existing providers minus removed ones
    const existing = c.providers.filter((p) => !this._removedProviders.includes(p.id));
    // Newly added providers
    const added = this._addedProviders;
    // Providers available for addition (not already configured or pending add)
    const configuredIds = new Set([...existing.map((p) => p.id), ...added.map((p) => p.id)]);
    const available = this._providerCatalog.filter((p) => !configuredIds.has(p.id));

    return html`
      <div class="providers-section">
        <div class="providers-header">
          <span class="section-subheader">${msg("Providers", { id: "settings-providers" })}</span>
          ${available.length > 0
            ? html`
                <button
                  class="btn btn-ghost btn-sm"
                  @click=${() => {
                    this._showAddProvider = !this._showAddProvider;
                    this.requestUpdate();
                  }}
                >
                  + ${msg("Add provider", { id: "settings-add-provider" })}
                </button>
              `
            : nothing}
        </div>

        ${existing.map((p) => this._renderProviderCard(p, false))}
        ${added.map((p) => this._renderNewProviderCard(p))}
        ${this._showAddProvider && available.length > 0
          ? html`
              <div class="provider-add-row">
                <select
                  class="field-input"
                  @change=${(e: Event) => {
                    const val = (e.target as HTMLSelectElement).value;
                    if (val) this._addProvider(val);
                  }}
                >
                  <option value="">
                    ${msg("Select provider...", { id: "settings-select-provider" })}
                  </option>
                  ${available.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
                </select>
              </div>
            `
          : nothing}
        ${existing.length === 0 && added.length === 0
          ? html`
              <p style="color:var(--text-muted);font-size:13px;margin:0">
                ${msg("No providers configured.", { id: "settings-no-providers" })}
              </p>
            `
          : nothing}
      </div>
    `;
  }

  private _renderGeneralSection() {
    const c = this._config!;
    const currentDefaultModel = this._getDirty("general.defaultModel", c.general.defaultModel);

    // Build configured provider list (existing minus removed, plus newly added)
    const existingProviders = c.providers.filter((p) => !this._removedProviders.includes(p.id));
    const addedProviderIds = this._addedProviders.map((p) => p.id);
    const allConfiguredProviderIds = [...existingProviders.map((p) => p.id), ...addedProviderIds];

    // Determine the "selected provider" for the provider selector:
    // - either the provider of the current defaultModel (if it's configured)
    // - or the first configured provider
    const currentProviderId = currentDefaultModel.split("/")[0] ?? "";
    const selectedProviderId = allConfiguredProviderIds.includes(currentProviderId)
      ? currentProviderId
      : (allConfiguredProviderIds[0] ?? "");

    // Get models for the selected provider from the catalog
    const selectedProviderCatalog = this._providerCatalog.find((p) => p.id === selectedProviderId);
    const modelsForSelectedProvider = selectedProviderCatalog?.models ?? [];

    // Check if the current model belongs to the selected provider's catalog
    const currentModelInList = modelsForSelectedProvider.includes(currentDefaultModel);

    // The model select value: either the dirty model or the current configured model
    const modelSelectValue = currentDefaultModel;

    const isProviderDirty = this._isDirty("general.defaultModel");

    return html`
      <div class="section">
        <div class="section-header">${msg("General", { id: "settings-general" })}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label"
              >${msg("Display name", { id: "settings-display-name" })}</label
            >
            <input
              class="field-input ${this._isDirty("general.displayName") ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("general.displayName", c.general.displayName)}
              @input=${(e: Event) =>
                this._setDirty("general.displayName", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label"> ${msg("Port", { id: "settings-port" })} </label>
            <div class="field-readonly">:${c.general.port}</div>
          </div>

          ${allConfiguredProviderIds.length > 1
            ? html`
                <div class="field full-width">
                  <label class="field-label">
                    ${msg("Default provider", { id: "settings-default-provider" })}
                  </label>
                  <select
                    class="field-input ${isProviderDirty ? "changed" : ""}"
                    @change=${(e: Event) => {
                      const newProviderId = (e.target as HTMLSelectElement).value;
                      const catalog = this._providerCatalog.find((p) => p.id === newProviderId);
                      // Pick the first model of the new provider (or keep current if same provider)
                      const firstModel =
                        catalog?.models[0] ?? catalog?.defaultModel ?? newProviderId;
                      this._setDirty("general.defaultModel", firstModel);
                    }}
                  >
                    ${allConfiguredProviderIds.map((id) => {
                      const cat = this._providerCatalog.find((p) => p.id === id);
                      const label = cat?.label ?? id;
                      return html`
                        <option value=${id} ?selected=${id === selectedProviderId}>${label}</option>
                      `;
                    })}
                  </select>
                </div>
              `
            : nothing}

          <div class="field full-width">
            <label class="field-label"
              >${msg("Default model", { id: "settings-default-model" })}</label
            >
            <select
              class="field-input ${isProviderDirty ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty("general.defaultModel", (e.target as HTMLSelectElement).value)}
            >
              ${modelsForSelectedProvider.length > 0
                ? modelsForSelectedProvider.map(
                    (m) => html`
                      <option value=${m} ?selected=${m === modelSelectValue}>${m}</option>
                    `,
                  )
                : html`<option value="" disabled>
                    ${msg("No models available", { id: "settings-no-models" })}
                  </option>`}
              ${modelsForSelectedProvider.length > 0 && !currentModelInList
                ? html` <option value=${modelSelectValue} selected>${modelSelectValue}</option> `
                : nothing}
            </select>
          </div>
        </div>

        ${this._renderProviders()}
      </div>
    `;
  }

  private _renderAgentsSection() {
    const c = this._config!;

    // Build model groups from configured providers (same logic as General section)
    return html`
      <div class="section">
        <div class="section-header">
          ${msg("Agents — Defaults", { id: "settings-agent-defaults" })}
        </div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label"
              >${msg("Compaction mode", { id: "settings-compaction-mode" })}</label
            >
            <select
              class="field-input ${this._isDirty("agentDefaults.compaction.mode") ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty(
                  "agentDefaults.compaction.mode",
                  (e.target as HTMLSelectElement).value,
                )}
            >
              ${["auto", "manual"].map(
                (m) => html`
                  <option
                    value=${m}
                    ?selected=${m ===
                    this._getDirty(
                      "agentDefaults.compaction.mode",
                      c.agentDefaults.compaction.mode,
                    )}
                  >
                    ${m}
                  </option>
                `,
              )}
            </select>
          </div>
        </div>

        ${c.agents.length > 0
          ? html`
              <div style="margin-top:28px">
                <div class="section-header">
                  ${msg("Agents — List", { id: "settings-agent-list" })}
                </div>
                <table class="agent-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>${msg("Name", { id: "settings-agent-name" })}</th>
                      <th>${msg("Model", { id: "settings-agent-model" })}</th>
                      <th>${msg("Actions", { id: "settings-agent-actions" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${c.agents.map(
                      (agent) => html`
                        <tr>
                          <td class="mono">${agent.id}</td>
                          <td>${agent.name}</td>
                          <td class="mono">${agent.model ?? "—"}</td>
                          <td>
                            <button
                              class="btn-agent-edit"
                              title=${msg("Edit agent", { id: "settings-agent-edit-btn" })}
                              ?disabled=${this._loadingAgentPanel}
                              @click=${() => void this._openAgentPanel(agent.id)}
                            >
                              ${this._loadingAgentPanel
                                ? "…"
                                : html`
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                    >
                                      <path
                                        d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"
                                      />
                                    </svg>
                                  `}
                            </button>
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Agent panel ───────────────────────────────────────────────────────────

  private async _openAgentPanel(agentId: string): Promise<void> {
    this._loadingAgentPanel = true;
    this._agentPanelError = "";
    try {
      const data = await fetchBuilderData(this.slug);
      const agent = data.agents.find((a) => a.agent_id === agentId);
      if (!agent) {
        this._agentPanelError = "Agent not found";
        return;
      }
      this._editingAgent = agent;
      this._editingAgentLinks = data.links;
      this._editingAgentAllAgents = data.agents;
    } catch (err) {
      this._agentPanelError = userMessage(err);
    } finally {
      this._loadingAgentPanel = false;
    }
  }

  override render() {
    if (this._loading) {
      return html`
        <div class="settings-header">
          <div class="header-left">
            <button class="back-btn" @click=${this._goBack}>
              ← ${msg("Back", { id: "settings-back" })}
            </button>
          </div>
        </div>
        <div class="loading-container">
          <div class="spinner"></div>
          ${msg("Loading configuration...", { id: "settings-loading" })}
        </div>
      `;
    }

    if (this._error) {
      return html`
        <div class="settings-header">
          <div class="header-left">
            <button class="back-btn" @click=${this._goBack}>
              ← ${msg("Back", { id: "settings-back" })}
            </button>
          </div>
        </div>
        <div style="padding:24px;max-width:600px;margin:0 auto">
          <div class="error-banner">${this._error}</div>
        </div>
      `;
    }

    if (!this._config) return nothing;

    return html`
      <div class="settings-header">
        <div class="header-left">
          <button class="back-btn" @click=${this._goBack}>
            ← ${msg("Back", { id: "settings-back" })}
          </button>
          <span class="header-title">
            ${this.slug}
            <span>— ${msg("Settings", { id: "settings-title" })}</span>
          </span>
        </div>
        <div class="header-right">
          ${this._hasChanges
            ? html`
                <button class="btn btn-ghost" @click=${this._cancel} ?disabled=${this._saving}>
                  ${msg("Cancel", { id: "settings-cancel" })}
                </button>
                <button
                  class="btn btn-primary"
                  @click=${this._save}
                  ?disabled=${this._saving || !!this._heartbeatEveryError}
                >
                  ${this._saving
                    ? msg("Saving...", { id: "settings-saving" })
                    : msg("Save", { id: "settings-save" })}
                </button>
              `
            : nothing}
        </div>
      </div>

      <div class="settings-layout pilot-layout">
        ${this._renderSidebar()}
        <div class="content pilot-content">
          ${this._saveWarning
            ? html`<div class="save-warning">⚠ ${this._saveWarning}</div>`
            : nothing}
          ${this._activeSection === "general" ? this._renderGeneralSection() : nothing}
          ${this._activeSection === "agents" ? this._renderAgentsSection() : nothing}
          ${this._activeSection === "channels"
            ? html`
                <div class="section">
                  <cp-instance-channels
                    .instanceSlug=${this.slug}
                    .config=${this._config}
                  ></cp-instance-channels>
                </div>
              `
            : nothing}
          ${this._activeSection === "mcp"
            ? html`
                <div class="section">
                  <cp-instance-mcp
                    .slug=${this.slug}
                    .active=${true}
                    @mcp-connected-count-changed=${(e: CustomEvent<number>) => {
                      this._mcpConnectedCount = e.detail;
                    }}
                  ></cp-instance-mcp>
                </div>
              `
            : nothing}
          ${this._activeSection === "permissions"
            ? html`
                <div class="section">
                  <cp-instance-permissions
                    .slug=${this.slug}
                    .active=${true}
                  ></cp-instance-permissions>
                </div>
              `
            : nothing}
          ${this._activeSection === "config"
            ? html`
                <div class="section">
                  <cp-instance-config .slug=${this.slug} .active=${true}></cp-instance-config>
                </div>
              `
            : nothing}
        </div>
      </div>

      ${this._editingAgent
        ? html`
            <div
              class="agent-panel-backdrop"
              @click=${() => {
                this._editingAgent = null;
                this._panelExpanded = false;
              }}
            ></div>
            <div class="agent-panel-drawer ${this._panelExpanded ? "expanded" : ""}">
              <cp-agent-detail-panel
                .agent=${this._editingAgent}
                .links=${this._editingAgentLinks}
                .allAgents=${this._editingAgentAllAgents}
                .context=${{ kind: "instance", slug: this.slug } as PanelContext}
                @panel-close=${() => {
                  this._editingAgent = null;
                  this._panelExpanded = false;
                }}
                @panel-expand-changed=${(e: CustomEvent<{ expanded: boolean }>) => {
                  this._panelExpanded = e.detail.expanded;
                }}
                @agent-meta-updated=${async () => {
                  await Promise.all([
                    this._openAgentPanel(this._editingAgent!.agent_id),
                    fetchInstanceConfig(this.slug).then((cfg) => {
                      this._config = cfg;
                    }),
                  ]);
                }}
              ></cp-agent-detail-panel>
            </div>
          `
        : nothing}
      ${this._toast
        ? html` <div class="toast ${this._toast.type}">${this._toast.message}</div> `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-settings": InstanceSettings;
  }
}
