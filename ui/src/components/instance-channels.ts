// ui/src/components/instance-channels.ts
// Panneau Channels — configuration Telegram avec pairing, états A/B/C
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceConfig, TelegramPairingList } from "../types.js";
import {
  fetchInstanceConfig,
  patchChannelsConfig,
  patchTelegramToken,
  fetchTelegramPairing,
  approveTelegramPairing,
  rejectTelegramPairing,
} from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";

// ---------------------------------------------------------------------------
// Panel states
// ---------------------------------------------------------------------------

/** État A — non configuré (telegram null ou enabled=false ET pas de token) */
type PanelState = "unconfigured" | "init-form" | "configured";

@localized()
@customElement("cp-instance-channels")
export class InstanceChannels extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
      }

      .channels-panel {
        padding: 0;
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

      .channel-card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: 20px;
        margin-bottom: 16px;
      }

      .channel-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .channel-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pending-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--state-error, #ef4444);
        color: white;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .status-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .status-badge.connected {
        background: rgba(16, 185, 129, 0.12);
        color: var(--state-running);
      }
      .status-badge.disconnected {
        background: rgba(245, 158, 11, 0.12);
        color: var(--state-warning);
      }
      .status-badge.inactive {
        background: rgba(100, 116, 139, 0.12);
        color: var(--text-muted);
      }

      .unconfigured-body {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .unconfigured-text {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .form-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 14px;
      }

      .form-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .form-hint {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      .form-row-inline {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }
      .form-row-inline .form-label {
        min-width: 100px;
        margin-bottom: 0;
      }

      input[type="text"],
      input[type="password"],
      input[type="number"],
      select,
      textarea {
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        font-family: var(--font-mono);
        padding: 7px 10px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
      }
      select {
        font-family: var(--font-sans, inherit);
        cursor: pointer;
      }
      input:focus,
      select:focus,
      textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }
      input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .token-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .token-row input {
        flex: 1;
      }

      .token-input-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .token-input-row input {
        flex: 1;
      }

      .toggle-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }
      .toggle-label {
        font-size: 13px;
        color: var(--text-secondary);
      }

      /* Toggle switch */
      .toggle {
        position: relative;
        width: 36px;
        height: 20px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--bg-border);
        border-radius: 20px;
        transition: background 0.2s;
      }
      .toggle-slider::before {
        content: "";
        position: absolute;
        width: 14px;
        height: 14px;
        left: 3px;
        top: 3px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
      }
      .toggle input:checked + .toggle-slider {
        background: var(--accent);
      }
      .toggle input:checked + .toggle-slider::before {
        transform: translateX(16px);
      }

      .restart-banner {
        background: rgba(245, 158, 11, 0.08);
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: var(--radius-md);
        padding: 10px 14px;
        font-size: 13px;
        color: var(--state-warning);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--bg-border);
      }

      /* Pairing section */
      .pairing-section {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--bg-border);
      }

      .pairing-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }

      .pairing-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .pairing-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .pairing-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        font-size: 13px;
        flex-wrap: wrap;
      }

      .pairing-username {
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 80px;
      }

      .pairing-code {
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--accent);
        font-weight: 600;
        letter-spacing: 0.05em;
      }

      .pairing-time {
        font-size: 11px;
        color: var(--text-muted);
      }

      .pairing-actions {
        display: flex;
        gap: 6px;
        margin-left: auto;
      }

      .pairing-empty {
        font-size: 13px;
        color: var(--text-muted);
        padding: 8px 0;
      }

      .approved-count {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 10px;
      }

      /* Coming soon cards */
      .coming-soon-card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: 16px 20px;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        opacity: 0.55;
      }
      .coming-soon-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .coming-soon-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        background: rgba(100, 116, 139, 0.12);
        padding: 2px 7px;
        border-radius: var(--radius-sm);
      }

      .link-external {
        font-size: 12px;
        color: var(--accent);
        text-decoration: none;
        white-space: nowrap;
      }
      .link-external:hover {
        text-decoration: underline;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  @property({ type: Object }) config: InstanceConfig | null = null;

  // Panel state machine
  @state() private _panelState: PanelState = "unconfigured";

  // Form fields (init + edit)
  @state() private _enabled = false;
  @state() private _botTokenEnvVar = "TELEGRAM_BOT_TOKEN";
  @state() private _pollingIntervalMs = 1000;
  @state() private _dmPolicy: "pairing" | "open" | "allowlist" | "disabled" = "pairing";
  @state() private _groupPolicy: "open" | "allowlist" | "disabled" = "allowlist";

  // Token management
  @state() private _tokenMasked: string | null = null;
  @state() private _tokenEditMode = false;
  @state() private _newToken = "";

  // Save state
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _requiresRestart = false;
  @state() private _restarting = false;

  // Pairing
  @state() private _pairing: TelegramPairingList | null = null;
  @state() private _pairingLoading = false;
  @state() private _pairingError = "";
  private _pairingPollTimer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // Note: config prop is not yet set at this point — _syncFromConfig() is called
    // by updated() after the first render with props, so no call here.
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPairingPoll();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("config")) {
      this._syncFromConfig();
    }
  }

  // ---------------------------------------------------------------------------
  // Config sync
  // ---------------------------------------------------------------------------

  private _syncFromConfig(): void {
    const tg = this.config?.channels?.telegram;
    // A config reload means the backend state is fresh — clear the restart banner.
    this._requiresRestart = false;
    if (tg) {
      this._enabled = tg.enabled;
      this._tokenMasked = tg.botTokenMasked;
      this._dmPolicy = tg.dmPolicy ?? "pairing";
      this._groupPolicy = tg.groupPolicy ?? "allowlist";
      // État C — configuré seulement si enabled=true OU token déjà présent.
      // Si enabled=false et pas de token (install fraîche), rester en état A.
      if (tg.enabled || tg.botTokenMasked) {
        this._panelState = "configured";
      } else {
        this._panelState = "unconfigured";
      }
    } else {
      // État A — non configuré (telegram null = runtime.json absent)
      this._enabled = false;
      this._tokenMasked = null;
      this._panelState = "unconfigured";
    }

    // Charger le pairing si on est en état configuré et dmPolicy=pairing
    if (this._panelState === "configured" && this._dmPolicy === "pairing") {
      void this._loadPairing();
    }
  }

  // ---------------------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------------------

  private async _loadPairing(): Promise<void> {
    if (!this.instanceSlug) return;
    this._pairingLoading = true;
    this._pairingError = "";
    try {
      this._pairing = await fetchTelegramPairing(this.instanceSlug);
      // Auto-poll si des requêtes sont en attente
      if ((this._pairing?.pending.length ?? 0) > 0) {
        this._startPairingPoll();
      } else {
        this._stopPairingPoll();
      }
    } catch (err) {
      this._pairingError = err instanceof Error ? err.message : "Failed to load pairing";
    } finally {
      this._pairingLoading = false;
    }
  }

  private _startPairingPoll(): void {
    if (this._pairingPollTimer) return;
    this._pairingPollTimer = setInterval(() => {
      void this._loadPairing();
    }, 10_000);
  }

  private _stopPairingPoll(): void {
    if (this._pairingPollTimer) {
      clearInterval(this._pairingPollTimer);
      this._pairingPollTimer = undefined;
    }
  }

  private async _approvePairing(code: string): Promise<void> {
    try {
      await approveTelegramPairing(this.instanceSlug, code);
      await this._loadPairing();
    } catch (err) {
      this._pairingError = err instanceof Error ? err.message : "Approve failed";
    }
  }

  private async _rejectPairing(code: string): Promise<void> {
    try {
      await rejectTelegramPairing(this.instanceSlug, code);
      await this._loadPairing();
    } catch (err) {
      this._pairingError = err instanceof Error ? err.message : "Reject failed";
    }
  }

  // ---------------------------------------------------------------------------
  // Save logic
  // ---------------------------------------------------------------------------

  /** Formulaire d'init (État B → C) */
  private async _saveInit(): Promise<void> {
    this._saving = true;
    this._error = "";
    try {
      // 1. Écrire le token dans .env
      if (this._newToken.trim()) {
        await patchTelegramToken(this.instanceSlug, this._newToken.trim());
        this._newToken = "";
      }

      // 2. Créer/mettre à jour runtime.json avec enabled=true + policies
      const result = await patchChannelsConfig(this.instanceSlug, {
        telegram: {
          enabled: true,
          dmPolicy: this._dmPolicy,
          groupPolicy: this._groupPolicy,
        },
      });

      if (result.requiresRestart) {
        this._requiresRestart = true;
      }

      // 3. Reload config and notify parent so it refreshes its own copy
      const fresh = await fetchInstanceConfig(this.instanceSlug);
      this.config = fresh;
      this._syncFromConfig();
      this.dispatchEvent(
        new CustomEvent("channels-config-saved", { bubbles: true, composed: true, detail: fresh }),
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Save failed";
    } finally {
      this._saving = false;
    }
  }

  /** Formulaire édition (État C) */
  private async _saveEdit(): Promise<void> {
    this._saving = true;
    this._error = "";
    try {
      // 1. Sauvegarder le token si modifié
      // _tokenEditMode = true  → l'utilisateur a cliqué "Change" sur un token existant
      // _tokenEditMode = false → pas de token existant, champ password directement visible
      // Dans les deux cas, envoyer le token si le champ est rempli.
      if (this._newToken.trim()) {
        await patchTelegramToken(this.instanceSlug, this._newToken.trim());
        this._tokenEditMode = false;
        this._newToken = "";
      }

      // 2. Patcher la config
      const result = await patchChannelsConfig(this.instanceSlug, {
        telegram: {
          enabled: this._enabled,
          botTokenEnvVar: this._botTokenEnvVar,
          pollingIntervalMs: this._pollingIntervalMs,
          dmPolicy: this._dmPolicy,
          groupPolicy: this._groupPolicy,
        },
      });

      if (result.requiresRestart) {
        this._requiresRestart = true;
      }

      // 3. Reload config and notify parent so it refreshes its own copy
      const fresh = await fetchInstanceConfig(this.instanceSlug);
      this.config = fresh;
      this._syncFromConfig();
      this.dispatchEvent(
        new CustomEvent("channels-config-saved", { bubbles: true, composed: true, detail: fresh }),
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Save failed";
    } finally {
      this._saving = false;
    }
  }

  private async _removeToken(): Promise<void> {
    if (!confirm(msg("Remove bot token?", { id: "channels-token-confirm-remove" }))) return;
    try {
      await patchTelegramToken(this.instanceSlug, null);
      this._tokenMasked = null;
      this._tokenEditMode = false;
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to remove token";
    }
  }

  private async _restartRuntime(): Promise<void> {
    this._restarting = true;
    try {
      await fetch(`/api/instances/${this.instanceSlug}/restart`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
      });
      this._requiresRestart = false;
    } catch {
      // ignore — user can restart manually
    } finally {
      this._restarting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      <div class="channels-panel">
        <div class="section-header">${msg("Channels", { id: "settings-channels" })}</div>

        ${this._renderTelegramCard()} ${this._renderComingSoonCard("WhatsApp")}
        ${this._renderComingSoonCard("Slack")}
      </div>
    `;
  }

  private _renderTelegramCard() {
    switch (this._panelState) {
      case "unconfigured":
        return this._renderUnconfigured();
      case "init-form":
        return this._renderInitForm();
      case "configured":
        return this._renderConfigured();
    }
  }

  // ---------------------------------------------------------------------------
  // État A — Non configuré
  // ---------------------------------------------------------------------------

  private _renderUnconfigured() {
    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">
            ✈ ${msg("Telegram Bot", { id: "channels-telegram-title" })}
          </div>
          <span class="status-badge inactive"
            >○ ${msg("Inactive", { id: "status-telegram-inactive" })}</span
          >
        </div>
        <div class="unconfigured-body">
          <span class="unconfigured-text">
            ${msg("Telegram is not configured for this instance.", {
              id: "channels-telegram-not-configured",
            })}
          </span>
          <button
            class="btn btn-primary"
            @click=${() => {
              this._panelState = "init-form";
            }}
          >
            ${msg("Configure Telegram", { id: "channels-telegram-configure-btn" })}
          </button>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // État B — Formulaire d'initialisation
  // ---------------------------------------------------------------------------

  private _renderInitForm() {
    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">
            ✈ ${msg("Telegram Bot", { id: "channels-telegram-title" })}
          </div>
        </div>

        <!-- Bot token -->
        <div class="form-row">
          <label class="form-label">${msg("Bot token", { id: "channels-token-label" })}</label>
          <div class="token-input-row">
            <input
              type="password"
              placeholder=${msg("Paste token from BotFather...", {
                id: "channels-token-placeholder",
              })}
              .value=${this._newToken}
              @input=${(e: Event) => {
                this._newToken = (e.target as HTMLInputElement).value;
              }}
            />
            <a
              class="link-external"
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${msg("BotFather ↗", { id: "channels-botfather-link" })}
            </a>
          </div>
        </div>

        <!-- DM policy -->
        <div class="form-row-inline">
          <label class="form-label">${msg("DM policy", { id: "channels-dmPolicy-label" })}</label>
          <select
            .value=${this._dmPolicy}
            @change=${(e: Event) => {
              this._dmPolicy = (e.target as HTMLSelectElement).value as typeof this._dmPolicy;
            }}
            style="max-width: 220px;"
          >
            <option value="pairing">
              ${msg("Pairing (code approval)", { id: "channels-dmPolicy-pairing" })}
            </option>
            <option value="open">${msg("Allow all", { id: "channels-dmPolicy-allowAll" })}</option>
            <option value="allowlist">
              ${msg("Allowlist", { id: "channels-dmPolicy-allowlist" })}
            </option>
            <option value="disabled">
              ${msg("Disabled", { id: "channels-dmPolicy-disabled" })}
            </option>
          </select>
        </div>

        <!-- Group policy -->
        <div class="form-row-inline">
          <label class="form-label">
            ${msg("Group policy", { id: "channels-groupPolicy-label" })}
          </label>
          <select
            .value=${this._groupPolicy}
            @change=${(e: Event) => {
              this._groupPolicy = (e.target as HTMLSelectElement).value as typeof this._groupPolicy;
            }}
            style="max-width: 220px;"
          >
            <option value="open">
              ${msg("Allow all groups", { id: "channels-groupPolicy-open" })}
            </option>
            <option value="allowlist">
              ${msg("Allowlist", { id: "channels-groupPolicy-allowlist" })}
            </option>
            <option value="disabled">
              ${msg("Disabled", { id: "channels-groupPolicy-disabled" })}
            </option>
          </select>
        </div>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

        <div class="form-actions">
          <button
            class="btn btn-ghost"
            @click=${() => {
              this._panelState = "unconfigured";
              this._newToken = "";
              this._error = "";
            }}
            ?disabled=${this._saving}
          >
            ${msg("Cancel", { id: "settings-cancel" })}
          </button>
          <button class="btn btn-primary" @click=${this._saveInit} ?disabled=${this._saving}>
            ${this._saving ? "…" : msg("Add", { id: "channels-add-btn" })}
          </button>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // État C — Configuré
  // ---------------------------------------------------------------------------

  private _renderConfigured() {
    const pendingCount = this._pairing?.pending.length ?? 0;

    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">
            ✈ ${msg("Telegram Bot", { id: "channels-telegram-title" })}
            ${pendingCount > 0 ? html`<span class="pending-badge">${pendingCount}</span>` : nothing}
          </div>
          ${this._renderStatusBadge()}
        </div>

        <!-- Enable toggle -->
        <div class="toggle-row">
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${this._enabled}
              @change=${(e: Event) => {
                this._enabled = (e.target as HTMLInputElement).checked;
              }}
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">${msg("Enabled", { id: "channels-telegram-enabled" })}</span>
        </div>

        <!-- Bot token -->
        <div class="form-row">
          <label class="form-label">${msg("Bot token", { id: "channels-token-label" })}</label>
          <div class="token-row">
            ${this._tokenMasked && !this._tokenEditMode
              ? html`
                  <input type="text" .value=${this._tokenMasked} disabled />
                  <button
                    class="btn btn-ghost"
                    @click=${() => {
                      this._tokenEditMode = true;
                    }}
                  >
                    ${msg("Change", { id: "channels-token-change" })}
                  </button>
                  <button class="btn btn-ghost" @click=${this._removeToken}>×</button>
                `
              : html`
                  <input
                    type="password"
                    placeholder=${msg("Paste token from BotFather...", {
                      id: "channels-token-placeholder",
                    })}
                    .value=${this._newToken}
                    @input=${(e: Event) => {
                      this._newToken = (e.target as HTMLInputElement).value;
                    }}
                  />
                  ${this._tokenEditMode
                    ? html`<button
                        class="btn btn-ghost"
                        @click=${() => {
                          this._tokenEditMode = false;
                          this._newToken = "";
                        }}
                      >
                        ${msg("Cancel", { id: "settings-cancel" })}
                      </button>`
                    : nothing}
                `}
          </div>
        </div>

        <!-- DM policy -->
        <div class="form-row-inline">
          <label class="form-label">${msg("DM policy", { id: "channels-dmPolicy-label" })}</label>
          <select
            .value=${this._dmPolicy}
            @change=${(e: Event) => {
              this._dmPolicy = (e.target as HTMLSelectElement).value as typeof this._dmPolicy;
              // Charger le pairing si on passe en mode pairing
              if (this._dmPolicy === "pairing") {
                void this._loadPairing();
              } else {
                this._stopPairingPoll();
              }
            }}
            style="max-width: 220px;"
          >
            <option value="pairing">
              ${msg("Pairing (code approval)", { id: "channels-dmPolicy-pairing" })}
            </option>
            <option value="open">${msg("Allow all", { id: "channels-dmPolicy-allowAll" })}</option>
            <option value="allowlist">
              ${msg("Allowlist", { id: "channels-dmPolicy-allowlist" })}
            </option>
            <option value="disabled">
              ${msg("Disabled", { id: "channels-dmPolicy-disabled" })}
            </option>
          </select>
        </div>

        <!-- Group policy -->
        <div class="form-row-inline">
          <label class="form-label">
            ${msg("Group policy", { id: "channels-groupPolicy-label" })}
          </label>
          <select
            .value=${this._groupPolicy}
            @change=${(e: Event) => {
              this._groupPolicy = (e.target as HTMLSelectElement).value as typeof this._groupPolicy;
            }}
            style="max-width: 220px;"
          >
            <option value="open">
              ${msg("Allow all groups", { id: "channels-groupPolicy-open" })}
            </option>
            <option value="allowlist">
              ${msg("Allowlist", { id: "channels-groupPolicy-allowlist" })}
            </option>
            <option value="disabled">
              ${msg("Disabled", { id: "channels-groupPolicy-disabled" })}
            </option>
          </select>
        </div>

        <!-- Pairing section (visible uniquement si dmPolicy === "pairing") -->
        ${this._dmPolicy === "pairing" ? this._renderPairingSection() : nothing}
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
        ${this._requiresRestart
          ? html`
              <div class="restart-banner">
                <span>
                  ${msg("Changes require a runtime restart to take effect.", {
                    id: "channels-restartWarning",
                  })}
                </span>
                <button
                  class="btn btn-primary"
                  @click=${this._restartRuntime}
                  ?disabled=${this._restarting}
                >
                  ${this._restarting ? "…" : msg("Restart runtime", { id: "channels-restartBtn" })}
                </button>
              </div>
            `
          : nothing}

        <div class="form-actions">
          <button class="btn btn-ghost" @click=${this._syncFromConfig} ?disabled=${this._saving}>
            ${msg("Cancel", { id: "settings-cancel" })}
          </button>
          <button class="btn btn-primary" @click=${this._saveEdit} ?disabled=${this._saving}>
            ${this._saving ? "…" : msg("Save", { id: "settings-save" })}
          </button>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Section pairing
  // ---------------------------------------------------------------------------

  private _renderPairingSection() {
    const pending = this._pairing?.pending ?? [];
    const approvedCount = this._pairing?.approved.length ?? 0;

    return html`
      <div class="pairing-section">
        <div class="pairing-header">
          <span class="pairing-title">
            ${msg("Pairing requests", { id: "channels-pairing-title" })}
          </span>
          <button
            class="btn btn-ghost"
            style="font-size: 12px; padding: 3px 8px;"
            @click=${() => void this._loadPairing()}
            ?disabled=${this._pairingLoading}
          >
            ${this._pairingLoading ? "…" : msg("Refresh", { id: "channels-pairing-refresh" })}
          </button>
        </div>

        ${this._pairingError
          ? html`<div class="error-banner" style="margin-bottom: 8px;">${this._pairingError}</div>`
          : nothing}

        <div class="pairing-list">
          ${pending.length === 0
            ? html`<div class="pairing-empty">
                ${msg("No pending pairing requests.", { id: "channels-pairing-empty" })}
              </div>`
            : pending.map(
                (req) => html`
                  <div class="pairing-item">
                    <span class="pairing-username">
                      ${req.meta?.username ? `@${req.meta.username}` : req.id}
                    </span>
                    <span class="pairing-code">
                      ${msg("Code", { id: "channels-pairing-code-label" })}:
                      ${req.code.slice(0, 4)}-${req.code.slice(4)}
                    </span>
                    <span class="pairing-time">${this._relativeTime(req.createdAt)}</span>
                    <div class="pairing-actions">
                      <button
                        class="btn btn-primary"
                        style="font-size: 12px; padding: 3px 10px;"
                        @click=${() => void this._approvePairing(req.code)}
                      >
                        ${msg("Approve", { id: "channels-pairing-approve" })}
                      </button>
                      <button
                        class="btn btn-ghost"
                        style="font-size: 12px; padding: 3px 8px;"
                        @click=${() => void this._rejectPairing(req.code)}
                      >
                        ${msg("Reject", { id: "channels-pairing-reject" })}
                      </button>
                    </div>
                  </div>
                `,
              )}
        </div>

        <div class="approved-count">
          ${msg("Approved senders", { id: "channels-pairing-approved-count" })}: ${approvedCount}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------

  private _renderStatusBadge() {
    if (!this._enabled) {
      return html`<span class="status-badge inactive">
        ○ ${msg("Inactive", { id: "status-telegram-inactive" })}
      </span>`;
    }
    if (!this._tokenMasked) {
      return html`<span class="status-badge disconnected">
        ◎ ${msg("No token", { id: "status-telegram-no-token" })}
      </span>`;
    }
    return html`<span class="status-badge connected">
      ● ${msg("Configured", { id: "status-telegram-configured" })}
    </span>`;
  }

  // ---------------------------------------------------------------------------
  // Coming soon cards
  // ---------------------------------------------------------------------------

  private _renderComingSoonCard(name: string) {
    return html`
      <div class="coming-soon-card">
        <span class="coming-soon-title">${name}</span>
        <span class="coming-soon-badge">${msg("Coming soon", { id: "channels-comingSoon" })}</span>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _relativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-channels": InstanceChannels;
  }
}
