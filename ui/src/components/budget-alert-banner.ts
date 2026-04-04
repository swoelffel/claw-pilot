// ui/src/components/budget-alert-banner.ts
// Budget alert banners — displayed at the top of instance pages when budgets
// are in warning or exceeded state.

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
  private _pollTimer: number | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._checkBudgets();
    // Poll every 60 seconds for budget status
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

  private async _override(id: number): Promise<void> {
    try {
      await overrideBudgetApi(this.slug, id);
      this._dismissedIds.add(id);
      void this._checkBudgets();
    } catch {
      // Silent
    }
  }

  override render() {
    const visible = this._alerts.filter((a) => !a.dismissed).slice(0, 3);
    if (visible.length === 0) return nothing;

    return html`${visible.map((a) => this._renderBanner(a))}`;
  }

  private _renderBanner(a: BannerAlert) {
    const label = a.scopeId ?? "instance";
    const spent = `$${a.spentUsd.toFixed(2)}`;
    const limit = `$${a.limitUsd.toFixed(2)}`;

    if (a.level === "exceeded") {
      return html`
        <div class="banner exceeded">
          <div class="banner-text">
            🛑 <strong>${label}</strong> ${msg("budget exceeded — agent paused")}
            (${spent}/${limit})
          </div>
          <div class="banner-actions">
            <button class="btn-override" @click=${() => void this._override(a.budgetId)}>
              ${msg("Override")} +${Math.round(a.overridePct * 100)}%
            </button>
            <button class="btn-dismiss" @click=${() => this._dismiss(a.budgetId)}>
              ${msg("Dismiss")}
            </button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="banner warning">
        <div class="banner-text">
          ⚠️ <strong>${label}</strong>
          ${msg("has reached")} ${Math.round((a.spentUsd / a.limitUsd) * 100)}% ${msg("of budget")}
          (${spent}/${limit})
        </div>
        <div class="banner-actions">
          <button class="btn-dismiss" @click=${() => this._dismiss(a.budgetId)}>
            ${msg("Dismiss")}
          </button>
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
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-budget-alert-banner": CpBudgetAlertBanner;
  }
}
