import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type {
  InstanceConfig,
  ConfigPatchResult,
  ProviderInfo,
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
import "./instance-skills.js";

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

  // Stable PanelContext object — rebuilt only when `slug` changes so that
  // cp-agent-detail-panel.updated() doesn't see a new `context` reference on every
  // render and trigger unnecessary _buildLoadFile()/_buildSaveFile() rebuilds.
  private _panelContext: PanelContext = { kind: "instance", slug: "" };

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug")) {
      this._panelContext = { kind: "instance", slug: this.slug };
    }
  }

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

  // Catalog from /api/providers — used for model dropdown
  @state() private _providerCatalog: ProviderInfo[] = [];

  // ── MCP badge state ───────────────────────────────────────────────────────

  @state() private _mcpConnectedCount = 0;

  // ── Skills badge state ───────────────────────────────────────────────────

  @state() private _skillsCount = 0;

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
    void this._loadProviderCatalog();
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
    return Object.keys(this._dirty).length > 0;
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

  // ── Render helpers ────────────────────────────────────────────────────────

  private _renderSidebar() {
    const sections: Array<{ id: SidebarSection; label: string; badge?: number }> = [
      { id: "general", label: msg("General", { id: "settings-general" }) },
      { id: "agents", label: msg("Agents", { id: "settings-agents" }) },
      {
        id: "skills" as const,
        label: msg("Skills", { id: "settings-skills" }),
        ...(this._skillsCount > 0 ? { badge: this._skillsCount } : {}),
      },
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

  private _renderGeneralSection() {
    const c = this._config!;
    const currentDefaultModel = this._getDirty("general.defaultModel", c.general.defaultModel);

    // All named keys (global) and instance default key ID
    const namedKeys = c.namedKeys ?? [];
    const defaultNamedKeyId = c.defaultNamedKeyId ?? null;
    const defaultKey = namedKeys.find((k) => k.id === defaultNamedKeyId);

    // Determine the provider from the default named key (or from the model string as fallback)
    const selectedProviderId = defaultKey?.providerId ?? currentDefaultModel.split("/")[0] ?? "";

    // Get models for the selected provider from the catalog
    const selectedProviderCatalog = this._providerCatalog.find((p) => p.id === selectedProviderId);
    const modelsForSelectedProvider = selectedProviderCatalog?.models ?? [];
    const currentModelInList = modelsForSelectedProvider.includes(currentDefaultModel);
    const modelSelectValue = currentDefaultModel;
    const isModelDirty = this._isDirty("general.defaultModel");

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
            <label class="field-label">
              ${msg("Default API Key", { id: "settings-default-key" })}
            </label>
            ${namedKeys.length > 0
              ? html`
                  <select
                    class="field-input"
                    @change=${(e: Event) => {
                      const keyId = Number((e.target as HTMLSelectElement).value);
                      if (!keyId) return;
                      void this._changeDefaultKey(keyId);
                    }}
                  >
                    <option value="" ?selected=${!defaultNamedKeyId}>
                      — ${msg("None", { id: "settings-key-none" })} —
                    </option>
                    ${namedKeys.map(
                      (k) => html`
                        <option value=${String(k.id)} ?selected=${k.id === defaultNamedKeyId}>
                          ${k.name} (${k.providerId})
                        </option>
                      `,
                    )}
                  </select>
                `
              : html`<div class="field-readonly" style="color:var(--text-muted)">
                  No API keys configured
                </div>`}
          </div>

          <div class="field full-width">
            <label class="field-label"
              >${msg("Default model", { id: "settings-default-model" })}</label
            >
            <select
              class="field-input ${isModelDirty ? "changed" : ""}"
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
      </div>
    `;
  }

  /** Change the default named key for this instance (immediate save, not dirty-tracked). */
  private async _changeDefaultKey(namedKeyId: number): Promise<void> {
    try {
      await patchInstanceConfig(this.slug, {
        defaultNamedKeyId: namedKeyId || null,
      });
      // Reload config to reflect the change
      await this._loadConfig();
      this._showToast(msg("Default key updated", { id: "settings-key-updated" }), "success");
    } catch (err) {
      this._showToast(userMessage(err), "error");
    }
  }

  private _renderAgentsSection() {
    const c = this._config!;

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
          ${this._activeSection === "skills"
            ? html`
                <div class="section">
                  <cp-instance-skills
                    .slug=${this.slug}
                    .active=${true}
                    @skills-count-changed=${(e: CustomEvent<number>) => {
                      this._skillsCount = e.detail;
                    }}
                  ></cp-instance-skills>
                </div>
              `
            : nothing}
          ${this._activeSection === "channels"
            ? html`
                <div class="section">
                  <cp-instance-channels
                    .instanceSlug=${this.slug}
                    .config=${this._config}
                    @channels-config-saved=${(e: CustomEvent<InstanceConfig>) => {
                      this._config = e.detail;
                    }}
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
                .context=${this._panelContext}
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
