import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceConfig, ConfigPatchResult, ProviderInfo } from "../types.js";
import { fetchInstanceConfig, patchInstanceConfig, fetchProviders } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles, buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";

type SidebarSection = "general" | "agents" | "telegram" | "plugins" | "gateway";

@localized()
@customElement("cp-instance-settings")
export class InstanceSettings extends LitElement {
  static styles = [tokenStyles, badgeStyles, buttonStyles, spinnerStyles, errorBannerStyles, css`
    :host {
      display: block;
      min-height: calc(100vh - 56px - 48px);
    }

    .settings-layout {
      display: flex;
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
      gap: 32px;
    }

    /* --- Header bar --- */
    .settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--bg-border);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      padding: 7px 14px;
      border-radius: var(--radius-md);
      font-size: 13px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }

    .back-btn:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }

    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .header-title span {
      color: var(--text-muted);
      font-weight: 400;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* --- Sidebar --- */
    .sidebar {
      flex: 0 0 180px;
      position: sticky;
      top: 80px;
      align-self: flex-start;
    }

    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-md);
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;
      border: none;
      background: none;
      text-align: left;
      transition: background 0.1s, color 0.1s;
      width: 100%;
    }

    .sidebar-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .sidebar-item.active {
      background: var(--accent-subtle);
      color: var(--accent);
      font-weight: 600;
    }

    /* --- Content area --- */
    .content {
      flex: 1;
      min-width: 0;
    }

    .section {
      margin-bottom: 32px;
      scroll-margin-top: 80px;
    }

    .section-header {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--bg-border);
      margin-bottom: 20px;
    }

    /* --- Form fields --- */
    .field-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .field-grid.single {
      grid-template-columns: 1fr;
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
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .restart-badge {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(245, 158, 11, 0.1);
      color: var(--state-warning);
      border: 1px solid rgba(245, 158, 11, 0.2);
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .field-input {
      padding: 8px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--bg-border);
      background: var(--bg-base);
      color: var(--text-primary);
      font-size: 13px;
      font-family: var(--font-ui);
      transition: border-color 0.15s;
    }

    .field-input:focus {
      border-color: var(--accent);
      outline: none;
    }

    .field-input.changed {
      border-color: var(--accent);
    }

    .field-input.mono {
      font-family: var(--font-mono);
    }

    .field-input[readonly] {
      opacity: 0.6;
      cursor: not-allowed;
    }

    select.field-input {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
    }

    .field-readonly {
      padding: 8px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--bg-border);
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 13px;
      font-family: var(--font-mono);
    }

    /* --- Secret field --- */
    .secret-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .secret-row .field-input {
      flex: 1;
    }

    .btn-reveal {
      flex: none;
      padding: 8px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--bg-border);
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }

    .btn-reveal:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }

    /* --- Agent list --- */
    .agent-table {
      width: 100%;
      border-collapse: collapse;
    }

    .agent-table th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 8px 12px;
      border-bottom: 1px solid var(--bg-border);
    }

    .agent-table td {
      padding: 10px 12px;
      font-size: 13px;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--bg-border);
    }

    .agent-table td.mono {
      font-family: var(--font-mono);
    }

    .agent-table td .field-input {
      width: 100%;
      padding: 6px 8px;
      font-size: 12px;
    }

    /* --- Toast --- */
    .toast {
      position: fixed;
      bottom: 80px;
      right: 24px;
      padding: 12px 20px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 500;
      z-index: 1000;
      animation: toast-in 0.3s ease-out;
      max-width: 400px;
    }

    .toast.success {
      background: rgba(16, 185, 129, 0.12);
      color: var(--state-running);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .toast.warning {
      background: rgba(245, 158, 11, 0.12);
      color: var(--state-warning);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .toast.error {
      background: rgba(239, 68, 68, 0.12);
      color: var(--state-error);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* --- Loading state --- */
    .loading-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      color: var(--text-muted);
      font-size: 14px;
      gap: 12px;
    }

    /* --- Stopped banner --- */
    .stopped-banner {
      background: rgba(100, 116, 139, 0.08);
      border: 1px solid rgba(100, 116, 139, 0.2);
      border-radius: var(--radius-md);
      padding: 10px 16px;
      color: var(--text-secondary);
      font-size: 12px;
      margin-bottom: 24px;
    }

    /* --- Toggle --- */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
    }

    .toggle-label {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .toggle {
      position: relative;
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--bg-border);
      cursor: pointer;
      border: none;
      transition: background 0.2s;
    }

    .toggle.on {
      background: var(--state-running);
    }

    .toggle::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
    }

    .toggle.on::after {
      transform: translateX(18px);
    }

    /* --- Number input --- */
    input[type="number"].field-input {
      -moz-appearance: textfield;
    }

    input[type="number"].field-input::-webkit-outer-spin-button,
    input[type="number"].field-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  `];

