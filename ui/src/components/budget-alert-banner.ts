// ui/src/components/budget-alert-banner.ts
// Budget alert banners — displayed at the top of instance pages when budgets
// approach or exceed their limits. Includes override confirmation dialog.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { overrideBudgetApi, fetchBudgets } from "../api.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BannerAlert {
  budgetId: number;
  scope: string;
  scopeId: string | null;
  spentUsd: number;
  limitUsd: number;
  overridePct: number;
  level: "warning" | "exceeded";
  dismissed: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-budget-alert-banner")
export class CpBudgetAlertBanner extends LitElement {
  @property({ type: String }) slug = "";

  @state() private _alerts: BannerAlert[] = [];
  @state() private _confirmId: number | null = null;
  private _pollTimer: number | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._checkBudgets();
    this._pollTimer = window.setInterval(() => void this._checkBudgets(), 60_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._pollTimer !== undefined) {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }
  }

  private async _checkBudgets(): Promise<void> {
    if (!this.slug) return;
    try {
      const budgets = await fetchBudgets(this.slug);
      const newAlerts: BannerAlert[] = [];
      for (const b of budgets) {
        if (!b.enabled) continue;
        const pct = b.limitUsd > 0 ? b.spentUsd / b.limitUsd : 0;
        if (pct >= b.hardStopPct) {
          newAlerts.push({
            budgetId: b.id,
            scope: b.scope,
            scopeId: b.scopeId,
            spentUsd: b.spentUsd,
            limitUsd: b.limitUsd,
            overridePct: b.overridePct,
            level: "exceeded",
            dismissed: this._isDismissed(b.id),
          });
        } else if (pct >= b.softAlertPct) {
          newAlerts.push({
            budgetId: b.id,
            scope: b.scope,
            scopeId: b.scopeId,
            spentUsd: b.spentUsd,
            limitUsd: b.limitUsd,
            overridePct: b.overridePct,
            level: "warning",
            dismissed: this._isDismissed(b.id),
          });
        }
      }
      this._alerts = newAlerts;
    } catch {
      // Silent — banners are best-effort
    }
  }

  private _dismissedIds = new Set<number>();

  private _isDismissed(id: number): boolean {
    return this._dismissedIds.has(id);
  }

  private _dismiss(id: number): void {
    this._dismissedIds.add(id);
    this._alerts = this._alerts.map((a) => (a.budgetId === id ? { ...a, dismissed: true } : a));
  }

  private _requestOverride(id: number): void {
    this._confirmId = id;
  }

  private _cancelOverride(): void {
    this._confirmId = null;
  }

  private async _confirmOverride(): Promise<void> {
    if (this._confirmId === null) return;
    try {
      await overrideBudgetApi(this.slug, this._confirmId);
      this._dismissedIds.add(this._confirmId);
      this._confirmId = null;
      void this._checkBudgets();
    } catch {
      // Silent
    }
  }

  private _goToBudgets(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "costs", slug: this.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const visible = this._alerts.filter((a) => !a.dismissed).slice(0, 3);
    const confirm =
      this._confirmId !== null ? this._alerts.find((a) => a.budgetId === this._confirmId) : null;

    return html`
      ${visible.map((a) => this._renderBanner(a))}
      ${confirm ? this._renderConfirmDialog(confirm) : nothing}
    `;
  }

  private _renderBanner(a: BannerAlert) {
    const label = a.scopeId ?? "instance";
    const spent = `$${a.spentUsd.toFixed(2)}`;
    const limit = `$${a.limitUsd.toFixed(2)}`;

    if (a.level === "exceeded") {
      return html`
        <div class="banner exceeded">
          <div class="banner-text">
            ⚠ <strong>${label}</strong> —
            ${msg("budget exceeded, agent paused", { id: "budget-banner-exceeded" })}
            (${spent}/${limit})
          </div>
          <div class="banner-actions">
            <button class="btn-override" @click=${() => this._requestOverride(a.budgetId)}>
              ${msg("Override", { id: "budget-banner-override" })}
              +${Math.round(a.overridePct * 100)}%
            </button>
            <button class="btn-link" @click=${() => this._goToBudgets()}>
              ${msg("Budgets", { id: "budget-banner-budgets" })}
            </button>
            <button class="btn-dismiss" @click=${() => this._dismiss(a.budgetId)}>
              ${msg("Dismiss", { id: "budget-banner-dismiss" })}
            </button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="banner warning">
        <div class="banner-text">
          ⚠ <strong>${label}</strong> — ${msg("has reached", { id: "budget-banner-reached" })}
          ${Math.round((a.spentUsd / a.limitUsd) * 100)}%
          ${msg("of budget", { id: "budget-banner-of-budget" })} (${spent}/${limit})
        </div>
        <div class="banner-actions">
          <button class="btn-link" @click=${() => this._goToBudgets()}>
            ${msg("Budgets", { id: "budget-banner-budgets" })}
          </button>
          <button class="btn-dismiss" @click=${() => this._dismiss(a.budgetId)}>
            ${msg("Dismiss", { id: "budget-banner-dismiss" })}
          </button>
        </div>
      </div>
    `;
  }

  private _renderConfirmDialog(a: BannerAlert) {
    const addPct = Math.round(a.overridePct * 100);
    const addUsd = a.limitUsd * a.overridePct;
    const newLimit = a.limitUsd + addUsd;
    return html`
      <div class="dialog-backdrop" @click=${() => this._cancelOverride()}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${msg("Confirm budget override", { id: "budget-confirm-title" })}</h3>
          <p class="dialog-body">
            ${msg("You are about to add", { id: "budget-confirm-body" })}
            <strong>${addPct}%</strong>
            (${msg("i.e.", { id: "budget-confirm-ie" })}
            <strong>$${addUsd.toFixed(2)}</strong>)
            ${msg("to the budget to continue.", { id: "budget-confirm-body2" })}
          </p>
          <p class="dialog-detail">
            ${msg("New limit:", { id: "budget-confirm-new-limit" })}
            <span class="mono">$${a.limitUsd.toFixed(2)} → $${newLimit.toFixed(2)}</span>
          </p>
          <div class="dialog-actions">
            <button class="btn-cancel" @click=${() => this._cancelOverride()}>
              ${msg("Cancel", { id: "budget-confirm-cancel" })}
            </button>
            <button class="btn-confirm" @click=${() => void this._confirmOverride()}>
              ${msg("Add", { id: "budget-confirm-add" })} $${addUsd.toFixed(2)}
              ${msg("and continue", { id: "budget-confirm-continue" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        margin-bottom: 8px;
        border-radius: var(--radius-md);
        font-size: 13px;
      }
      .banner.warning {
        background: rgba(245, 158, 11, 0.1);
        border-left: 3px solid var(--state-warning);
        color: var(--state-warning);
      }
      .banner.exceeded {
        background: rgba(239, 68, 68, 0.1);
        border-left: 3px solid var(--state-error);
        color: var(--state-error);
      }
      .banner-text {
        flex: 1;
      }
      .banner-text strong {
        font-family: var(--font-mono);
      }
      .banner-actions {
        display: flex;
        gap: 8px;
        margin-left: 16px;
        flex-shrink: 0;
      }
      .btn-override {
        padding: 4px 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--state-warning);
        background: transparent;
        color: var(--state-warning);
        cursor: pointer;
        font-size: 12px;
      }
      .btn-override:hover {
        background: rgba(245, 158, 11, 0.15);
      }
      .btn-link {
        padding: 4px 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--accent-border);
        background: transparent;
        color: var(--accent);
        cursor: pointer;
        font-size: 12px;
      }
      .btn-link:hover {
        background: var(--accent-subtle);
      }
      .btn-dismiss {
        padding: 4px 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
      }
      .btn-dismiss:hover {
        background: var(--bg-hover);
      }
      /* Confirmation dialog */
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .dialog {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: 24px;
        max-width: 420px;
        width: 90%;
      }
      .dialog h3 {
        margin: 0 0 12px;
        font-size: 16px;
        color: var(--text-primary);
      }
      .dialog-body {
        color: var(--text-secondary);
        font-size: 14px;
        margin: 0 0 8px;
        line-height: 1.5;
      }
      .dialog-detail {
        color: var(--text-muted);
        font-size: 13px;
        margin: 0 0 20px;
      }
      .mono {
        font-family: var(--font-mono);
        color: var(--text-primary);
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .btn-cancel {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 13px;
      }
      .btn-cancel:hover {
        background: var(--bg-hover);
      }
      .btn-confirm {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid var(--state-warning);
        background: var(--state-warning);
        color: #000;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
      }
      .btn-confirm:hover {
        opacity: 0.9;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-budget-alert-banner": CpBudgetAlertBanner;
  }
}
