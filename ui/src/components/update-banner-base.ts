// ui/src/components/update-banner-base.ts
//
// Composant de base partagé entre cp-update-banner (OpenClaw) et
// cp-self-update-banner (claw-pilot). Factorise le CSS et la structure HTML
// des 4 états (idle/running/done/error).
//
// Événements émis :
//   cp-update-action  — clic Update ou Retry (bubbles + composed)
//   cp-update-dismiss — clic × sur l'état done (bubbles + composed, si dismissable=true)

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { OpenClawUpdateStatus, SelfUpdateStatus } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";

type UpdateStatus = OpenClawUpdateStatus | SelfUpdateStatus;

@localized()
@customElement("cp-update-banner-base")
export class UpdateBannerBase extends LitElement {
  static override styles = [
    tokenStyles,
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

      /* Bouton Update (état warning) */
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

      /* Bouton Retry (état error) */
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
        white-space: nowrap;
      }

      .btn-retry:hover {
        background: rgba(239, 68, 68, 0.2);
      }

      /* Bouton Dismiss × (état done, si dismissable) */
      .btn-dismiss {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--radius-sm);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        border: 1px solid rgba(16, 185, 129, 0.25);
        background: transparent;
        color: var(--state-running);
        opacity: 0.6;
        transition:
          opacity 0.15s,
          background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-dismiss:hover {
        opacity: 1;
        background: rgba(16, 185, 129, 0.12);
      }

      /* Spinner inline (état running) */
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
        to {
          transform: rotate(360deg);
        }
      }

      /* Tags de version */
      .version-tag {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
      }
    `,
  ];

  /** Statut de mise à jour passé par le composant parent. */
  @property({ attribute: false }) status: UpdateStatus | null = null;

  /** Nom du produit affiché dans les messages (ex: "OpenClaw", "claw-pilot"). */
  @property() productName = "";

  /** Label du bouton d'action principal (état idle+updateAvailable). */
  @property() buttonLabel = "";

  /** Sous-titre affiché pendant l'état running. */
  @property() runningSubtitle = "";

  /** Sous-titre affiché après succès (état done). */
  @property() doneSubtitle = "";

  /**
   * Si true, un bouton × apparaît sur l'état done pour permettre
   * à l'utilisateur de fermer manuellement le bandeau.
   * Utile quand le dismiss automatique peut échouer (ex: reload page).
   */
  @property({ type: Boolean }) dismissable = false;

  /** État local de dismiss — reset automatiquement si status change. */
  @state() private _dismissed = false;

  override willUpdate(changed: Map<string, unknown>): void {
    // Reset le dismiss si le statut change (nouveau cycle de mise à jour)
    if (changed.has("status")) {
      this._dismissed = false;
    }
  }

  private _handleAction(): void {
    this.dispatchEvent(new CustomEvent("cp-update-action", { bubbles: true, composed: true }));
  }

  private _handleDismiss(): void {
    this._dismissed = true;
    this.dispatchEvent(new CustomEvent("cp-update-dismiss", { bubbles: true, composed: true }));
  }

  override render() {
    if (!this.status || this._dismissed) return nothing;

    const { updateAvailable, currentVersion, latestVersion, status, message, toVersion } =
      this.status;

    // Rien à afficher si pas d'update et pas de job actif
    if (!updateAvailable && status === "idle") return nothing;

    if (status === "running") {
      return html`
        <div class="banner info" role="status" aria-live="polite">
          <div class="banner-left">
            <span class="banner-icon">⬆</span>
            <div class="banner-text">
              <span class="banner-title">
                <span class="spinner-inline" aria-hidden="true"></span>
                ${msg(html`Updating ${this.productName}…`)}
              </span>
              <span class="banner-sub">${this.runningSubtitle}</span>
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
                ${msg(html`${this.productName} updated`)}
                ${toVersion ? html`<span class="version-tag"> → v${toVersion}</span>` : nothing}
              </span>
              <span class="banner-sub">${message ?? this.doneSubtitle}</span>
            </div>
          </div>
          ${this.dismissable
            ? html`
                <button
                  class="btn-dismiss"
                  aria-label=${msg("Dismiss")}
                  @click=${this._handleDismiss}
                >
                  ×
                </button>
              `
            : nothing}
        </div>
      `;
    }

    if (status === "error") {
      return html`
        <div class="banner error" role="alert">
          <div class="banner-left">
            <span class="banner-icon">✕</span>
            <div class="banner-text">
              <span class="banner-title"> ${msg(html`${this.productName} update failed`)} </span>
              <span class="banner-sub"
                >${message ?? msg("An error occurred during the update")}</span
              >
            </div>
          </div>
          <button class="btn-retry" @click=${this._handleAction}>${msg("Retry")}</button>
        </div>
      `;
    }

    // État par défaut : update disponible (idle)
    if (updateAvailable) {
      return html`
        <div class="banner warning" role="status">
          <div class="banner-left">
            <span class="banner-icon">↑</span>
            <div class="banner-text">
              <span class="banner-title">
                ${msg(html`${this.productName} update available`)}
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
          <button class="btn-update" @click=${this._handleAction}>${this.buttonLabel}</button>
        </div>
      `;
    }

    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-update-banner-base": UpdateBannerBase;
  }
}
