// ui/src/components/instance-channels.ts
// Panneau Channels — configuration Telegram avec pairing, états A/B/C
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceConfig, TelegramPairingList, WhatsAppPairingList } from "../types.js";
import {
  fetchInstanceConfig,
  patchChannelsConfig,
  patchTelegramToken,
  fetchTelegramPairing,
  approveTelegramPairing,
  rejectTelegramPairing,
  patchWhatsAppToken,
  fetchWhatsAppPairing,
  approveWhatsAppPairing,
  rejectWhatsAppPairing,
  fetchBaileysStatus,
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

  // WhatsApp panel state
  @state() private _waPanelState: PanelState = "unconfigured";
  @state() private _waEnabled = false;
  @state() private _waPhoneNumberId = "";
  @state() private _waDmPolicy: "pairing" | "open" | "allowlist" | "disabled" = "pairing";

  // WhatsApp token
  @state() private _waTokenMasked: string | null = null;
  @state() private _waTokenEditMode = false;
  @state() private _waNewToken = "";
  @state() private _waNewVerifyToken = "";

  // WhatsApp save state
  @state() private _waSaving = false;
  @state() private _waError = "";
  @state() private _waRequiresRestart = false;

  // WhatsApp mode
  @state() private _waMode: "cloud-api" | "baileys" = "cloud-api";

  // Baileys status
  @state() private _baileysConnected = false;
  @state() private _baileysQrCode: string | null = null;
  @state() private _baileysPhoneNumber: string | null = null;
  private _baileysStatusPollTimer: ReturnType<typeof setInterval> | undefined;

  // WhatsApp pairing
  @state() private _waPairing: WhatsAppPairingList | null = null;
  @state() private _waPairingLoading = false;
  @state() private _waPairingError = "";
  private _waPairingPollTimer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    // Note: config prop is not yet set at this point — _syncFromConfig() is called
    // by updated() after the first render with props, so no call here.
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPairingPoll();
    this._stopWaPairingPoll();
    this._stopBaileysStatusPoll();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("config")) {
      this._syncFromConfig();
      this._syncWaFromConfig();
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

        ${this._renderTelegramCard()} ${this._renderWhatsAppCard()}
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
  // WhatsApp — Config sync
  // ---------------------------------------------------------------------------

  private _syncWaFromConfig(): void {
    const wa = this.config?.channels?.whatsapp;
    this._waRequiresRestart = false;
    if (wa) {
      this._waEnabled = wa.enabled;
      this._waMode = wa.mode ?? "cloud-api";
      this._waTokenMasked = wa.accessTokenMasked;
      this._waPhoneNumberId = wa.phoneNumberId ?? "";
      this._waDmPolicy = wa.dmPolicy ?? "pairing";
      if (wa.enabled || wa.accessTokenMasked || this._waMode === "baileys") {
        this._waPanelState = "configured";
      } else {
        this._waPanelState = "unconfigured";
      }
    } else {
      this._waEnabled = false;
      this._waMode = "cloud-api";
      this._waTokenMasked = null;
      this._waPanelState = "unconfigured";
    }

    if (this._waPanelState === "configured" && this._waDmPolicy === "pairing") {
      void this._loadWaPairing();
    }

    // Start baileys status polling if in baileys mode
    if (this._waPanelState === "configured" && this._waMode === "baileys") {
      void this._loadBaileysStatus();
    } else {
      this._stopBaileysStatusPoll();
    }
  }

  // ---------------------------------------------------------------------------
  // WhatsApp — Pairing
  // ---------------------------------------------------------------------------

  private async _loadWaPairing(): Promise<void> {
    if (!this.instanceSlug) return;
    this._waPairingLoading = true;
    this._waPairingError = "";
    try {
      this._waPairing = await fetchWhatsAppPairing(this.instanceSlug);
      if ((this._waPairing?.pending.length ?? 0) > 0) {
        this._startWaPairingPoll();
      } else {
        this._stopWaPairingPoll();
      }
    } catch (err) {
      this._waPairingError = err instanceof Error ? err.message : "Failed to load pairing";
    } finally {
      this._waPairingLoading = false;
    }
  }

  private _startWaPairingPoll(): void {
    if (this._waPairingPollTimer) return;
    this._waPairingPollTimer = setInterval(() => {
      void this._loadWaPairing();
    }, 10_000);
  }

  private _stopWaPairingPoll(): void {
    if (this._waPairingPollTimer) {
      clearInterval(this._waPairingPollTimer);
      this._waPairingPollTimer = undefined;
    }
  }

  private async _approveWaPairing(code: string): Promise<void> {
    try {
      await approveWhatsAppPairing(this.instanceSlug, code);
      await this._loadWaPairing();
    } catch (err) {
      this._waPairingError = err instanceof Error ? err.message : "Approve failed";
    }
  }

  private async _rejectWaPairing(code: string): Promise<void> {
    try {
      await rejectWhatsAppPairing(this.instanceSlug, code);
      await this._loadWaPairing();
    } catch (err) {
      this._waPairingError = err instanceof Error ? err.message : "Reject failed";
    }
  }

  // ---------------------------------------------------------------------------
  // WhatsApp — Save logic
  // ---------------------------------------------------------------------------

  private async _saveWaInit(): Promise<void> {
    this._waSaving = true;
    this._waError = "";
    try {
      if (this._waNewToken.trim()) {
        await patchWhatsAppToken(this.instanceSlug, this._waNewToken.trim());
        this._waNewToken = "";
      }

      const result = await patchChannelsConfig(this.instanceSlug, {
        whatsapp: {
          enabled: true,
          mode: this._waMode,
          phoneNumberId: this._waPhoneNumberId,
          dmPolicy: this._waDmPolicy,
        },
      });

      if (result.requiresRestart) {
        this._waRequiresRestart = true;
      }

      const fresh = await fetchInstanceConfig(this.instanceSlug);
      this.config = fresh;
      this._syncWaFromConfig();
      this.dispatchEvent(
        new CustomEvent("channels-config-saved", { bubbles: true, composed: true, detail: fresh }),
      );
    } catch (err) {
      this._waError = err instanceof Error ? err.message : "Save failed";
    } finally {
      this._waSaving = false;
    }
  }

  private async _saveWaEdit(): Promise<void> {
    this._waSaving = true;
    this._waError = "";
    try {
      if (this._waNewToken.trim()) {
        await patchWhatsAppToken(this.instanceSlug, this._waNewToken.trim());
        this._waTokenEditMode = false;
        this._waNewToken = "";
      }

      const result = await patchChannelsConfig(this.instanceSlug, {
        whatsapp: {
          enabled: this._waEnabled,
          mode: this._waMode,
          phoneNumberId: this._waPhoneNumberId,
          dmPolicy: this._waDmPolicy,
        },
      });

      if (result.requiresRestart) {
        this._waRequiresRestart = true;
      }

      const fresh = await fetchInstanceConfig(this.instanceSlug);
      this.config = fresh;
      this._syncWaFromConfig();
      this.dispatchEvent(
        new CustomEvent("channels-config-saved", { bubbles: true, composed: true, detail: fresh }),
      );
    } catch (err) {
      this._waError = err instanceof Error ? err.message : "Save failed";
    } finally {
      this._waSaving = false;
    }
  }

  private async _removeWaToken(): Promise<void> {
    if (!confirm(msg("Remove access token?", { id: "channels-wa-token-confirm-remove" }))) return;
    try {
      await patchWhatsAppToken(this.instanceSlug, null);
      this._waTokenMasked = null;
      this._waTokenEditMode = false;
    } catch (err) {
      this._waError = err instanceof Error ? err.message : "Failed to remove token";
    }
  }

  // ---------------------------------------------------------------------------
  // WhatsApp — Baileys status polling
  // ---------------------------------------------------------------------------

  private async _loadBaileysStatus(): Promise<void> {
    if (!this.instanceSlug) return;
    try {
      const status = await fetchBaileysStatus(this.instanceSlug);
      this._baileysConnected = status.connected;
      this._baileysQrCode = status.qrCode;
      this._baileysPhoneNumber = status.phoneNumber;
      // Keep polling while not connected
      if (!status.connected) {
        this._startBaileysStatusPoll();
      } else {
        this._stopBaileysStatusPoll();
      }
    } catch {
      // Ignore — runtime may not be running
    }
  }

  private _startBaileysStatusPoll(): void {
    if (this._baileysStatusPollTimer) return;
    this._baileysStatusPollTimer = setInterval(() => {
      void this._loadBaileysStatus();
    }, 3_000);
  }

  private _stopBaileysStatusPoll(): void {
    if (this._baileysStatusPollTimer) {
      clearInterval(this._baileysStatusPollTimer);
      this._baileysStatusPollTimer = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // WhatsApp — Render
  // ---------------------------------------------------------------------------

  private _renderWhatsAppCard() {
    switch (this._waPanelState) {
      case "unconfigured":
        return this._renderWaUnconfigured();
      case "init-form":
        return this._renderWaInitForm();
      case "configured":
        return this._renderWaConfigured();
    }
  }

  private _renderWaUnconfigured() {
    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">📱 ${msg("WhatsApp", { id: "channels-whatsapp-title" })}</div>
          <span class="status-badge inactive"
            >○ ${msg("Inactive", { id: "status-wa-inactive" })}</span
          >
        </div>
        <div class="unconfigured-body">
          <span class="unconfigured-text">
            ${msg("WhatsApp is not configured for this instance.", {
              id: "channels-wa-not-configured",
            })}
          </span>
          <button
            class="btn btn-primary"
            @click=${() => {
              this._waPanelState = "init-form";
            }}
          >
            ${msg("Configure WhatsApp", { id: "channels-wa-configure-btn" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderWaInitForm() {
    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">📱 ${msg("WhatsApp", { id: "channels-whatsapp-title" })}</div>
        </div>

        <!-- Mode selector -->
        <div class="form-row-inline">
          <label class="form-label">${msg("Mode", { id: "channels-wa-mode-label" })}</label>
          <select
            .value=${this._waMode}
            @change=${(e: Event) => {
              this._waMode = (e.target as HTMLSelectElement).value as typeof this._waMode;
            }}
            style="max-width: 220px;"
          >
            <option value="cloud-api">Cloud API (Meta Business)</option>
            <option value="baileys">Baileys (Personal)</option>
          </select>
        </div>

        ${this._waMode === "cloud-api" ? this._renderCloudApiFields() : this._renderBaileysInfo()}

        <!-- DM policy -->
        <div class="form-row-inline">
          <label class="form-label">${msg("DM policy", { id: "channels-dmPolicy-label" })}</label>
          <select
            .value=${this._waDmPolicy}
            @change=${(e: Event) => {
              this._waDmPolicy = (e.target as HTMLSelectElement).value as typeof this._waDmPolicy;
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

        ${this._waError ? html`<div class="error-banner">${this._waError}</div>` : nothing}

        <div class="form-actions">
          <button
            class="btn btn-ghost"
            @click=${() => {
              this._waPanelState = "unconfigured";
              this._waNewToken = "";
              this._waError = "";
            }}
            ?disabled=${this._waSaving}
          >
            ${msg("Cancel", { id: "settings-cancel" })}
          </button>
          <button class="btn btn-primary" @click=${this._saveWaInit} ?disabled=${this._waSaving}>
            ${this._waSaving ? "…" : msg("Add", { id: "channels-add-btn" })}
          </button>
        </div>
      </div>
    `;
  }

  /** Cloud API specific fields (token + phone number ID) */
  private _renderCloudApiFields() {
    return html`
      <div class="form-row">
        <label class="form-label">${msg("Access token", { id: "channels-wa-token-label" })}</label>
        <input
          type="password"
          placeholder=${msg("Paste token from Meta Business...", {
            id: "channels-wa-token-placeholder",
          })}
          .value=${this._waNewToken}
          @input=${(e: Event) => {
            this._waNewToken = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">
          ${msg("Long-lived access token from Meta Business dashboard", {
            id: "channels-wa-token-hint",
          })}
        </div>
      </div>
      <div class="form-row">
        <label class="form-label"
          >${msg("Phone Number ID", { id: "channels-wa-phone-label" })}</label
        >
        <input
          type="text"
          placeholder="123456789012345"
          .value=${this._waPhoneNumberId}
          @input=${(e: Event) => {
            this._waPhoneNumberId = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="form-hint">
          ${msg("From WhatsApp Business > Phone Numbers in Meta dashboard", {
            id: "channels-wa-phone-hint",
          })}
        </div>
      </div>
    `;
  }

  /** Baileys mode info section */
  private _renderBaileysInfo() {
    return html`
      <div class="form-row">
        <div class="form-hint" style="color: var(--state-warning); font-size: 12px;">
          ⚠
          ${msg(
            "Baileys uses a reverse-engineered protocol. Your number may be banned by WhatsApp. Use a dedicated number.",
            { id: "channels-wa-baileys-warning" },
          )}
        </div>
        <div class="form-hint" style="margin-top: 8px;">
          ${msg("QR code will appear after enabling and starting the runtime.", {
            id: "channels-wa-baileys-qr-hint",
          })}
        </div>
      </div>
    `;
  }

  /** Cloud API fields for configured state (token management + phone number ID) */
  private _renderCloudApiConfigured() {
    return html`
      <div class="form-row">
        <label class="form-label">${msg("Access token", { id: "channels-wa-token-label" })}</label>
        <div class="token-row">
          ${this._waTokenMasked && !this._waTokenEditMode
            ? html`
                <input type="text" .value=${this._waTokenMasked} disabled />
                <button
                  class="btn btn-ghost"
                  @click=${() => {
                    this._waTokenEditMode = true;
                  }}
                >
                  ${msg("Change", { id: "channels-token-change" })}
                </button>
                <button class="btn btn-ghost" @click=${this._removeWaToken}>×</button>
              `
            : html`
                <input
                  type="password"
                  placeholder=${msg("Paste token from Meta Business...", {
                    id: "channels-wa-token-placeholder",
                  })}
                  .value=${this._waNewToken}
                  @input=${(e: Event) => {
                    this._waNewToken = (e.target as HTMLInputElement).value;
                  }}
                />
                ${this._waTokenEditMode
                  ? html`<button
                      class="btn btn-ghost"
                      @click=${() => {
                        this._waTokenEditMode = false;
                        this._waNewToken = "";
                      }}
                    >
                      ${msg("Cancel", { id: "settings-cancel" })}
                    </button>`
                  : nothing}
              `}
        </div>
      </div>
      <div class="form-row">
        <label class="form-label"
          >${msg("Phone Number ID", { id: "channels-wa-phone-label" })}</label
        >
        <input
          type="text"
          placeholder="123456789012345"
          .value=${this._waPhoneNumberId}
          @input=${(e: Event) => {
            this._waPhoneNumberId = (e.target as HTMLInputElement).value;
          }}
        />
      </div>
    `;
  }

  /** Baileys status section for configured state (QR code + connection status) */
  private _renderBaileysConfigured() {
    return html`
      <div class="form-row">
        <div
          class="form-hint"
          style="color: var(--state-warning); font-size: 12px; margin-bottom: 12px;"
        >
          ⚠
          ${msg(
            "Baileys uses a reverse-engineered protocol. Your number may be banned by WhatsApp.",
            { id: "channels-wa-baileys-warning" },
          )}
        </div>

        ${this._baileysConnected
          ? html`
              <div class="status-badge connected" style="display: inline-flex; margin-bottom: 8px;">
                ● ${msg("Connected", { id: "status-wa-baileys-connected" })}
                ${this._baileysPhoneNumber ? html` — ${this._baileysPhoneNumber}` : nothing}
              </div>
            `
          : this._baileysQrCode
            ? html`
                <div style="margin-bottom: 8px;">
                  <div class="form-label" style="margin-bottom: 6px;">
                    ${msg("Scan QR code with WhatsApp", { id: "channels-wa-baileys-scan" })}
                  </div>
                  <pre
                    style="background: white; color: black; padding: 12px; border-radius: var(--radius-md); font-size: 4px; line-height: 4px; font-family: monospace; display: inline-block; white-space: pre;"
                  >
${this._baileysQrCode}</pre
                  >
                </div>
              `
            : html`
                <div
                  class="status-badge disconnected"
                  style="display: inline-flex; margin-bottom: 8px;"
                >
                  ◎ ${msg("Waiting for connection...", { id: "status-wa-baileys-waiting" })}
                </div>
              `}
      </div>
    `;
  }

  private _renderWaConfigured() {
    const pendingCount = this._waPairing?.pending.length ?? 0;

    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">
            📱 ${msg("WhatsApp", { id: "channels-whatsapp-title" })}
            ${pendingCount > 0 ? html`<span class="pending-badge">${pendingCount}</span>` : nothing}
          </div>
          ${this._renderWaStatusBadge()}
        </div>

        <!-- Enable toggle -->
        <div class="toggle-row">
          <label class="toggle">
            <input
              type="checkbox"
              .checked=${this._waEnabled}
              @change=${(e: Event) => {
                this._waEnabled = (e.target as HTMLInputElement).checked;
              }}
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">${msg("Enabled", { id: "channels-telegram-enabled" })}</span>
        </div>

        <!-- Mode selector -->
        <div class="form-row-inline">
          <label class="form-label">${msg("Mode", { id: "channels-wa-mode-label" })}</label>
          <select
            .value=${this._waMode}
            @change=${(e: Event) => {
              this._waMode = (e.target as HTMLSelectElement).value as typeof this._waMode;
            }}
            style="max-width: 220px;"
          >
            <option value="cloud-api">Cloud API (Meta Business)</option>
            <option value="baileys">Baileys (Personal)</option>
          </select>
        </div>

        ${this._waMode === "cloud-api"
          ? this._renderCloudApiConfigured()
          : this._renderBaileysConfigured()}

        <!-- DM policy -->
        <div class="form-row-inline">
          <label class="form-label">${msg("DM policy", { id: "channels-dmPolicy-label" })}</label>
          <select
            .value=${this._waDmPolicy}
            @change=${(e: Event) => {
              this._waDmPolicy = (e.target as HTMLSelectElement).value as typeof this._waDmPolicy;
              if (this._waDmPolicy === "pairing") {
                void this._loadWaPairing();
              } else {
                this._stopWaPairingPoll();
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

        <!-- Pairing section -->
        ${this._waDmPolicy === "pairing" ? this._renderWaPairingSection() : nothing}
        ${this._waError ? html`<div class="error-banner">${this._waError}</div>` : nothing}
        ${this._waRequiresRestart
          ? html`
              <div class="restart-banner">
                <span>
                  ${msg("Changes require a runtime restart to take effect.", {
                    id: "channels-restartWarning",
                  })}
                </span>
              </div>
            `
          : nothing}

        <div class="form-actions">
          <button
            class="btn btn-ghost"
            @click=${this._syncWaFromConfig}
            ?disabled=${this._waSaving}
          >
            ${msg("Cancel", { id: "settings-cancel" })}
          </button>
          <button class="btn btn-primary" @click=${this._saveWaEdit} ?disabled=${this._waSaving}>
            ${this._waSaving ? "…" : msg("Save", { id: "settings-save" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderWaPairingSection() {
    const pending = this._waPairing?.pending ?? [];
    const approvedCount = this._waPairing?.approved.length ?? 0;

    return html`
      <div class="pairing-section">
        <div class="pairing-header">
          <span class="pairing-title">
            ${msg("Pairing requests", { id: "channels-pairing-title" })}
          </span>
          <button
            class="btn btn-ghost"
            style="font-size: 12px; padding: 3px 8px;"
            @click=${() => void this._loadWaPairing()}
            ?disabled=${this._waPairingLoading}
          >
            ${this._waPairingLoading ? "…" : msg("Refresh", { id: "channels-pairing-refresh" })}
          </button>
        </div>

        ${this._waPairingError
          ? html`<div class="error-banner" style="margin-bottom: 8px;">
              ${this._waPairingError}
            </div>`
          : nothing}

        <div class="pairing-list">
          ${pending.length === 0
            ? html`<div class="pairing-empty">
                ${msg("No pending pairing requests.", { id: "channels-pairing-empty" })}
              </div>`
            : pending.map(
                (req) => html`
                  <div class="pairing-item">
                    <span class="pairing-username"> ${req.meta?.name ?? req.id} </span>
                    <span class="pairing-code">
                      ${msg("Code", { id: "channels-pairing-code-label" })}:
                      ${req.code.slice(0, 4)}-${req.code.slice(4)}
                    </span>
                    <span class="pairing-time">${this._relativeTime(req.createdAt)}</span>
                    <div class="pairing-actions">
                      <button
                        class="btn btn-primary"
                        style="font-size: 12px; padding: 3px 10px;"
                        @click=${() => void this._approveWaPairing(req.code)}
                      >
                        ${msg("Approve", { id: "channels-pairing-approve" })}
                      </button>
                      <button
                        class="btn btn-ghost"
                        style="font-size: 12px; padding: 3px 8px;"
                        @click=${() => void this._rejectWaPairing(req.code)}
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

  private _renderWaStatusBadge() {
    if (!this._waEnabled) {
      return html`<span class="status-badge inactive">
        ○ ${msg("Inactive", { id: "status-wa-inactive" })}
      </span>`;
    }
    if (!this._waTokenMasked) {
      return html`<span class="status-badge disconnected">
        ◎ ${msg("No token", { id: "status-wa-no-token" })}
      </span>`;
    }
    return html`<span class="status-badge connected">
      ● ${msg("Configured", { id: "status-wa-configured" })}
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
