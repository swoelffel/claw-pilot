// ui/src/components/budget-settings.ts
// Budget enforcement management panel — integrated as a tab in the costs dashboard.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchBudgets,
  createBudgetApi,
  updateBudgetApi,
  deleteBudgetApi,
  overrideBudgetApi,
  fetchAllBudgetEvents,
  fetchBuilderData,
} from "../api.js";
import type { BudgetInfo, BudgetEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v === 0) return "$0.00";
  return `$${v.toFixed(4)}`;
}

function pct(spent: number, limit: number): number {
  return limit > 0 ? Math.round((spent / limit) * 100) : 0;
}

function barColor(p: number, softPct: number, hardPct: number): string {
  if (p >= hardPct * 100) return "var(--state-error)";
  if (p >= softPct * 100) return "var(--state-warning)";
  return "var(--state-running)";
}

function statusLabel(spent: number, limit: number, softPct: number, hardPct: number): string {
  const p = limit > 0 ? spent / limit : 0;
  if (p >= hardPct) return "exceeded";
  if (p >= softPct) return "warning";
  return "ok";
}

const EVENT_ICONS: Record<string, string> = {
  soft_alert: "\u26a0\ufe0f",
  hard_stop: "\ud83d\uded1",
  reset: "\u21bb",
  override: "\u2b06",
  reconcile: "\ud83d\udd04",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-budget-settings")
export class CpBudgetSettings extends LitElement {
  @property({ type: String }) slug = "";

  @state() private _budgets: BudgetInfo[] = [];
  @state() private _events: BudgetEvent[] = [];
  @state() private _agentIds: string[] = [];
  @state() private _loading = true;
  @state() private _error = "";

  // Dialog state
  @state() private _dialogOpen = false;
  @state() private _dialogScope: "instance" | "agent" = "instance";
  @state() private _editId: number | null = null;
  @state() private _formScopeId = "";
  @state() private _formPeriod: "monthly" | "lifetime" = "monthly";
  @state() private _formLimit = "50";
  @state() private _formSoftPct = "80";
  @state() private _formHardPct = "100";
  @state() private _formOverridePct = "20";

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = "";
    try {
      const [budgets, events, builder] = await Promise.all([
        fetchBudgets(this.slug),
        fetchAllBudgetEvents(this.slug),
        fetchBuilderData(this.slug),
      ]);
      this._budgets = budgets;
      this._events = events;
      this._agentIds = builder.agents.map((a) => a.agent_id);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Dialog
  // ---------------------------------------------------------------------------

  private _openCreateInstance(): void {
    this._editId = null;
    this._dialogScope = "instance";
    this._formScopeId = "";
    this._formPeriod = "monthly";
    this._formLimit = "50";
    this._formSoftPct = "80";
    this._formHardPct = "100";
    this._formOverridePct = "20";
    this._dialogOpen = true;
  }

  private _openCreateAgent(): void {
    this._editId = null;
    this._dialogScope = "agent";
    this._formScopeId = this._agentIds[0] ?? "";
    this._formPeriod = "monthly";
    this._formLimit = "20";
    this._formSoftPct = "80";
    this._formHardPct = "100";
    this._formOverridePct = "20";
    this._dialogOpen = true;
  }

  private _openEdit(b: BudgetInfo): void {
    this._editId = b.id;
    this._dialogScope = b.scope;
    this._formScopeId = b.scopeId ?? "";
    this._formPeriod = b.period;
    this._formLimit = String(b.limitUsd);
    this._formSoftPct = String(Math.round(b.softAlertPct * 100));
    this._formHardPct = String(Math.round(b.hardStopPct * 100));
    this._formOverridePct = String(Math.round(b.overridePct * 100));
    this._dialogOpen = true;
  }

  private _closeDialog(): void {
    this._dialogOpen = false;
  }

  private async _submitDialog(): Promise<void> {
    const limit = Number(this._formLimit);
    const softPct = Number(this._formSoftPct) / 100;
    const hardPct = Number(this._formHardPct) / 100;
    const overridePct = Number(this._formOverridePct) / 100;

    try {
      if (this._editId !== null) {
        await updateBudgetApi(this.slug, this._editId, {
          limitUsd: limit,
          softAlertPct: softPct,
          hardStopPct: hardPct,
          overridePct: overridePct,
        });
      } else {
        await createBudgetApi(this.slug, {
          scope: this._dialogScope,
          ...(this._dialogScope === "agent" ? { scopeId: this._formScopeId } : {}),
          period: this._formPeriod,
          limitUsd: limit,
          softAlertPct: softPct,
          hardStopPct: hardPct,
          overridePct: overridePct,
        });
      }
      this._dialogOpen = false;
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _delete(id: number): Promise<void> {
    try {
      await deleteBudgetApi(this.slug, id);
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _override(id: number): Promise<void> {
    try {
      await overrideBudgetApi(this.slug, id);
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    if (this._loading) return html`<div class="center">${msg("Loading budgets...")}</div>`;
    if (this._error) return html`<div class="center error">${this._error}</div>`;

    const instanceBudgets = this._budgets.filter((b) => b.scope === "instance");
    const agentBudgets = this._budgets.filter((b) => b.scope === "agent");

    return html`
      ${this._renderInstanceSection(instanceBudgets)} ${this._renderAgentSection(agentBudgets)}
      ${this._renderEventLog()} ${this._dialogOpen ? this._renderDialog() : nothing}
    `;
  }

  // ---------------------------------------------------------------------------
  // Instance Budget section
  // ---------------------------------------------------------------------------

  private _renderInstanceSection(budgets: BudgetInfo[]) {
    const b = budgets[0];
    return html`
      <section class="card">
        <div class="card-header">
          <span class="card-title">${msg("Instance Budget")}</span>
          ${!b
            ? html`<button class="btn-sm accent" @click=${() => this._openCreateInstance()}>
                + ${msg("Add Budget")}
              </button>`
            : nothing}
        </div>
        ${b
          ? this._renderBudgetCard(b)
          : html`<div class="empty">${msg("No instance budget configured.")}</div>`}
      </section>
    `;
  }

  private _renderBudgetCard(b: BudgetInfo) {
    const p = pct(b.spentUsd, b.limitUsd);
    const status = statusLabel(b.spentUsd, b.limitUsd, b.softAlertPct, b.hardStopPct);
    return html`
      <div class="budget-card">
        <div class="budget-card-header">
          <span class="budget-period">${b.period}</span>
          <div class="card-actions">
            <button class="btn-sm" @click=${() => this._openEdit(b)}>${msg("Edit")}</button>
            <button class="btn-sm danger" @click=${() => this._delete(b.id)}>✕</button>
          </div>
        </div>
        <div class="budget-details">
          ${msg("Limit:")} ${fmtUsd(b.limitUsd)} &nbsp; ${msg("Alert:")}
          ${Math.round(b.softAlertPct * 100)}% &nbsp; ${msg("Stop:")}
          ${Math.round(b.hardStopPct * 100)}% &nbsp; ${msg("Override:")}
          +${Math.round(b.overridePct * 100)}%
        </div>
        <div class="budget-spent">
          ${msg("Spent:")} ${fmtUsd(b.spentUsd)} / ${fmtUsd(b.limitUsd)} (${p}%)
        </div>
        <div class="bar-track">
          <div
            class="bar-fill"
            style="width: ${Math.min(p, 100)}%; background: ${barColor(
              p,
              b.softAlertPct,
              b.hardStopPct,
            )}"
          ></div>
        </div>
        <div class="budget-footer">
          <span
            >${b.period === "monthly" ? `Period: ${b.periodStart.slice(0, 7)}` : "Lifetime"}</span
          >
          <span>${msg("Remaining:")} ${fmtUsd(Math.max(0, b.limitUsd - b.spentUsd))}</span>
          ${status === "exceeded"
            ? html`<button class="btn-sm warning" @click=${() => this._override(b.id)}>
                ${msg("Override")} +${Math.round(b.overridePct * 100)}%
              </button>`
            : nothing}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Agent Budgets section
  // ---------------------------------------------------------------------------

  private _renderAgentSection(budgets: BudgetInfo[]) {
    return html`
      <section class="card">
        <div class="card-header">
          <span class="card-title">${msg("Agent Budgets")}</span>
          <button class="btn-sm accent" @click=${() => this._openCreateAgent()}>
            + ${msg("Add Budget")}
          </button>
        </div>
        ${budgets.length === 0
          ? html`<div class="empty">${msg("No agent budgets configured.")}</div>`
          : html`
              <table class="budget-table">
                <thead>
                  <tr>
                    <th>${msg("Agent")}</th>
                    <th>${msg("Period")}</th>
                    <th>${msg("Limit")}</th>
                    <th>${msg("Spent")}</th>
                    <th>${msg("Status")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${budgets.map((b) => {
                    const p = pct(b.spentUsd, b.limitUsd);
                    const status = statusLabel(
                      b.spentUsd,
                      b.limitUsd,
                      b.softAlertPct,
                      b.hardStopPct,
                    );
                    return html`
                      <tr>
                        <td class="mono">${b.scopeId}</td>
                        <td>${b.period}</td>
                        <td class="mono">${fmtUsd(b.limitUsd)}</td>
                        <td class="mono">${fmtUsd(b.spentUsd)} (${p}%)</td>
                        <td>
                          <div class="bar-track small">
                            <div
                              class="bar-fill"
                              style="width: ${Math.min(p, 100)}%; background: ${barColor(
                                p,
                                b.softAlertPct,
                                b.hardStopPct,
                              )}"
                            ></div>
                          </div>
                          <span class="status-${status}"
                            >${status === "warning"
                              ? "\u26a0\ufe0f"
                              : status === "exceeded"
                                ? "\ud83d\uded1"
                                : ""}</span
                          >
                        </td>
                        <td class="actions">
                          ${status === "exceeded"
                            ? html`<button
                                class="btn-sm warning"
                                @click=${() => this._override(b.id)}
                                title="Override"
                              >
                                O
                              </button>`
                            : nothing}
                          <button class="btn-sm" @click=${() => this._openEdit(b)}>
                            ${msg("Edit")}
                          </button>
                          <button class="btn-sm danger" @click=${() => this._delete(b.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
            `}
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Budget History section
  // ---------------------------------------------------------------------------

  private _renderEventLog() {
    return html`
      <section class="card">
        <div class="card-header">
          <span class="card-title">${msg("Budget History")}</span>
        </div>
        ${this._events.length === 0
          ? html`<div class="empty">${msg("No budget events yet.")}</div>`
          : html`
              <div class="event-list">
                ${this._events.slice(0, 20).map(
                  (e) => html`
                    <div class="event-row">
                      <span class="event-date">${e.createdAt.slice(5, 16)}</span>
                      <span class="event-icon">${EVENT_ICONS[e.eventType] ?? "?"}</span>
                      <span class="event-type">${e.eventType}</span>
                      <span class="event-scope">${e.scopeId ?? "instance"}</span>
                      <span class="event-msg mono"
                        >${e.message ?? `${fmtUsd(e.currentUsd)}/${fmtUsd(e.limitUsd)}`}</span
                      >
                    </div>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Dialog (create / edit)
  // ---------------------------------------------------------------------------

  private _renderDialog() {
    const isEdit = this._editId !== null;
    const isAgent = this._dialogScope === "agent";
    const title = isEdit
      ? isAgent
        ? msg("Edit Agent Budget")
        : msg("Edit Instance Budget")
      : isAgent
        ? msg("New Agent Budget")
        : msg("New Instance Budget");

    return html`
      <div class="dialog-backdrop" @click=${() => this._closeDialog()}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${title}</h3>

          ${!isEdit && isAgent
            ? html`
                <label>${msg("Agent")}</label>
                <select
                  .value=${this._formScopeId}
                  @change=${(e: Event) =>
                    (this._formScopeId = (e.target as HTMLSelectElement).value)}
                >
                  ${this._agentIds.map(
                    (id) =>
                      html`<option value=${id} ?selected=${this._formScopeId === id}>
                        ${id}
                      </option>`,
                  )}
                </select>
              `
            : nothing}
          ${!isEdit
            ? html`
                <label>${msg("Period")}</label>
                <div class="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="period"
                      value="monthly"
                      .checked=${this._formPeriod === "monthly"}
                      @change=${() => (this._formPeriod = "monthly")}
                    />
                    ${msg("Monthly")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="period"
                      value="lifetime"
                      .checked=${this._formPeriod === "lifetime"}
                      @change=${() => (this._formPeriod = "lifetime")}
                    />
                    ${msg("Lifetime")}
                  </label>
                </div>
              `
            : nothing}

          <label>${msg("Limit (USD)")}</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            .value=${this._formLimit}
            @input=${(e: Event) => (this._formLimit = (e.target as HTMLInputElement).value)}
          />

          <label>${msg("Alert threshold (%)")}</label>
          <input
            type="number"
            min="0"
            max="100"
            .value=${this._formSoftPct}
            @input=${(e: Event) => (this._formSoftPct = (e.target as HTMLInputElement).value)}
          />

          <label>${msg("Stop threshold (%)")}</label>
          <input
            type="number"
            min="0"
            max="200"
            .value=${this._formHardPct}
            @input=${(e: Event) => (this._formHardPct = (e.target as HTMLInputElement).value)}
          />

          <label>${msg("Override increase (%)")}</label>
          <input
            type="number"
            min="0"
            max="100"
            .value=${this._formOverridePct}
            @input=${(e: Event) => (this._formOverridePct = (e.target as HTMLInputElement).value)}
          />

          <div class="dialog-actions">
            <button class="btn-sm" @click=${() => this._closeDialog()}>${msg("Cancel")}</button>
            <button class="btn-sm accent" @click=${() => void this._submitDialog()}>
              ${isEdit ? msg("Save") : msg("Create Budget")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .center {
        text-align: center;
        padding: 32px;
        color: var(--text-secondary);
      }
      .error {
        color: var(--state-error);
      }
      .empty {
        padding: 16px;
        color: var(--text-muted);
        text-align: center;
      }
      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        margin-bottom: 16px;
        padding: 16px;
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .card-title {
        font-weight: 700;
        font-size: 14px;
        text-transform: uppercase;
        color: var(--text-muted);
        letter-spacing: 0.5px;
      }
      .card-actions {
        display: flex;
        gap: 6px;
      }
      .budget-card {
        padding: 4px 0;
      }
      .budget-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .budget-period {
        font-size: 12px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .budget-details {
        color: var(--text-secondary);
        font-size: 13px;
        margin-bottom: 8px;
      }
      .budget-spent {
        font-family: var(--font-mono);
        font-size: 15px;
        color: var(--text-primary);
        margin-bottom: 8px;
      }
      .budget-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 8px;
      }
      .bar-track {
        width: 100%;
        height: 8px;
        background: var(--bg-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .bar-track.small {
        display: inline-block;
        width: 80px;
        height: 6px;
        vertical-align: middle;
        margin-right: 4px;
      }
      .bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.3s;
      }
      .mono {
        font-family: var(--font-mono);
      }
      .budget-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .budget-table th {
        text-align: left;
        color: var(--text-muted);
        font-size: 11px;
        text-transform: uppercase;
        padding: 4px 8px;
        border-bottom: 1px solid var(--bg-border);
      }
      .budget-table td {
        padding: 8px;
        border-bottom: 1px solid var(--bg-border);
        color: var(--text-secondary);
      }
      .actions {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
      }
      .status-ok {
        color: var(--state-running);
      }
      .status-warning {
        color: var(--state-warning);
      }
      .status-exceeded {
        color: var(--state-error);
      }
      .event-list {
        max-height: 300px;
        overflow-y: auto;
      }
      .event-row {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
      }
      .event-date {
        color: var(--text-muted);
        font-family: var(--font-mono);
        min-width: 90px;
      }
      .event-icon {
        min-width: 20px;
      }
      .event-type {
        min-width: 80px;
        color: var(--text-secondary);
      }
      .event-scope {
        min-width: 80px;
        color: var(--text-muted);
      }
      .event-msg {
        color: var(--text-secondary);
        font-size: 11px;
      }
      /* Buttons */
      .btn-sm {
        padding: 4px 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 12px;
      }
      .btn-sm:hover {
        background: var(--bg-hover);
      }
      .btn-sm.accent {
        border-color: var(--accent-border);
        color: var(--accent);
      }
      .btn-sm.accent:hover {
        background: var(--accent-subtle);
      }
      .btn-sm.warning {
        border-color: var(--state-warning);
        color: var(--state-warning);
      }
      .btn-sm.danger {
        color: var(--state-error);
      }
      .btn-sm.danger:hover {
        background: rgba(239, 68, 68, 0.1);
      }
      /* Dialog */
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
        max-width: 480px;
        width: 90%;
      }
      .dialog h3 {
        margin: 0 0 16px;
        font-size: 16px;
        color: var(--text-primary);
      }
      .dialog label {
        display: block;
        font-size: 12px;
        color: var(--text-muted);
        margin: 10px 0 4px;
      }
      .dialog input[type="text"],
      .dialog input[type="number"],
      .dialog select {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 13px;
        box-sizing: border-box;
      }
      .radio-group {
        display: flex;
        gap: 16px;
        margin: 4px 0;
      }
      .radio-group label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 20px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-budget-settings": CpBudgetSettings;
  }
}
