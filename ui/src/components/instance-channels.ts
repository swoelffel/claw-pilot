// ui/src/components/instance-channels.ts
// Panneau Channels — configuration Telegram et placeholders WhatsApp/Slack
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceConfig } from "../types.js";
import { fetchInstanceConfig, patchChannelsConfig, patchTelegramToken } from "../api.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";

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

      input[type="text"],
      input[type="password"],
      input[type="number"],
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
      input:focus,
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

      .dm-policy-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .radio-option {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .radio-option input {
        cursor: pointer;
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
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  @property({ type: Object }) config: InstanceConfig | null = null;

  @state() private _enabled = false;
  @state() private _botTokenEnvVar = "TELEGRAM_BOT_TOKEN";
  @state() private _pollingIntervalMs = 1000;
  @state() private _allowedUserIds = "";
  @state() private _dmPolicy: "allow" | "allowlist" | "disabled" = "allowlist";
  @state() private _tokenMasked: string | null = null;
  @state() private _tokenEditMode = false;
  @state() private _newToken = "";
  @state() private _saving = false;
  @state() private _error = "";
  @state() private _requiresRestart = false;
  @state() private _restarting = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._syncFromConfig();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("config")) {
      this._syncFromConfig();
    }
  }

  private _syncFromConfig(): void {
    const tg = this.config?.channels?.telegram;
    if (tg) {
      this._enabled = tg.enabled;
      this._tokenMasked = tg.botTokenMasked;
      this._dmPolicy = (tg.dmPolicy as "allow" | "allowlist" | "disabled") ?? "allowlist";
    } else {
      this._enabled = false;
      this._tokenMasked = null;
    }
  }

  private async _save(): Promise<void> {
    this._saving = true;
    this._error = "";
    try {
      // 1. Save token if changed
      if (this._tokenEditMode && this._newToken.trim()) {
        await patchTelegramToken(this.instanceSlug, this._newToken.trim());
        this._tokenEditMode = false;
        this._newToken = "";
      }

      // 2. Parse allowedUserIds
      const allowedUserIds = this._allowedUserIds
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));

      // 3. Patch config
      const result = await patchChannelsConfig(this.instanceSlug, {
        telegram: {
          enabled: this._enabled,
          botTokenEnvVar: this._botTokenEnvVar,
          pollingIntervalMs: this._pollingIntervalMs,
          allowedUserIds,
        },
      });

      if (result.requiresRestart) {
        this._requiresRestart = true;
      }

      // Reload config
      const fresh = await fetchInstanceConfig(this.instanceSlug);
      this.config = fresh;
      this._syncFromConfig();
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
          Authorization: `Bearer ${(window as unknown as { __CP_TOKEN__?: string }).__CP_TOKEN__ ?? ""}`,
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
    return html`
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="channel-title">
            ✈ ${msg("Telegram Bot", { id: "channels-telegram-title" })}
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
                    placeholder=${msg("Paste bot token here...", {
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

        <!-- Env var name -->
        <div class="form-row">
          <label class="form-label">${msg("Env var name", { id: "channels-envVar-label" })}</label>
          <input
            type="text"
            .value=${this._botTokenEnvVar}
            @input=${(e: Event) => {
              this._botTokenEnvVar = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <!-- Polling interval -->
        <div class="form-row">
          <label class="form-label"
            >${msg("Polling interval (ms)", { id: "channels-polling-label" })}</label
          >
          <input
            type="number"
            min="0"
            .value=${String(this._pollingIntervalMs)}
            @input=${(e: Event) => {
              this._pollingIntervalMs = parseInt((e.target as HTMLInputElement).value, 10) || 1000;
            }}
            style="max-width: 120px;"
          />
        </div>

        <!-- DM policy -->
        <div class="form-row">
          <label class="form-label">${msg("DM policy", { id: "channels-dmPolicy-label" })}</label>
          <div class="dm-policy-row">
            ${(["allow", "allowlist", "disabled"] as const).map(
              (p) => html`
                <label class="radio-option">
                  <input
                    type="radio"
                    name="dmPolicy"
                    value=${p}
                    .checked=${this._dmPolicy === p}
                    @change=${() => {
                      this._dmPolicy = p;
                    }}
                  />
                  ${p === "allow"
                    ? msg("Allow all", { id: "channels-dmPolicy-allowAll" })
                    : p === "allowlist"
                      ? msg("Allowlist", { id: "channels-dmPolicy-allowlist" })
                      : msg("Disabled", { id: "channels-dmPolicy-disabled" })}
                </label>
              `,
            )}
          </div>
        </div>

        <!-- Allowed user IDs -->
        <div class="form-row">
          <label class="form-label"
            >${msg("Allowed user IDs", { id: "channels-allowedIds-label" })}</label
          >
          <textarea
            rows="3"
            placeholder="123456789&#10;987654321"
            .value=${this._allowedUserIds}
            @input=${(e: Event) => {
              this._allowedUserIds = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>
          <span class="form-hint"
            >${msg("Telegram numeric IDs, one per line", { id: "channels-allowedIds-hint" })}</span
          >
        </div>

        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
        ${this._requiresRestart
          ? html`
              <div class="restart-banner">
                <span
                  >${msg("Changes require a runtime restart to take effect.", {
                    id: "channels-restartWarning",
                  })}</span
                >
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
          <button class="btn btn-primary" @click=${this._save} ?disabled=${this._saving}>
            ${this._saving ? "…" : msg("Save", { id: "settings-save" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderStatusBadge() {
    // Status badge based on config (no live health in this component — health comes from instance-card)
    if (!this._enabled) {
      return html`<span class="status-badge inactive"
        >○ ${msg("Inactive", { id: "status-telegram-inactive" })}</span
      >`;
    }
    if (!this._tokenMasked) {
      return html`<span class="status-badge disconnected"
        >◎ ${msg("No token", { id: "status-telegram-no-token" })}</span
      >`;
    }
    return html`<span class="status-badge connected"
      >● ${msg("Configured", { id: "status-telegram-configured" })}</span
    >`;
  }

  private _renderComingSoonCard(name: string) {
    return html`
      <div class="coming-soon-card">
        <span class="coming-soon-title">${name}</span>
        <span class="coming-soon-badge">${msg("Coming soon", { id: "channels-comingSoon" })}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-channels": InstanceChannels;
  }
}
