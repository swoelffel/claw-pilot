// ui/src/components/self-update-banner.ts
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { SelfUpdateStatus } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-self-update-banner")
export class SelfUpdateBanner extends LitElement {
  static styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
        border-radius: var(--radius-md);
        border: 1px solid;
        margin-bottom: 20px;
        font-size: 13px;
      }

      .banner-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .banner-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      .banner-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .banner-title {
        font-weight: 600;
        color: inherit;
      }

      .banner-sub {
        font-size: 12px;
        opacity: 0.75;
      }

      /* warning — update disponible */
      .banner.warning {
        background: rgba(245, 158, 11, 0.06);
        border-color: rgba(245, 158, 11, 0.25);
        color: var(--state-warning);
      }

      /* info — en cours */
      .banner.info {
        background: rgba(14, 165, 233, 0.06);
        border-color: rgba(14, 165, 233, 0.25);
        color: var(--state-info);
      }

      /* success — done */
      .banner.success {
        background: rgba(16, 185, 129, 0.06);
        border-color: rgba(16, 185, 129, 0.25);
        color: var(--state-running);
      }

      /* error */
      .banner.error {
        background: rgba(239, 68, 68, 0.06);
        border-color: rgba(239, 68, 68, 0.25);
        color: var(--state-error);
      }

      .btn-update {
        flex: none;
        padding: 6px 14px;
        border-radius: var(--radius-md);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.12);
        color: var(--state-warning);
        transition: background 0.15s;
        font-family: var(--font-ui);
        white-space: nowrap;
      }

      .btn-update:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.2);
      }

      .btn-update:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-retry {
        flex: none;
        padding: 6px 14px;
        border-radius: var(--radius-md);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.12);
        color: var(--state-error);
        transition: background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-retry:hover {
        background: rgba(239, 68, 68, 0.2);
      }

      .spinner-inline {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
        opacity: 0.8;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .version-tag {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
      }
    `,
  ];

  @property({ attribute: false }) status: SelfUpdateStatus | null = null;

  private _handleUpdate() {
    this.dispatchEvent(new CustomEvent("cp-self-update-start", { bubbles: true, composed: true }));
  }

  private _handleRetry() {
    this.dispatchEvent(new CustomEvent("cp-self-update-start", { bubbles: true, composed: true }));
  }

  render() {
    if (!this.status) return nothing;

    const { updateAvailable, currentVersion, latestVersion, status, message, toVersion } =
      this.status;

    // Rien a afficher si pas d'update et pas de job actif
    if (!updateAvailable && status === "idle") return nothing;

    if (status === "running") {
      return html`
        <div class="banner info" role="status" aria-live="polite">
          <div class="banner-left">
            <span class="banner-icon">⬆</span>
            <div class="banner-text">
              <span class="banner-title">
                <span class="spinner-inline" aria-hidden="true"></span>
                ${msg("Updating claw-pilot…")}
              </span>
              <span class="banner-sub">${msg("This may take several minutes (git + build)")}</span>
            </div>
          </div>
        </div>
      `;
    }

    if (status === "done") {
      return html`
        <div class="banner success" role="status" aria-live="polite">
          <div class="banner-left">
            <span class="banner-icon">✓</span>
            <div class="banner-text">
              <span class="banner-title">
                ${msg("claw-pilot updated")}
                ${toVersion ? html`<span class="version-tag"> → v${toVersion}</span>` : nothing}
              </span>
              <span class="banner-sub">${message ?? msg("Dashboard service restarted")}</span>
            </div>
          </div>
        </div>
      `;
    }

    if (status === "error") {
      return html`
        <div class="banner error" role="alert">
          <div class="banner-left">
            <span class="banner-icon">✕</span>
            <div class="banner-text">
              <span class="banner-title">${msg("claw-pilot update failed")}</span>
              <span class="banner-sub">${message ?? msg("An error occurred during the update")}</span>
            </div>
          </div>
          <button class="btn-retry" @click=${this._handleRetry}>
            ${msg("Retry")}
          </button>
        </div>
      `;
    }

    // Etat par defaut : update disponible (idle)
    if (updateAvailable) {
      return html`
        <div class="banner warning" role="status">
          <div class="banner-left">
            <span class="banner-icon">↑</span>
            <div class="banner-text">
              <span class="banner-title">
                ${msg("claw-pilot update available")}
                ${latestVersion
                  ? html`<span class="version-tag"> v${latestVersion}</span>`
                  : nothing}
              </span>
              <span class="banner-sub">
                ${currentVersion
                  ? msg(html`Running <span class="version-tag">v${currentVersion}</span>`)
                  : nothing}
              </span>
            </div>
          </div>
          <button class="btn-update" @click=${this._handleUpdate}>
            ${msg("Update claw-pilot")}
          </button>
        </div>
      `;
    }

    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-self-update-banner": SelfUpdateBanner;
  }
}