  @property({ type: String }) slug = "";

  @state() private _config: InstanceConfig | null = null;
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _activeSection: SidebarSection = "general";
  @state() private _toast: { message: string; type: "success" | "warning" | "error" } | null = null;
  @state() private _instanceState: string = "unknown";

  // Providers for model/provider selects
  @state() private _providers: ProviderInfo[] = [];

  // Dirty tracking — stores modified values
  @state() private _dirty: Record<string, unknown> = {};

  // Secret editing state
  @state() private _editingApiKey = false;
  @state() private _editingBotToken = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadConfig();
    this._loadProviders();
  }

  private async _loadConfig(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      this._config = await fetchInstanceConfig(this.slug);
      this._dirty = {};
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadProviders(): Promise<void> {
    try {
      const data = await fetchProviders();
      this._providers = data.providers;
    } catch {
      // Non-fatal — selects will be empty
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
    if (this._isDirty("general.displayName")) general["displayName"] = this._dirty["general.displayName"];
    if (this._isDirty("general.defaultModel")) general["defaultModel"] = this._dirty["general.defaultModel"];
    if (this._isDirty("general.provider")) general["provider"] = this._dirty["general.provider"];
    if (this._isDirty("general.apiKey")) general["apiKey"] = this._dirty["general.apiKey"];
    if (this._isDirty("general.toolsProfile")) general["toolsProfile"] = this._dirty["general.toolsProfile"];
    if (Object.keys(general).length > 0) patch["general"] = general;

    // Agent defaults
    const agentDefaults: Record<string, unknown> = {};
    if (this._isDirty("agentDefaults.workspace")) agentDefaults["workspace"] = this._dirty["agentDefaults.workspace"];
    if (this._isDirty("agentDefaults.subagents.maxConcurrent") || this._isDirty("agentDefaults.subagents.archiveAfterMinutes")) {
      const sub: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.subagents.maxConcurrent")) sub["maxConcurrent"] = this._dirty["agentDefaults.subagents.maxConcurrent"];
      if (this._isDirty("agentDefaults.subagents.archiveAfterMinutes")) sub["archiveAfterMinutes"] = this._dirty["agentDefaults.subagents.archiveAfterMinutes"];
      agentDefaults["subagents"] = sub;
    }
    if (this._isDirty("agentDefaults.compaction.mode") || this._isDirty("agentDefaults.compaction.reserveTokensFloor")) {
      const comp: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.compaction.mode")) comp["mode"] = this._dirty["agentDefaults.compaction.mode"];
      if (this._isDirty("agentDefaults.compaction.reserveTokensFloor")) comp["reserveTokensFloor"] = this._dirty["agentDefaults.compaction.reserveTokensFloor"];
      agentDefaults["compaction"] = comp;
    }
    if (this._isDirty("agentDefaults.heartbeat.every") || this._isDirty("agentDefaults.heartbeat.model") || this._isDirty("agentDefaults.heartbeat.target")) {
      const hb: Record<string, unknown> = {};
      if (this._isDirty("agentDefaults.heartbeat.every")) hb["every"] = this._dirty["agentDefaults.heartbeat.every"];
      if (this._isDirty("agentDefaults.heartbeat.model")) hb["model"] = this._dirty["agentDefaults.heartbeat.model"];
      if (this._isDirty("agentDefaults.heartbeat.target")) hb["target"] = this._dirty["agentDefaults.heartbeat.target"];
      agentDefaults["heartbeat"] = hb;
    }
    if (Object.keys(agentDefaults).length > 0) patch["agentDefaults"] = agentDefaults;

    // Channels
    if (this._isDirty("channels.telegram.enabled") || this._isDirty("channels.telegram.botToken") ||
        this._isDirty("channels.telegram.dmPolicy") || this._isDirty("channels.telegram.groupPolicy") ||
        this._isDirty("channels.telegram.streamMode")) {
      const tg: Record<string, unknown> = {};
      if (this._isDirty("channels.telegram.enabled")) tg["enabled"] = this._dirty["channels.telegram.enabled"];
      if (this._isDirty("channels.telegram.botToken")) tg["botToken"] = this._dirty["channels.telegram.botToken"];
      if (this._isDirty("channels.telegram.dmPolicy")) tg["dmPolicy"] = this._dirty["channels.telegram.dmPolicy"];
      if (this._isDirty("channels.telegram.groupPolicy")) tg["groupPolicy"] = this._dirty["channels.telegram.groupPolicy"];
      if (this._isDirty("channels.telegram.streamMode")) tg["streamMode"] = this._dirty["channels.telegram.streamMode"];
      patch["channels"] = { telegram: tg };
    }

    // Plugins
    if (this._isDirty("plugins.mem0.enabled") || this._isDirty("plugins.mem0.ollamaUrl") ||
        this._isDirty("plugins.mem0.qdrantHost") || this._isDirty("plugins.mem0.qdrantPort")) {
      const m: Record<string, unknown> = {};
      if (this._isDirty("plugins.mem0.enabled")) m["enabled"] = this._dirty["plugins.mem0.enabled"];
      if (this._isDirty("plugins.mem0.ollamaUrl")) m["ollamaUrl"] = this._dirty["plugins.mem0.ollamaUrl"];
      if (this._isDirty("plugins.mem0.qdrantHost")) m["qdrantHost"] = this._dirty["plugins.mem0.qdrantHost"];
      if (this._isDirty("plugins.mem0.qdrantPort")) m["qdrantPort"] = this._dirty["plugins.mem0.qdrantPort"];
      patch["plugins"] = { mem0: m };
    }

    // Gateway
    if (this._isDirty("gateway.reloadMode") || this._isDirty("gateway.reloadDebounceMs")) {
      const gw: Record<string, unknown> = {};
      if (this._isDirty("gateway.reloadMode")) gw["reloadMode"] = this._dirty["gateway.reloadMode"];
      if (this._isDirty("gateway.reloadDebounceMs")) gw["reloadDebounceMs"] = this._dirty["gateway.reloadDebounceMs"];
      patch["gateway"] = gw;
    }

    return patch;
  }

  private async _save(): Promise<void> {
    if (!this._hasChanges || this._saving) return;
    this._saving = true;
    try {
      const patch = this._buildPatch();
      const result = await patchInstanceConfig(this.slug, patch);
      if (result.ok) {
        if (result.restarted) {
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
        this._editingApiKey = false;
        this._editingBotToken = false;
      }
    } catch (err) {
      this._showToast(userMessage(err), "error");
    } finally {
      this._saving = false;
    }
  }

  private _cancel(): void {
    this._dirty = {};
    this._editingApiKey = false;
    this._editingBotToken = false;
    this.requestUpdate();
  }

  private _showToast(message: string, type: "success" | "warning" | "error"): void {
    this._toast = { message, type };
    setTimeout(() => { this._toast = null; }, 4000);
  }

  private _goBack(): void {
    this.dispatchEvent(new CustomEvent("navigate", {
      detail: { slug: null },
      bubbles: true,
      composed: true,
    }));
  }

  private _scrollToSection(section: SidebarSection): void {
    this._activeSection = section;
    const el = this.shadowRoot?.getElementById(`section-${section}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- Render helpers ---

  private _renderSidebar() {
    const sections: Array<{ id: SidebarSection; label: string }> = [
      { id: "general", label: msg("General", { id: "settings-general" }) },
      { id: "agents", label: msg("Agents", { id: "settings-agents" }) },
      { id: "telegram", label: "Telegram" },
      { id: "plugins", label: "Plugins" },
      { id: "gateway", label: "Gateway" },
    ];

    return html`
      <aside class="sidebar">
        <nav class="sidebar-nav">
          ${sections.map((s) => html`
            <button
              class="sidebar-item ${this._activeSection === s.id ? "active" : ""}"
              @click=${() => this._scrollToSection(s.id)}
            >${s.label}</button>
          `)}
        </nav>
      </aside>
    `;
  }

  private _renderGeneralSection() {
    const c = this._config!;
    const provider = this._getDirty("general.provider", c.general.provider);
    const currentProviderInfo = this._providers.find((p) => p.id === provider);
    const models = currentProviderInfo?.models ?? [];

    return html`
      <div class="section" id="section-general">
        <div class="section-header">${msg("General", { id: "settings-general" })}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${msg("Display name", { id: "settings-display-name" })}</label>
            <input
              class="field-input ${this._isDirty("general.displayName") ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("general.displayName", c.general.displayName)}
              @input=${(e: Event) => this._setDirty("general.displayName", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label">
              ${msg("Port", { id: "settings-port" })}
            </label>
            <div class="field-readonly">:${c.general.port}</div>
          </div>
          <div class="field">
            <label class="field-label">${msg("Provider", { id: "settings-provider" })}</label>
            <select
              class="field-input ${this._isDirty("general.provider") ? "changed" : ""}"
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                this._setDirty("general.provider", val);
                // Reset model when provider changes
                const prov = this._providers.find((p) => p.id === val);
                if (prov) this._setDirty("general.defaultModel", prov.defaultModel);
              }}
            >
              ${this._providers.map((p) => html`
                <option value=${p.id} ?selected=${p.id === provider}>${p.label}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">${msg("Default model", { id: "settings-default-model" })}</label>
            <select
              class="field-input ${this._isDirty("general.defaultModel") ? "changed" : ""}"
              @change=${(e: Event) => this._setDirty("general.defaultModel", (e.target as HTMLSelectElement).value)}
            >
              ${models.map((m) => html`
                <option value=${m} ?selected=${m === this._getDirty("general.defaultModel", c.general.defaultModel)}>${m}</option>
              `)}
              ${!models.includes(this._getDirty("general.defaultModel", c.general.defaultModel))
                ? html`<option value=${this._getDirty("general.defaultModel", c.general.defaultModel)} selected>
                    ${this._getDirty("general.defaultModel", c.general.defaultModel)}
                  </option>`
                : nothing}
            </select>
          </div>
          <div class="field full-width">
            <label class="field-label">
              ${msg("API Key", { id: "settings-api-key" })}
              ${c.general.apiKeyEnvVar ? html`<span style="font-weight:400;color:var(--text-muted)">(${c.general.apiKeyEnvVar})</span>` : nothing}
            </label>
            ${this._editingApiKey
              ? html`
                <div class="secret-row">
                  <input
                    class="field-input mono changed"
                    type="text"
                    placeholder=${msg("Enter new API key", { id: "settings-enter-api-key" })}
                    @input=${(e: Event) => this._setDirty("general.apiKey", (e.target as HTMLInputElement).value)}
                  />
                  <button class="btn-reveal" @click=${() => { this._editingApiKey = false; delete this._dirty["general.apiKey"]; this.requestUpdate(); }}>
                    ${msg("Cancel", { id: "settings-cancel" })}
                  </button>
                </div>
              `
              : html`
                <div class="secret-row">
                  <div class="field-readonly" style="flex:1">${c.general.apiKeyMasked ?? msg("Not set", { id: "settings-not-set" })}</div>
                  <button class="btn-reveal" @click=${() => { this._editingApiKey = true; }}>
                    ${msg("Change", { id: "settings-change" })}
                  </button>
                </div>
              `}
          </div>
          <div class="field">
            <label class="field-label">${msg("Tools profile", { id: "settings-tools-profile" })}</label>
            <select
              class="field-input ${this._isDirty("general.toolsProfile") ? "changed" : ""}"
              @change=${(e: Event) => this._setDirty("general.toolsProfile", (e.target as HTMLSelectElement).value)}
            >
              ${["coding", "minimal", "full", "none"].map((p) => html`
                <option value=${p} ?selected=${p === this._getDirty("general.toolsProfile", c.general.toolsProfile)}>${p}</option>
              `)}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  private _renderAgentsSection() {
    const c = this._config!;

    return html`
      <div class="section" id="section-agents">
        <div class="section-header">${msg("Agents — Defaults", { id: "settings-agent-defaults" })}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${msg("Default workspace", { id: "settings-workspace" })}</label>
            <input
              class="field-input ${this._isDirty("agentDefaults.workspace") ? "changed" : ""}"
              type="text"
              .value=${this._getDirty("agentDefaults.workspace", c.agentDefaults.workspace)}
              @input=${(e: Event) => this._setDirty("agentDefaults.workspace", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Max concurrent subagents", { id: "settings-max-concurrent" })}</label>
            <input
              class="field-input ${this._isDirty("agentDefaults.subagents.maxConcurrent") ? "changed" : ""}"
              type="number"
              min="1"
              max="20"
              .value=${String(this._getDirty("agentDefaults.subagents.maxConcurrent", c.agentDefaults.subagents.maxConcurrent))}
              @input=${(e: Event) => this._setDirty("agentDefaults.subagents.maxConcurrent", Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Archive after (min)", { id: "settings-archive-after" })}</label>
            <input
              class="field-input ${this._isDirty("agentDefaults.subagents.archiveAfterMinutes") ? "changed" : ""}"
              type="number"
              min="1"
              .value=${String(this._getDirty("agentDefaults.subagents.archiveAfterMinutes", c.agentDefaults.subagents.archiveAfterMinutes))}
              @input=${(e: Event) => this._setDirty("agentDefaults.subagents.archiveAfterMinutes", Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Compaction mode", { id: "settings-compaction-mode" })}</label>
            <select
              class="field-input ${this._isDirty("agentDefaults.compaction.mode") ? "changed" : ""}"
              @change=${(e: Event) => this._setDirty("agentDefaults.compaction.mode", (e.target as HTMLSelectElement).value)}
            >
              ${["auto", "manual", "off"].map((m) => html`
                <option value=${m} ?selected=${m === this._getDirty("agentDefaults.compaction.mode", c.agentDefaults.compaction.mode)}>${m}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">${msg("Heartbeat interval", { id: "settings-heartbeat-every" })}</label>
            <input
              class="field-input ${this._isDirty("agentDefaults.heartbeat.every") ? "changed" : ""}"
              type="text"
              placeholder="e.g. 30m, 1h"
              .value=${this._getDirty("agentDefaults.heartbeat.every", c.agentDefaults.heartbeat.every ?? "")}
              @input=${(e: Event) => this._setDirty("agentDefaults.heartbeat.every", (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label class="field-label">${msg("Heartbeat model", { id: "settings-heartbeat-model" })}</label>
            <input
              class="field-input ${this._isDirty("agentDefaults.heartbeat.model") ? "changed" : ""}"
              type="text"
              placeholder="e.g. anthropic/claude-haiku-4-5"
              .value=${this._getDirty("agentDefaults.heartbeat.model", c.agentDefaults.heartbeat.model ?? "")}
              @input=${(e: Event) => this._setDirty("agentDefaults.heartbeat.model", (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        ${c.agents.length > 0 ? html`
          <div style="margin-top:28px">
            <div class="section-header">${msg("Agents — List", { id: "settings-agent-list" })}</div>
            <table class="agent-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>${msg("Name", { id: "settings-agent-name" })}</th>
                  <th>${msg("Model", { id: "settings-agent-model" })}</th>
                  <th>${msg("Workspace", { id: "settings-agent-workspace" })}</th>
                </tr>
              </thead>
              <tbody>
                ${c.agents.map((agent) => html`
                  <tr>
                    <td class="mono">${agent.id}</td>
                    <td>${agent.name}</td>
                    <td class="mono">${agent.model ?? "—"}</td>
                    <td class="mono">${agent.workspace}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        ` : nothing}
      </div>
    `;
  }

  private _renderTelegramSection() {
    const c = this._config!;
    const tg = c.channels.telegram;

    return html`
      <div class="section" id="section-telegram">
        <div class="section-header">Telegram</div>
        ${tg ? html`
          <div class="field-grid">
            <div class="field full-width">
              <div class="toggle-row">
                <span class="toggle-label">${msg("Enabled", { id: "settings-enabled" })}</span>
                <button
                  class="toggle ${this._getDirty("channels.telegram.enabled", tg.enabled) ? "on" : ""}"
                  @click=${() => this._setDirty("channels.telegram.enabled", !this._getDirty("channels.telegram.enabled", tg.enabled))}
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
                      placeholder=${msg("Enter new bot token", { id: "settings-enter-bot-token" })}
                      @input=${(e: Event) => this._setDirty("channels.telegram.botToken", (e.target as HTMLInputElement).value)}
                    />
                    <button class="btn-reveal" @click=${() => { this._editingBotToken = false; delete this._dirty["channels.telegram.botToken"]; this.requestUpdate(); }}>
                      ${msg("Cancel", { id: "settings-cancel" })}
                    </button>
                  </div>
                `
                : html`
                  <div class="secret-row">
                    <div class="field-readonly" style="flex:1">${tg.botTokenMasked ?? msg("Not set", { id: "settings-not-set" })}</div>
                    <button class="btn-reveal" @click=${() => { this._editingBotToken = true; }}>
                      ${msg("Change", { id: "settings-change" })}
                    </button>
                  </div>
                `}
            </div>
            <div class="field">
              <label class="field-label">DM Policy</label>
              <select
                class="field-input ${this._isDirty("channels.telegram.dmPolicy") ? "changed" : ""}"
                @change=${(e: Event) => this._setDirty("channels.telegram.dmPolicy", (e.target as HTMLSelectElement).value)}
              >
                ${["pairing", "open", "closed"].map((p) => html`
                  <option value=${p} ?selected=${p === this._getDirty("channels.telegram.dmPolicy", tg.dmPolicy)}>${p}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <label class="field-label">Group Policy</label>
              <select
                class="field-input ${this._isDirty("channels.telegram.groupPolicy") ? "changed" : ""}"
                @change=${(e: Event) => this._setDirty("channels.telegram.groupPolicy", (e.target as HTMLSelectElement).value)}
              >
                ${["allowlist", "open", "closed"].map((p) => html`
                  <option value=${p} ?selected=${p === this._getDirty("channels.telegram.groupPolicy", tg.groupPolicy)}>${p}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <label class="field-label">Stream Mode</label>
              <select
                class="field-input ${this._isDirty("channels.telegram.streamMode") ? "changed" : ""}"
                @change=${(e: Event) => this._setDirty("channels.telegram.streamMode", (e.target as HTMLSelectElement).value)}
              >
                ${["partial", "full", "off"].map((p) => html`
                  <option value=${p} ?selected=${p === this._getDirty("channels.telegram.streamMode", tg.streamMode ?? "partial")}>${p}</option>
                `)}
              </select>
            </div>
          </div>
        ` : html`
          <p style="color:var(--text-muted);font-size:13px">${msg("Telegram is not configured for this instance.", { id: "settings-telegram-not-configured" })}</p>
        `}
      </div>
    `;
  }

  private _renderPluginsSection() {
    const c = this._config!;
    const mem0 = c.plugins.mem0;

    return html`
      <div class="section" id="section-plugins">
        <div class="section-header">
          Plugins
          <span class="restart-badge" style="margin-left:8px">restart</span>
        </div>
        ${mem0 ? html`
          <div style="margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text-secondary)">mem0</div>
          <div class="field-grid">
            <div class="field full-width">
              <div class="toggle-row">
                <span class="toggle-label">${msg("Enabled", { id: "settings-enabled" })}</span>
                <button
                  class="toggle ${this._getDirty("plugins.mem0.enabled", mem0.enabled) ? "on" : ""}"
                  @click=${() => this._setDirty("plugins.mem0.enabled", !this._getDirty("plugins.mem0.enabled", mem0.enabled))}
                ></button>
              </div>
            </div>
            <div class="field">
              <label class="field-label">Ollama URL</label>
              <input
                class="field-input mono ${this._isDirty("plugins.mem0.ollamaUrl") ? "changed" : ""}"
                type="text"
                .value=${this._getDirty("plugins.mem0.ollamaUrl", mem0.ollamaUrl)}
                @input=${(e: Event) => this._setDirty("plugins.mem0.ollamaUrl", (e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field-label">Qdrant Host</label>
              <input
                class="field-input mono ${this._isDirty("plugins.mem0.qdrantHost") ? "changed" : ""}"
                type="text"
                .value=${this._getDirty("plugins.mem0.qdrantHost", mem0.qdrantHost)}
                @input=${(e: Event) => this._setDirty("plugins.mem0.qdrantHost", (e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field-label">Qdrant Port</label>
              <input
                class="field-input mono ${this._isDirty("plugins.mem0.qdrantPort") ? "changed" : ""}"
                type="number"
                .value=${String(this._getDirty("plugins.mem0.qdrantPort", mem0.qdrantPort))}
                @input=${(e: Event) => this._setDirty("plugins.mem0.qdrantPort", Number((e.target as HTMLInputElement).value))}
              />
            </div>
          </div>
        ` : html`
          <p style="color:var(--text-muted);font-size:13px">${msg("No plugins configured.", { id: "settings-no-plugins" })}</p>
        `}
      </div>
    `;
  }

  private _renderGatewaySection() {
    const c = this._config!;

    return html`
      <div class="section" id="section-gateway">
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
              @change=${(e: Event) => this._setDirty("gateway.reloadMode", (e.target as HTMLSelectElement).value)}
            >
              ${["hybrid", "poll", "off"].map((m) => html`
                <option value=${m} ?selected=${m === this._getDirty("gateway.reloadMode", c.gateway.reloadMode)}>${m}</option>
              `)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Reload Debounce (ms)</label>
            <input
              class="field-input ${this._isDirty("gateway.reloadDebounceMs") ? "changed" : ""}"
              type="number"
              min="100"
              max="5000"
              .value=${String(this._getDirty("gateway.reloadDebounceMs", c.gateway.reloadDebounceMs))}
              @input=${(e: Event) => this._setDirty("gateway.reloadDebounceMs", Number((e.target as HTMLInputElement).value))}
            />
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    if (this._loading) {
      return html`
        <div class="settings-header">
          <div class="header-left">
            <button class="back-btn" @click=${this._goBack}>← ${msg("Back", { id: "settings-back" })}</button>
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
            <button class="back-btn" @click=${this._goBack}>← ${msg("Back", { id: "settings-back" })}</button>
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
          <button class="back-btn" @click=${this._goBack}>← ${msg("Back", { id: "settings-back" })}</button>
          <span class="header-title">
            ${this.slug}
            <span>— ${msg("Settings", { id: "settings-title" })}</span>
          </span>
        </div>
        <div class="header-right">
          ${this._hasChanges ? html`
            <button
              class="btn btn-ghost"
              @click=${this._cancel}
              ?disabled=${this._saving}
            >${msg("Cancel", { id: "settings-cancel" })}</button>
            <button
              class="btn btn-primary"
              @click=${this._save}
              ?disabled=${this._saving}
            >${this._saving
              ? msg("Saving...", { id: "settings-saving" })
              : msg("Save", { id: "settings-save" })}</button>
          ` : nothing}
        </div>
      </div>

      <div class="settings-layout">
        ${this._renderSidebar()}
        <div class="content">
          ${this._renderGeneralSection()}
          ${this._renderAgentsSection()}
          ${this._renderTelegramSection()}
          ${this._renderPluginsSection()}
          ${this._renderGatewaySection()}
        </div>
      </div>

      ${this._toast ? html`
        <div class="toast ${this._toast.type}">${this._toast.message}</div>
      ` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-settings": InstanceSettings;
  }
}
