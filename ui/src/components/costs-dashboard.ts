// ui/src/components/costs-dashboard.ts
// Cost Dashboard — per-instance token/cost analytics.

import { LitElement, html, css, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { fetchCostSummary, fetchDailyCosts, fetchCostsByAgent, fetchCostsByModel } from "../api.js";
import type { CostSummary, DailyCost, AgentCost, ModelCost } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Period = "7d" | "30d" | "all";

const MODEL_COLORS: Record<string, string> = {
  "claude-opus-4-6": "#a78bfa",
  "claude-sonnet-4-6": "#60a5fa",
  "claude-haiku-4-5": "#34d399",
  "claude-opus-4-5": "#c084fc",
  "claude-sonnet-4-5": "#38bdf8",
};
const DEFAULT_MODEL_COLOR = "#94a3b8";

function modelColor(model: string): string {
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (model.includes(key)) return color;
  }
  return DEFAULT_MODEL_COLOR;
}

function fmtUsd(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v === 0) return "$0.00";
  return `$${v.toFixed(4)}`;
}

function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

type SortField = "agentId" | "tokensIn" | "tokensOut" | "costUsd" | "messageCount";

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-costs-dashboard")
export class CostsDashboard extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1200px;
        margin: 0 auto;
      }

      /* ── Header ─────────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-6);
        flex-wrap: wrap;
      }

      .btn-back {
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px 10px;
        font-size: 13px;
        font-family: inherit;
        transition:
          border-color 0.15s,
          color 0.15s;
      }

      .btn-back:hover {
        border-color: var(--accent);
        color: var(--accent);
      }

      .title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }

      .period-selector {
        display: flex;
        gap: 2px;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 2px;
      }

      .period-btn {
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 4px 12px;
        font-family: inherit;
        transition:
          background 0.15s,
          color 0.15s;
      }

      .period-btn:hover {
        color: var(--text-primary);
      }

      .period-btn.active {
        background: var(--accent);
        color: #fff;
      }

      /* ── Summary cards ──────────────────────────────────────────── */

      .summary-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--space-4);
        margin-bottom: var(--space-6);
      }

      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
      }

      .card-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: var(--space-1);
      }

      .card-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-primary);
        font-family: var(--font-mono);
      }

      /* ── Chart ──────────────────────────────────────────────────── */

      .chart-section {
        margin-bottom: var(--space-6);
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: var(--space-3);
      }

      .chart-card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        overflow-x: auto;
      }

      /* ── Two columns ────────────────────────────────────────────── */

      .two-cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
      }

      @media (max-width: 800px) {
        .two-cols {
          grid-template-columns: 1fr;
        }
      }

      /* ── Table ──────────────────────────────────────────────────── */

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      th {
        text-align: left;
        padding: var(--space-2) var(--space-3);
        color: var(--text-muted);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border-bottom: 1px solid var(--bg-border);
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }

      th:hover {
        color: var(--text-secondary);
      }

      th.sorted {
        color: var(--accent);
      }

      td {
        padding: var(--space-2) var(--space-3);
        color: var(--text-primary);
        border-bottom: 1px solid var(--bg-border);
        font-family: var(--font-mono);
        font-size: 12px;
      }

      td:first-child {
        font-family: var(--font-ui);
        color: var(--text-secondary);
        font-weight: 500;
      }

      tr:last-child td {
        border-bottom: none;
      }

      /* ── Donut ──────────────────────────────────────────────────── */

      .donut-wrapper {
        display: flex;
        align-items: center;
        gap: var(--space-6);
        justify-content: center;
        flex-wrap: wrap;
        padding: var(--space-4) 0;
      }

      .legend {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 12px;
        color: var(--text-secondary);
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .legend-value {
        font-family: var(--font-mono);
        color: var(--text-muted);
        font-size: 11px;
        margin-left: auto;
        padding-left: var(--space-4);
      }

      /* ── States ─────────────────────────────────────────────────── */

      .loading,
      .error,
      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 300px;
        color: var(--text-muted);
        font-size: 14px;
      }

      .error {
        color: var(--state-error);
      }
    `,
  ];

  @property({ type: String }) slug = "";

  @state() private _period: Period = "7d";
  @state() private _summary: CostSummary | null = null;
  @state() private _daily: DailyCost[] = [];
  @state() private _byAgent: AgentCost[] = [];
  @state() private _byModel: ModelCost[] = [];
  @state() private _loading = true;
  @state() private _error: string | null = null;
  @state() private _sortField: SortField = "costUsd";
  @state() private _sortAsc = false;

  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._refreshTimer = setInterval(() => void this._loadData(), AUTO_REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") || changed.has("_period")) {
      void this._loadData();
    }
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  private async _loadData(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = null;
    try {
      const [summary, daily, byAgent, byModel] = await Promise.all([
        fetchCostSummary(this.slug, this._period),
        fetchDailyCosts(this.slug, this._period),
        fetchCostsByAgent(this.slug, this._period),
        fetchCostsByModel(this.slug, this._period),
      ]);
      this._summary = summary;
      this._daily = daily;
      this._byAgent = byAgent;
      this._byModel = byModel;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load costs";
    }
    this._loading = false;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", { detail: { view: "cluster" }, bubbles: true, composed: true }),
    );
  }

  private _setPeriod(p: Period): void {
    this._period = p;
  }

  private _toggleSort(field: SortField): void {
    if (this._sortField === field) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortField = field;
      this._sortAsc = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  private _renderSummaryCards() {
    const s = this._summary;
    if (!s) return nothing;
    const totalTokens = s.totalTokensIn + s.totalTokensOut;
    return html`
      <div class="summary-row">
        <div class="card">
          <div class="card-label">${msg("Total Cost", { id: "costs-total-cost" })}</div>
          <div class="card-value">${fmtUsd(s.totalCostUsd)}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Total Tokens", { id: "costs-total-tokens" })}</div>
          <div class="card-value">${fmtTokens(totalTokens)}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Tokens In", { id: "costs-tokens-in" })}</div>
          <div class="card-value">${fmtTokens(s.totalTokensIn)}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Messages", { id: "costs-messages" })}</div>
          <div class="card-value">${s.messageCount}</div>
        </div>
      </div>
    `;
  }

  private _renderDailyChart() {
    if (this._daily.length === 0) {
      return html`<div class="chart-card">
        <div class="empty">${msg("No data for this period", { id: "costs-no-data" })}</div>
      </div>`;
    }

    // 1. Aggregate by day, then stack models
    const dayMap = new Map<string, Map<string, number>>();
    const models = new Set<string>();
    for (const row of this._daily) {
      models.add(row.model);
      if (!dayMap.has(row.day)) dayMap.set(row.day, new Map());
      const m = dayMap.get(row.day)!;
      m.set(row.model, (m.get(row.model) ?? 0) + row.costUsd);
    }

    const days = [...dayMap.keys()].sort();
    const modelList = [...models];

    // 2. Find max daily total for Y scale
    let maxTotal = 0;
    for (const dm of dayMap.values()) {
      let total = 0;
      for (const v of dm.values()) total += v;
      if (total > maxTotal) maxTotal = total;
    }
    if (maxTotal === 0) maxTotal = 1;

    // 3. SVG dimensions
    const barWidth = 24;
    const gap = 8;
    const chartWidth = Math.max(days.length * (barWidth + gap), 200);
    const chartHeight = 160;
    const paddingLeft = 50;
    const paddingBottom = 30;
    const svgWidth = chartWidth + paddingLeft + 10;
    const svgHeight = chartHeight + paddingBottom + 10;

    // 4. Y axis ticks (3 ticks)
    const yTicks = [0, maxTotal / 2, maxTotal];

    return html`
      <div class="chart-card">
        <svg width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="max-width:${svgWidth}px">
          <!-- Y axis labels -->
          ${yTicks.map(
            (tick) => svg`
              <text
                x="${paddingLeft - 6}"
                y="${10 + chartHeight - (tick / maxTotal) * chartHeight}"
                fill="var(--text-muted)"
                font-size="10"
                text-anchor="end"
                dominant-baseline="middle"
                font-family="var(--font-mono)"
              >${fmtUsd(tick)}</text>
              <line
                x1="${paddingLeft}"
                y1="${10 + chartHeight - (tick / maxTotal) * chartHeight}"
                x2="${svgWidth - 10}"
                y2="${10 + chartHeight - (tick / maxTotal) * chartHeight}"
                stroke="var(--bg-border)"
                stroke-dasharray="3,3"
              />
            `,
          )}

          <!-- Bars -->
          ${days.map((day, i) => {
            const dm = dayMap.get(day)!;
            const x = paddingLeft + i * (barWidth + gap);
            let yOffset = 0;
            return svg`
              <g>
                ${modelList.map((model) => {
                  const val = dm.get(model) ?? 0;
                  const h = (val / maxTotal) * chartHeight;
                  const y = 10 + chartHeight - yOffset - h;
                  yOffset += h;
                  return svg`
                    <rect
                      x="${x}"
                      y="${y}"
                      width="${barWidth}"
                      height="${Math.max(h, 0)}"
                      rx="2"
                      fill="${modelColor(model)}"
                      opacity="0.85"
                    >
                      <title>${model}: ${fmtUsd(val)}</title>
                    </rect>
                  `;
                })}
                <!-- Day label -->
                <text
                  x="${x + barWidth / 2}"
                  y="${10 + chartHeight + 16}"
                  fill="var(--text-muted)"
                  font-size="9"
                  text-anchor="middle"
                  font-family="var(--font-mono)"
                >${day.slice(5)}</text>
              </g>
            `;
          })}
        </svg>
      </div>
    `;
  }

  private _renderAgentTable() {
    if (this._byAgent.length === 0) {
      return html`<div class="chart-card">
        <div class="empty">${msg("No agent data", { id: "costs-no-agent" })}</div>
      </div>`;
    }

    const totalCost = this._byAgent.reduce((acc, a) => acc + a.costUsd, 0);
    const sorted = [...this._byAgent].sort((a, b) => {
      const va = a[this._sortField as keyof AgentCost];
      const vb = b[this._sortField as keyof AgentCost];
      if (typeof va === "number" && typeof vb === "number") {
        return this._sortAsc ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return this._sortAsc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });

    const sortIcon = (f: SortField) =>
      this._sortField === f ? (this._sortAsc ? " \u25B2" : " \u25BC") : "";

    return html`
      <div class="chart-card">
        <table>
          <thead>
            <tr>
              <th
                class="${this._sortField === "agentId" ? "sorted" : ""}"
                @click=${() => this._toggleSort("agentId")}
              >
                ${msg("Agent", { id: "costs-agent" })}${sortIcon("agentId")}
              </th>
              <th
                class="${this._sortField === "tokensIn" ? "sorted" : ""}"
                @click=${() => this._toggleSort("tokensIn")}
              >
                ${msg("In", { id: "costs-in" })}${sortIcon("tokensIn")}
              </th>
              <th
                class="${this._sortField === "tokensOut" ? "sorted" : ""}"
                @click=${() => this._toggleSort("tokensOut")}
              >
                ${msg("Out", { id: "costs-out" })}${sortIcon("tokensOut")}
              </th>
              <th
                class="${this._sortField === "costUsd" ? "sorted" : ""}"
                @click=${() => this._toggleSort("costUsd")}
              >
                ${msg("Cost", { id: "costs-cost" })}${sortIcon("costUsd")}
              </th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(
              (a) => html`
                <tr>
                  <td>${a.agentId}</td>
                  <td>${fmtTokens(a.tokensIn)}</td>
                  <td>${fmtTokens(a.tokensOut)}</td>
                  <td>${fmtUsd(a.costUsd)}</td>
                  <td>${totalCost > 0 ? ((a.costUsd / totalCost) * 100).toFixed(1) : "0"}%</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderModelDonut() {
    if (this._byModel.length === 0) {
      return html`<div class="chart-card">
        <div class="empty">${msg("No model data", { id: "costs-no-model" })}</div>
      </div>`;
    }

    const totalTokens = this._byModel.reduce((acc, m) => acc + m.tokensIn + m.tokensOut, 0);
    if (totalTokens === 0) {
      return html`<div class="chart-card">
        <div class="empty">${msg("No token data", { id: "costs-no-tokens" })}</div>
      </div>`;
    }

    // SVG donut via stroke-dasharray
    const r = 60;
    const circumference = 2 * Math.PI * r;
    let offsetSoFar = 0;

    const segments = this._byModel.map((m) => {
      const tokens = m.tokensIn + m.tokensOut;
      const pct = tokens / totalTokens;
      const dash = pct * circumference;
      const offset = offsetSoFar;
      offsetSoFar += dash;
      return { model: m.model, pct, dash, offset, color: modelColor(m.model), costUsd: m.costUsd };
    });

    return html`
      <div class="chart-card">
        <div class="donut-wrapper">
          <svg width="160" height="160" viewBox="0 0 160 160">
            ${segments.map(
              (s) => svg`
                <circle
                  cx="80"
                  cy="80"
                  r="${r}"
                  fill="none"
                  stroke="${s.color}"
                  stroke-width="20"
                  stroke-dasharray="${s.dash} ${circumference - s.dash}"
                  stroke-dashoffset="${-s.offset}"
                  transform="rotate(-90 80 80)"
                  opacity="0.85"
                >
                  <title>${s.model}: ${(s.pct * 100).toFixed(1)}%</title>
                </circle>
              `,
            )}
          </svg>
          <div class="legend">
            ${segments.map(
              (s) => html`
                <div class="legend-item">
                  <span class="legend-dot" style="background:${s.color}"></span>
                  <span>${s.model}</span>
                  <span class="legend-value"
                    >${(s.pct * 100).toFixed(1)}% · ${fmtUsd(s.costUsd)}</span
                  >
                </div>
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    if (this._loading && !this._summary) {
      return html`<div class="loading">
        ${msg("Loading costs\u2026", { id: "costs-loading" })}
      </div>`;
    }

    if (this._error) {
      return html`<div class="error">${this._error}</div>`;
    }

    const periods: Period[] = ["7d", "30d", "all"];

    return html`
      <div class="header">
        <button class="btn-back" @click=${this._goBack}>
          ← ${msg("Back", { id: "costs-back" })}
        </button>
        <div class="title">${msg("Costs", { id: "costs-title" })} — ${this.slug}</div>
        <div class="period-selector">
          ${periods.map(
            (p) => html`
              <button
                class="period-btn ${this._period === p ? "active" : ""}"
                @click=${() => this._setPeriod(p)}
              >
                ${p === "all" ? msg("All", { id: "costs-period-all" }) : p}
              </button>
            `,
          )}
        </div>
      </div>

      ${this._renderSummaryCards()}

      <div class="chart-section">
        <div class="section-title">${msg("Daily Costs", { id: "costs-daily" })}</div>
        ${this._renderDailyChart()}
      </div>

      <div class="two-cols">
        <div class="chart-section">
          <div class="section-title">${msg("By Agent", { id: "costs-by-agent" })}</div>
          ${this._renderAgentTable()}
        </div>
        <div class="chart-section">
          <div class="section-title">${msg("By Model", { id: "costs-by-model" })}</div>
          ${this._renderModelDonut()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-costs-dashboard": CostsDashboard;
  }
}
