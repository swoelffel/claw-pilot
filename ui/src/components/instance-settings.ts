import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  InstanceConfig,
  ConfigPatchResult,
  ProviderInfo,
  ProviderEntry,
  TelegramPairingList,
  TelegramPairingRequest,
  AgentBuilderInfo,
  AgentLink,
  PanelContext,
  SidebarSection,
} from "../types.js";
import {
  fetchInstance,
  fetchInstanceConfig,
  patchInstanceConfig,
  fetchProviders,
  fetchTelegramPairing,
  approveTelegramPairing,
  fetchBuilderData,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { instanceSettingsStyles } from "../styles/instance-settings.styles.js";
import "./instance-devices.js";
import "./agent-detail-panel.js";
import "./runtime-chat.js";

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
  @state() private _instanceType: "openclaw" | "claw-runtime" = "openclaw";
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
  @state() private _addedProviders: Array<{ id: string; apiKey: string }> = [];
  @state() private _removedProviders: string[] = [];
  @state() private _updatedKeys: Record<string, string> = {};
  @state() private _showAddProvider = false;

  // ── Telegram state ────────────────────────────────────────────────────────

  @state() private _editingBotToken = false;
  @state() private _addingTelegram = false;
  @state() private _telegramPairing: TelegramPairingList | null = null;
  @state() private _telegramPairingLoading = false;
  @state() private _telegramPairingError = "";
  @state() private _approvingCode: string | null = null;
  private _pairingPollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Agent panel state ─────────────────────────────────────────────────────

  @state() private _editingAgent: AgentBuilderInfo | null = null;
  @state() private _editingAgentLinks: AgentLink[] = [];
  @state() private _editingAgentAllAgents: AgentBuilderInfo[] = [];
  @state() private _loadingAgentPanel = false;
  @state() private _agentPanelError = "";
  @state() private _panelExpanded = false;
  @state() private _pendingDeviceCount = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.initialSection) this._activeSection = this.initialSection;
    this._loadConfig();
    this._loadProviderCatalog();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPairingPoll();
  }

  // ── Config management ────────────────────────────────────────────────────

  private async _loadConfig(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const [config, instanceData] = await Promise.all([
        fetchInstanceConfig(this.slug),
        fetchInstance(this.slug).catch(() => null),
      ]);
      this._config = config;
      if (instanceData) {
        this._instanceType = instanceData.instance.instance_type ?? "openclaw";
      }
      this._dirty = {};
      this._heartbeatEveryError = "";
      this._addedProviders = [];
      this._removedProviders = [];
      this._updatedKeys = {};
      this._editingKeyForProvider = null;
      this._showAddProvider = false;
      this._addingTelegram = false;
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
      Object.keys(this._updatedKeys).length > 0
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
    if (this._isDirty("general.toolsProfile"))
      general["toolsProfile"] = this._dirty["general.toolsProfile"];
    if (Object.keys(general).length > 0) patch["general"] = general;

    // Providers section
    const providersAdd = this._addedProviders.map((p) => ({
      id: p.id,
      apiKey: p.apiKey || undefined,
    }));
    const providersUpdate = Object.entries(this._updatedKeys).map(([id, apiKey]) => ({
      id,
      apiKey,
    }));
    const providersRemove = [...this._removedProviders];

    if (providersAdd.length > 0 || providersUpdate.length > 0 || providersRemove.length > 0) {
      const providersPatch: Record<string, unknown> = {};
      if (providersAdd.length > 0) providersPatch["add"] = providersAdd;
      if (providersUpdate.length > 0) providersPatch["update"] = providersUpdate;
      if (providersRemove.length > 0) providersPatch["remove"] = providersRemove;
      patch["providers"] = providersPatch;
    }

    // Agent defaults
    const agentDefaults: Record<string, unknown> = {};
    if (this._isDirty("agentDefaults.workspace"))
      agentDefaults["workspace"] = this._dirty["agentDefaults.workspace"];
    if (
      this._isDirty("agentDefaults.subagents.maxConcurrent") ||
      this._isDirty("agentDefaults.subagents.archiveAfterMinutes")
    ) {
      const sub: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.subagents.maxConcurrent"))
        sub["maxConcurrent"] = this._dirty["agentDefaults.subagents.maxConcurrent"];
      if (this._isDirty("agentDefaults.subagents.archiveAfterMinutes"))
        sub["archiveAfterMinutes"] = this._dirty["agentDefaults.subagents.archiveAfterMinutes"];
      agentDefaults["subagents"] = sub;
    }
    if (
      this._isDirty("agentDefaults.compaction.mode") ||
      this._isDirty("agentDefaults.compaction.reserveTokensFloor")
    ) {
      const comp: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.compaction.mode"))
        comp["mode"] = this._dirty["agentDefaults.compaction.mode"];
      if (this._isDirty("agentDefaults.compaction.reserveTokensFloor"))
        comp["reserveTokensFloor"] = this._dirty["agentDefaults.compaction.reserveTokensFloor"];
      agentDefaults["compaction"] = comp;
    }
    if (
      this._isDirty("agentDefaults.heartbeat.every") ||
      this._isDirty("agentDefaults.heartbeat.model") ||
      this._isDirty("agentDefaults.heartbeat.target")
    ) {
      const hb: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.heartbeat.every"))
        hb["every"] = this._dirty["agentDefaults.heartbeat.every"];
      if (this._isDirty("agentDefaults.heartbeat.model"))
        hb["model"] = this._dirty["agentDefaults.heartbeat.model"];
      if (this._isDirty("agentDefaults.heartbeat.target"))
        hb["target"] = this._dirty["agentDefaults.heartbeat.target"];
      agentDefaults["heartbeat"] = hb;
    }
    if (Object.keys(agentDefaults).length > 0) patch["agentDefaults"] = agentDefaults;

    // Channels
    if (
      this._isDirty("channels.telegram.enabled") ||
      this._isDirty("channels.telegram.botToken") ||
      this._isDirty("channels.telegram.dmPolicy") ||
      this._isDirty("channels.telegram.groupPolicy") ||
      this._isDirty("channels.telegram.streamMode")
    ) {
      const tg: Record<string, unknown> = {};
      if (this._isDirty("channels.telegram.enabled"))
        tg["enabled"] = this._dirty["channels.telegram.enabled"];
      if (this._isDirty("channels.telegram.botToken"))
        tg["botToken"] = this._dirty["channels.telegram.botToken"];
      if (this._isDirty("channels.telegram.dmPolicy"))
        tg["dmPolicy"] = this._dirty["channels.telegram.dmPolicy"];
      if (this._isDirty("channels.telegram.groupPolicy"))
        tg["groupPolicy"] = this._dirty["channels.telegram.groupPolicy"];
      if (this._isDirty("channels.telegram.streamMode"))
        tg["streamMode"] = this._dirty["channels.telegram.streamMode"];
      patch["channels"] = { telegram: tg };
    }

    // Plugins
    if (
      this._isDirty("plugins.mem0.enabled") ||
      this._isDirty("plugins.mem0.ollamaUrl") ||
      this._isDirty("plugins.mem0.qdrantHost") ||
      this._isDirty("plugins.mem0.qdrantPort")
    ) {
      const m: Record<string, unknown> = {};
      if (this._isDirty("plugins.mem0.enabled")) m["enabled"] = this._dirty["plugins.mem0.enabled"];
      if (this._isDirty("plugins.mem0.ollamaUrl"))
        m["ollamaUrl"] = this._dirty["plugins.mem0.ollamaUrl"];
      if (this._isDirty("plugins.mem0.qdrantHost"))
        m["qdrantHost"] = this._dirty["plugins.mem0.qdrantHost"];
      if (this._isDirty("plugins.mem0.qdrantPort"))
        m["qdrantPort"] = this._dirty["plugins.mem0.qdrantPort"];
      patch["plugins"] = { mem0: m };
    }

    // Gateway
    if (this._isDirty("gateway.reloadMode") || this._isDirty("gateway.reloadDebounceMs")) {
      const gw: Record<string, unknown> = {};
      if (this._isDirty("gateway.reloadMode")) gw["reloadMode"] = this._dirty["gateway.reloadMode"];
      if (this._isDirty("gateway.reloadDebounceMs"))
        gw["reloadDebounceMs"] = this._dirty["gateway.reloadDebounceMs"];
      patch["gateway"] = gw;
    }

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
        // Show pairing warning if port changed
        if (result.pairingWarning) {
          this._saveWarning =
            "Port changed — browser pairing will be lost after restart. Go to the Devices tab to approve the new request.";
        }
        // Reload config to get fresh state
        await this._loadConfig();
        this._editingBotToken = false;
        this._addingTelegram = false;
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
    this._editingBotToken = false;
    this._addingTelegram = false;
    this._addedProviders = [];
    this._removedProviders = [];
    this._updatedKeys = {};
    this._editingKeyForProvider = null;
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
    if (section === "telegram") {
      void this._loadTelegramPairing();
    } else {
      this._stopPairingPoll();
    }
  }

  // ── Telegram management ───────────────────────────────────────────────────

  private async _loadTelegramPairing(): Promise<void> {
    this._telegramPairingLoading = true;
    this._telegramPairingError = "";
    try {
      this._telegramPairing = await fetchTelegramPairing(this.slug);
      if ((this._telegramPairing.pending.length ?? 0) > 0) {
        this._startPairingPoll();
      } else {
        this._stopPairingPoll();
      }
    } catch (err) {
      this._telegramPairingError = err instanceof Error ? err.message : "Failed to load pairing";
    } finally {
      this._telegramPairingLoading = false;
    }
  }

  private _startPairingPoll(): void {
    if (this._pairingPollTimer !== null) return;
    this._pairingPollTimer = setInterval(() => {
      void this._loadTelegramPairing();
    }, 10_000);
  }

  private _stopPairingPoll(): void {
    if (this._pairingPollTimer !== null) {
      clearInterval(this._pairingPollTimer);
      this._pairingPollTimer = null;
    }
  }

  private async _approvePairing(code: string): Promise<void> {
    this._approvingCode = code;
    try {
      await approveTelegramPairing(this.slug, code);
      await this._loadTelegramPairing();
    } catch (err) {
      this._telegramPairingError = err instanceof Error ? err.message : "Approve failed";
    } finally {
      this._approvingCode = null;
    }
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
      ...(this._instanceType === "claw-runtime"
        ? [{ id: "runtime" as const, label: "Runtime" }]
        : [
            {
              id: "telegram" as const,
              label: "Telegram",
              ...((this._telegramPairing?.pending.length ?? 0) > 0 && {
                badge: this._telegramPairing!.pending.length,
              }),
            },
            { id: "plugins" as const, label: "Plugins" },
            { id: "gateway" as const, label: "Gateway" },
            {
              id: "devices" as const,
              label: "Devices",
              ...(this._pendingDeviceCount > 0 && { badge: this._pendingDeviceCount }),
            },
          ]),
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
                ${s.badge !== undefined ? html`<span class="nav-badge">${s.badge}</span>` : nothing}
              </button>
            `,
          )}
        </nav>
      </aside>
    `;
  }

  private _renderProviderCard(p: ProviderEntry, isNew: boolean) {
    const isEditing = this._editingKeyForProvider === p.id;
    const isDefaultProvider = this._isDefaultModelProvider(p.id);

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
          ${isEditing
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
      </div>
    `;
  }

  private _renderNewProviderCard(p: { id: string; apiKey: string }) {
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

  private _renderRuntimeSection() {
    return html`
      <div class="section">
        <div class="section-title">Runtime</div>
        <div class="section-desc">
          This instance runs on <strong>claw-runtime</strong> — the native claw-pilot agent engine.
        </div>

        <div class="field-group" style="margin-top: 20px;">
          <div class="field-row">
            <span class="field-label">Engine</span>
            <span class="field-value" style="font-family: var(--font-mono); font-size: 13px;">
              claw-runtime
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">Config file</span>
            <span
              class="field-value"
              style="font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);"
            >
              runtime.json
            </span>
          </div>
        </div>

        <div style="margin-top: 28px;">
          <div class="section-header">Chat</div>
          <div
            style="height: 480px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); overflow: hidden;"
          >
            <cp-runtime-chat .slug=${this.slug}></cp-runtime-chat>
          </div>
        </div>
      </div>
    `;
  }

  private _renderGeneralSection() {
    const c = this._config!;
    const currentDefaultModel = this._getDirty("general.defaultModel", c.general.defaultModel);

    // Build model options grouped by provider (from configured providers + added ones)
    const existingProviders = c.providers.filter((p) => !this._removedProviders.includes(p.id));
    const addedProviderIds = this._addedProviders.map((p) => p.id);
    const allConfiguredProviderIds = [...existingProviders.map((p) => p.id), ...addedProviderIds];

    // Get models per provider from catalog
    const modelGroups = allConfiguredProviderIds
      .map((id) => {
        const catalogEntry = this._providerCatalog.find((p) => p.id === id);
        if (!catalogEntry || catalogEntry.models.length === 0) return null;
        return { id, label: catalogEntry.label, models: catalogEntry.models };
      })
      .filter((g): g is { id: string; label: string; models: string[] } => g !== null);

    // Check if current default model is in any group
    const allModels = modelGroups.flatMap((g) => g.models);
    const currentModelInList = allModels.includes(currentDefaultModel);

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
          <div class="field full-width">
            <label class="field-label"
              >${msg("Default model", { id: "settings-default-model" })}</label
            >
            <select
              class="field-input ${this._isDirty("general.defaultModel") ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty("general.defaultModel", (e.target as HTMLSelectElement).value)}
            >
              ${modelGroups.length > 0
                ? modelGroups.map(
                    (group) => html`
                      <optgroup label=${group.label}>
                        ${group.models.map(
                          (m) => html`
                            <option value=${m} ?selected=${m === currentDefaultModel}>${m}</option>
                          `,
                        )}
                      </optgroup>
                    `,
                  )
                : nothing}
              ${!currentModelInList
                ? html`
                    <option value=${currentDefaultModel} selected>${currentDefaultModel}</option>
                  `
                : nothing}
            </select>
          </div>
          <div class="field">
            <label class="field-label"
              >${msg("Tools profile", { id: "settings-tools-profile" })}</label
            >
            <select
              class="field-input ${this._isDirty("general.toolsProfile") ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty("general.toolsProfile", (e.target as HTMLSelectElement).value)}
            >
              ${["coding", "minimal", "full", "none"].map(
                (p) => html`
                  <option
                    value=${p}
                    ?selected=${p ===
                    this._getDirty("general.toolsProfile", c.general.toolsProfile)}
                  >
                    ${p}
                  </option>
                `,
              )}
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
    const existingProviders = c.providers.filter((p) => !this._removedProviders.includes(p.id));
    const addedProviderIds = this._addedProviders.map((p) => p.id);
    const allConfiguredProviderIds = [...existingProviders.map((p) => p.id), ...addedProviderIds];
    const heartbeatModelGroups = allConfiguredProviderIds
      .map((id) => {
        const catalogEntry = this._providerCatalog.find((p) => p.id === id);
        if (!catalogEntry || catalogEntry.models.length === 0) return null;
        return { id, label: catalogEntry.label, models: catalogEntry.models };
      })
      .filter((g): g is { id: string; label: string; models: string[] } => g !== null);

    const currentHeartbeatModel = this._getDirty(
      "agentDefaults.heartbeat.model",
      c.agentDefaults.heartbeat.model ?? "",
    );
    const allHeartbeatModels = heartbeatModelGroups.flatMap((g) => g.models);
    const heartbeatModelInList = allHeartbeatModels.includes(currentHeartbeatModel);

    return html`
      <div class="section">
        <div class="section-header">
          ${msg("Agents — Defaults", { id: "settings-agent-defaults" })}
        </div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label"
              >${msg("Default workspace", { id: "settings-workspace" })}</label
            >
            <input
              class="field-input ${this._isDirty("agentDefaults.workspace") ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("agentDefaults.workspace", c.agentDefaults.workspace)}
              @input=${(e: Event) =>
                this._setDirty("agentDefaults.workspace", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label"
              >${msg("Max concurrent subagents", { id: "settings-max-concurrent" })}</label
            >
            <input
              class="field-input ${this._isDirty("agentDefaults.subagents.maxConcurrent")
                ? "changed"
                : ""}"
              type="number"
              min="1"
              max="20"
              .value=${String(
                this._getDirty(
                  "agentDefaults.subagents.maxConcurrent",
                  c.agentDefaults.subagents.maxConcurrent,
                ),
              )}
              @input=${(e: Event) =>
                this._setDirty(
                  "agentDefaults.subagents.maxConcurrent",
                  Number((e.target as HTMLInputElement).value),
                )}
            />
          </div>
          <div class="field">
            <label class="field-label"
              >${msg("Archive after (min)", { id: "settings-archive-after" })}</label
            >
            <input
              class="field-input ${this._isDirty("agentDefaults.subagents.archiveAfterMinutes")
                ? "changed"
                : ""}"
              type="number"
              min="1"
              .value=${String(
                this._getDirty(
                  "agentDefaults.subagents.archiveAfterMinutes",
                  c.agentDefaults.subagents.archiveAfterMinutes,
                ),
              )}
              @input=${(e: Event) =>
                this._setDirty(
                  "agentDefaults.subagents.archiveAfterMinutes",
                  Number((e.target as HTMLInputElement).value),
                )}
            />
          </div>
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
              ${["auto", "manual", "off"].map(
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
          <div class="field">
            <label class="field-label"
              >${msg("Heartbeat interval", { id: "settings-heartbeat-every" })}</label
            >
            <input
              class="field-input ${this._isDirty("agentDefaults.heartbeat.every")
                ? "changed"
                : ""} ${this._heartbeatEveryError ? "invalid" : ""}"
              type="text"
              placeholder="e.g. 30m, 1h"
              .value=${this._getDirty(
                "agentDefaults.heartbeat.every",
                c.agentDefaults.heartbeat.every ?? "",
              )}
              @input=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                const { error } = this._normalizeHeartbeatEvery(raw);
                this._heartbeatEveryError = error;
                this._setDirty("agentDefaults.heartbeat.every", raw);
              }}
              @blur=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                const { value, error } = this._normalizeHeartbeatEvery(raw);
                this._heartbeatEveryError = error;
                if (!error && value !== raw) {
                  // Auto-correct bare number → Xm
                  (e.target as HTMLInputElement).value = value;
                  this._setDirty("agentDefaults.heartbeat.every", value);
                }
              }}
            />
            ${this._heartbeatEveryError
              ? html`<span class="field-error">${this._heartbeatEveryError}</span>`
              : nothing}
          </div>
          <div class="field">
            <label class="field-label"
              >${msg("Heartbeat model", { id: "settings-heartbeat-model" })}</label
            >
            <select
              class="field-input ${this._isDirty("agentDefaults.heartbeat.model") ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty(
                  "agentDefaults.heartbeat.model",
                  (e.target as HTMLSelectElement).value,
                )}
            >
              <option value="" ?selected=${!currentHeartbeatModel}>
                ${msg("— none —", { id: "settings-heartbeat-model-none" })}
              </option>
              ${heartbeatModelGroups.length > 0
                ? heartbeatModelGroups.map(
                    (group) => html`
                      <optgroup label=${group.label}>
                        ${group.models.map(
                          (m) => html`
                            <option value=${m} ?selected=${m === currentHeartbeatModel}>
                              ${m}
                            </option>
                          `,
                        )}
                      </optgroup>
                    `,
                  )
                : nothing}
              ${currentHeartbeatModel && !heartbeatModelInList
                ? html`
                    <option value=${currentHeartbeatModel} selected>
                      ${currentHeartbeatModel}
                    </option>
                  `
                : nothing}
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
                      <th>${msg("Workspace", { id: "settings-agent-workspace" })}</th>
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
                          <td class="mono">${agent.workspace}</td>
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

  private _renderTelegramSection() {
    const c = this._config!;
    const tg = c.channels.telegram;

    return html`
      <div class="section">
        <div class="section-header">Telegram</div>
        ${tg
          ? html`
              <div class="field-grid">
                <div class="field full-width">
                  <div class="toggle-row">
                    <span class="toggle-label">${msg("Enabled", { id: "settings-enabled" })}</span>
                    <button
                      class="toggle ${this._getDirty("channels.telegram.enabled", tg.enabled)
                        ? "on"
                        : ""}"
                      @click=${() =>
                        this._setDirty(
                          "channels.telegram.enabled",
                          !this._getDirty("channels.telegram.enabled", tg.enabled),
                        )}
                    ></button>
                  </div>
                </div>
                <div class="field full-width">
                  <label class="field-label">
                    Bot Token
                    <span class="restart-badge">hot-reload</span>
                  </label>
                  ${this._editingBotToken
                    ? html`
                        <div class="secret-row">
                          <input
                            class="field-input mono changed"
                            type="text"
                            placeholder=${msg("Enter new bot token", {
                              id: "settings-enter-bot-token",
                            })}
                            @input=${(e: Event) =>
                              this._setDirty(
                                "channels.telegram.botToken",
                                (e.target as HTMLInputElement).value,
                              )}
                          />
                          <button
                            class="btn-reveal"
                            @click=${() => {
                              this._editingBotToken = false;
                              delete this._dirty["channels.telegram.botToken"];
                              this.requestUpdate();
                            }}
                          >
                            ${msg("Cancel", { id: "settings-cancel" })}
                          </button>
                        </div>
                      `
                    : html`
                        <div class="secret-row">
                          <div class="field-readonly" style="flex:1">
                            ${tg.botTokenMasked ?? msg("Not set", { id: "settings-not-set" })}
                          </div>
                          <button
                            class="btn-reveal"
                            @click=${() => {
                              this._editingBotToken = true;
                            }}
                          >
                            ${msg("Change", { id: "settings-change" })}
                          </button>
                        </div>
                      `}
                </div>
                <div class="field">
                  <label class="field-label">DM Policy</label>
                  <select
                    class="field-input ${this._isDirty("channels.telegram.dmPolicy")
                      ? "changed"
                      : ""}"
                    @change=${(e: Event) =>
                      this._setDirty(
                        "channels.telegram.dmPolicy",
                        (e.target as HTMLSelectElement).value,
                      )}
                  >
                    ${["pairing", "open", "allowlist", "disabled"].map(
                      (p) => html`
                        <option
                          value=${p}
                          ?selected=${p ===
                          this._getDirty("channels.telegram.dmPolicy", tg.dmPolicy)}
                        >
                          ${p}
                        </option>
                      `,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">Group Policy</label>
                  <select
                    class="field-input ${this._isDirty("channels.telegram.groupPolicy")
                      ? "changed"
                      : ""}"
                    @change=${(e: Event) =>
                      this._setDirty(
                        "channels.telegram.groupPolicy",
                        (e.target as HTMLSelectElement).value,
                      )}
                  >
                    ${["allowlist", "open", "disabled"].map(
                      (p) => html`
                        <option
                          value=${p}
                          ?selected=${p ===
                          this._getDirty("channels.telegram.groupPolicy", tg.groupPolicy)}
                        >
                          ${p}
                        </option>
                      `,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">Stream Mode</label>
                  <select
                    class="field-input ${this._isDirty("channels.telegram.streamMode")
                      ? "changed"
                      : ""}"
                    @change=${(e: Event) =>
                      this._setDirty(
                        "channels.telegram.streamMode",
                        (e.target as HTMLSelectElement).value,
                      )}
                  >
                    ${["partial", "full", "off"].map(
                      (p) => html`
                        <option
                          value=${p}
                          ?selected=${p ===
                          this._getDirty(
                            "channels.telegram.streamMode",
                            tg.streamMode ?? "partial",
                          )}
                        >
                          ${p}
                        </option>
                      `,
                    )}
                  </select>
                </div>
              </div>
              ${this._renderTelegramPairingSection(tg.dmPolicy)}
            `
          : this._addingTelegram
            ? this._renderTelegramInitForm()
            : html`
                <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">
                  ${msg("Telegram is not configured for this instance.", {
                    id: "settings-telegram-not-configured",
                  })}
                </p>
                <button
                  class="btn btn-ghost"
                  @click=${() => {
                    this._addingTelegram = true;
                  }}
                >
                  ${msg("Configure Telegram", { id: "settings-configure-telegram" })}
                </button>
              `}
      </div>
    `;
  }

  private _renderTelegramPairingSection(dmPolicy: string) {
    // Only relevant when dmPolicy is "pairing"
    const effectiveDmPolicy = this._isDirty("channels.telegram.dmPolicy")
      ? (this._dirty["channels.telegram.dmPolicy"] as string)
      : dmPolicy;

    if (effectiveDmPolicy !== "pairing") return nothing;

    const pairing = this._telegramPairing;
    const pending = pairing?.pending ?? [];
    const approvedCount = pairing?.approved.length ?? 0;

    return html`
      <div style="margin-top:28px">
        <div
          class="section-header"
          style="display:flex;align-items:center;justify-content:space-between"
        >
          <span>Pairing Requests</span>
          <button
            class="btn-reveal"
            ?disabled=${this._telegramPairingLoading}
            @click=${() => void this._loadTelegramPairing()}
          >
            ${this._telegramPairingLoading ? "…" : "↻"}
          </button>
        </div>

        ${this._telegramPairingError
          ? html`
              <div class="error-banner" style="margin-bottom:12px">
                ${this._telegramPairingError}
              </div>
            `
          : nothing}
        ${!pairing && !this._telegramPairingLoading
          ? html`
              <p style="color:var(--text-muted);font-size:13px">
                ${msg("Loading pairing requests…", { id: "settings-pairing-loading" })}
              </p>
            `
          : nothing}
        ${pairing && pending.length === 0
          ? html`
              <p style="color:var(--text-muted);font-size:13px">
                ${msg("No pending pairing requests.", { id: "settings-pairing-empty" })}
              </p>
            `
          : nothing}
        ${pending.map((req: TelegramPairingRequest) => {
          const isApproving = this._approvingCode === req.code;
          const username = req.meta?.username ? `@${req.meta.username}` : req.id;
          const age = this._formatAge(req.lastSeenAt ?? req.createdAt);
          return html`
            <div class="provider-card" style="margin-bottom:8px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
                  <span style="font-size:13px;font-weight:600;color:var(--text-primary)"
                    >${username}</span
                  >
                  <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted)"
                    >${req.id}</span
                  >
                </div>
                <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
                  <span
                    style="font-size:13px;font-family:var(--font-mono);font-weight:700;color:var(--text-primary);letter-spacing:0.08em"
                    >${req.code}</span
                  >
                  <span style="font-size:11px;color:var(--text-muted)">${age}</span>
                  <button
                    class="btn btn-primary"
                    style="font-size:12px;padding:5px 12px"
                    ?disabled=${isApproving}
                    @click=${() => void this._approvePairing(req.code)}
                  >
                    ${isApproving ? "…" : msg("Approve", { id: "settings-approve" })}
                  </button>
                </div>
              </div>
            </div>
          `;
        })}
        ${pairing
          ? html`
              <p style="font-size:12px;color:var(--text-muted);margin-top:8px">
                ${msg("Approved senders", { id: "settings-approved-senders" })}:
                <strong style="color:var(--text-secondary)">${approvedCount}</strong>
              </p>
            `
          : nothing}
      </div>
    `;
  }

  private _formatAge(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private _renderTelegramInitForm() {
    const token = (this._dirty["channels.telegram.botToken"] as string | undefined) ?? "";
    const dmPolicy = (this._dirty["channels.telegram.dmPolicy"] as string | undefined) ?? "pairing";
    const groupPolicy =
      (this._dirty["channels.telegram.groupPolicy"] as string | undefined) ?? "allowlist";
    const streamMode =
      (this._dirty["channels.telegram.streamMode"] as string | undefined) ?? "partial";

    const cancel = () => {
      this._addingTelegram = false;
      delete this._dirty["channels.telegram.botToken"];
      delete this._dirty["channels.telegram.dmPolicy"];
      delete this._dirty["channels.telegram.groupPolicy"];
      delete this._dirty["channels.telegram.streamMode"];
      delete this._dirty["channels.telegram.enabled"];
      this.requestUpdate();
    };

    const add = async () => {
      if (!token.trim()) return;
      this._setDirty("channels.telegram.enabled", true);
      await this._save();
    };

    return html`
      <div class="field-grid">
        <div class="field full-width">
          <label class="field-label">
            Bot Token
            <span class="restart-badge">hot-reload</span>
          </label>
          <div class="secret-row">
            <input
              class="field-input mono ${token ? "changed" : ""}"
              type="text"
              placeholder=${msg("Paste token from BotFather", { id: "settings-paste-bot-token" })}
              .value=${token}
              @input=${(e: Event) =>
                this._setDirty("channels.telegram.botToken", (e.target as HTMLInputElement).value)}
            />
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-reveal"
              title=${msg("Open BotFather in Telegram", { id: "settings-open-botfather" })}
              >BotFather ↗</a
            >
          </div>
        </div>
        <div class="field">
          <label class="field-label">DM Policy</label>
          <select
            class="field-input"
            @change=${(e: Event) =>
              this._setDirty("channels.telegram.dmPolicy", (e.target as HTMLSelectElement).value)}
          >
            ${["pairing", "open", "allowlist", "disabled"].map(
              (p) => html` <option value=${p} ?selected=${p === dmPolicy}>${p}</option> `,
            )}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Group Policy</label>
          <select
            class="field-input"
            @change=${(e: Event) =>
              this._setDirty(
                "channels.telegram.groupPolicy",
                (e.target as HTMLSelectElement).value,
              )}
          >
            ${["allowlist", "open", "disabled"].map(
              (p) => html` <option value=${p} ?selected=${p === groupPolicy}>${p}</option> `,
            )}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Stream Mode</label>
          <select
            class="field-input"
            @change=${(e: Event) =>
              this._setDirty("channels.telegram.streamMode", (e.target as HTMLSelectElement).value)}
          >
            ${["partial", "full", "off"].map(
              (p) => html` <option value=${p} ?selected=${p === streamMode}>${p}</option> `,
            )}
          </select>
        </div>
        <div
          class="field full-width"
          style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"
        >
          <button class="btn btn-ghost" @click=${cancel}>
            ${msg("Cancel", { id: "settings-cancel" })}
          </button>
          <button class="btn btn-primary" ?disabled=${!token.trim() || this._saving} @click=${add}>
            ${this._saving
              ? msg("Saving…", { id: "settings-saving" })
              : msg("Add", { id: "settings-add" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderPluginsSection() {
    const c = this._config!;
    const mem0 = c.plugins.mem0;

    return html`
      <div class="section">
        <div class="section-header">
          Plugins
          <span class="restart-badge" style="margin-left:8px">restart</span>
        </div>
        ${mem0
          ? html`
              <div
                style="margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text-secondary)"
              >
                mem0
              </div>
              <div class="field-grid">
                <div class="field full-width">
                  <div class="toggle-row">
                    <span class="toggle-label">${msg("Enabled", { id: "settings-enabled" })}</span>
                    <button
                      class="toggle ${this._getDirty("plugins.mem0.enabled", mem0.enabled)
                        ? "on"
                        : ""}"
                      @click=${() =>
                        this._setDirty(
                          "plugins.mem0.enabled",
                          !this._getDirty("plugins.mem0.enabled", mem0.enabled),
                        )}
                    ></button>
                  </div>
                </div>
                <div class="field">
                  <label class="field-label">Ollama URL</label>
                  <input
                    class="field-input mono ${this._isDirty("plugins.mem0.ollamaUrl")
                      ? "changed"
                      : ""}"
                    type="text"
                    .value=${this._getDirty("plugins.mem0.ollamaUrl", mem0.ollamaUrl)}
                    @input=${(e: Event) =>
                      this._setDirty(
                        "plugins.mem0.ollamaUrl",
                        (e.target as HTMLInputElement).value,
                      )}
                  />
                </div>
                <div class="field">
                  <label class="field-label">Qdrant Host</label>
                  <input
                    class="field-input mono ${this._isDirty("plugins.mem0.qdrantHost")
                      ? "changed"
                      : ""}"
                    type="text"
                    .value=${this._getDirty("plugins.mem0.qdrantHost", mem0.qdrantHost)}
                    @input=${(e: Event) =>
                      this._setDirty(
                        "plugins.mem0.qdrantHost",
                        (e.target as HTMLInputElement).value,
                      )}
                  />
                </div>
                <div class="field">
                  <label class="field-label">Qdrant Port</label>
                  <input
                    class="field-input mono ${this._isDirty("plugins.mem0.qdrantPort")
                      ? "changed"
                      : ""}"
                    type="number"
                    .value=${String(this._getDirty("plugins.mem0.qdrantPort", mem0.qdrantPort))}
                    @input=${(e: Event) =>
                      this._setDirty(
                        "plugins.mem0.qdrantPort",
                        Number((e.target as HTMLInputElement).value),
                      )}
                  />
                </div>
              </div>
            `
          : html`
              <p style="color:var(--text-muted);font-size:13px">
                ${msg("No plugins configured.", { id: "settings-no-plugins" })}
              </p>
            `}
      </div>
    `;
  }

  private _renderGatewaySection() {
    const c = this._config!;

    return html`
      <div class="section">
        <div class="section-header">Gateway</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${msg("Port", { id: "settings-port" })}</label>
            <div class="field-readonly">:${c.gateway.port}</div>
          </div>
          <div class="field">
            <label class="field-label">Bind</label>
            <div class="field-readonly">${c.gateway.bind}</div>
          </div>
          <div class="field">
            <label class="field-label">Auth Mode</label>
            <div class="field-readonly">${c.gateway.authMode}</div>
          </div>
          <div class="field">
            <label class="field-label">Reload Mode</label>
            <select
              class="field-input ${this._isDirty("gateway.reloadMode") ? "changed" : ""}"
              @change=${(e: Event) =>
                this._setDirty("gateway.reloadMode", (e.target as HTMLSelectElement).value)}
            >
              ${["hybrid", "poll", "off"].map(
                (m) => html`
                  <option
                    value=${m}
                    ?selected=${m === this._getDirty("gateway.reloadMode", c.gateway.reloadMode)}
                  >
                    ${m}
                  </option>
                `,
              )}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Reload Debounce (ms)</label>
            <input
              class="field-input ${this._isDirty("gateway.reloadDebounceMs") ? "changed" : ""}"
              type="number"
              min="100"
              max="5000"
              .value=${String(
                this._getDirty("gateway.reloadDebounceMs", c.gateway.reloadDebounceMs),
              )}
              @input=${(e: Event) =>
                this._setDirty(
                  "gateway.reloadDebounceMs",
                  Number((e.target as HTMLInputElement).value),
                )}
            />
          </div>
        </div>
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
          ${this._hasChanges && this._activeSection !== "devices"
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

      <div class="settings-layout">
        ${this._renderSidebar()}
        <div class="content">
          ${this._saveWarning && this._activeSection !== "devices"
            ? html`<div class="save-warning">⚠ ${this._saveWarning}</div>`
            : nothing}
          ${this._activeSection === "general" ? this._renderGeneralSection() : nothing}
          ${this._activeSection === "agents" ? this._renderAgentsSection() : nothing}
          ${this._activeSection === "runtime" ? this._renderRuntimeSection() : nothing}
          ${this._activeSection === "telegram" ? this._renderTelegramSection() : nothing}
          ${this._activeSection === "plugins" ? this._renderPluginsSection() : nothing}
          ${this._activeSection === "gateway" ? this._renderGatewaySection() : nothing}
          ${this._activeSection === "devices"
            ? html`
                <cp-instance-devices
                  .slug=${this.slug}
                  .active=${true}
                  @pending-count-changed=${(e: CustomEvent<number>) => {
                    this._pendingDeviceCount = e.detail;
                  }}
                ></cp-instance-devices>
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
