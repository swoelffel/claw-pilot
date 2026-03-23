// ui/src/components/heartbeat-heatmap.ts
// Heartbeat Heatmap — consolidated view of all agents' heartbeat ticks.

import { LitElement, html, css, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { fetchHeartbeatSchedule, fetchHeartbeatHeatmap } from "../api.js";
import type { HeartbeatScheduleAgent, HeartbeatHourBucket, HeartbeatAgentStats } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Days = 7 | 14 | 30;

const CELL = 18;
const GAP = 2;
const STEP = CELL + GAP;
const Y_LABEL_W = 32;
const X_LABEL_H = 24;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a given hour falls within activeHours (handles midnight crossing). */
function isHourActive(hour: number, ah?: { start: string; end: string }): boolean {
  if (!ah) return true;
  const s = parseInt(ah.start.split(":")[0]!, 10);
  const e = parseInt(ah.end.split(":")[0]!, 10);
  if (s <= e) return hour >= s && hour < e;
  return hour >= s || hour < e; // midnight crossing
}

/** Build a lookup key for buckets. */
function bucketKey(day: string, hour: number): string {
  return `${day}:${hour}`;
}

/** Format a short date label (e.g., "Mar23"). */
function shortDate(isoDay: string): string {
  const d = new Date(isoDay + "T00:00:00");
  const month = d.toLocaleString("en", { month: "short" });
  return `${month}${d.getDate()}`;
}

/** Generate an array of ISO day strings for the last N days. */
function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Format relative time (e.g., "2h ago"). */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-heartbeat-heatmap")
export class HeartbeatHeatmap extends LitElement {
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
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: var(--space-1);
      }

      .card-value {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }

      .card-value.green {
        color: var(--state-running);
      }

      .card-value.amber {
        color: var(--state-warning);
      }

      /* ── Agent section ──────────────────────────────────────────── */

      .agent-section {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        margin-bottom: var(--space-4);
      }

      .agent-header {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
        margin-bottom: var(--space-3);
        flex-wrap: wrap;
      }

      .agent-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
      }

      .agent-config {
        font-size: 12px;
        color: var(--text-muted);
      }

      .agent-stats {
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: var(--space-3);
      }

      .agent-stats span {
        margin-right: var(--space-3);
      }

      /* ── Heatmap grid ───────────────────────────────────────────── */

      .heatmap-wrap {
        overflow-x: auto;
      }

      .heatmap-wrap svg {
        display: block;
      }

      /* ── Legend ──────────────────────────────────────────────────── */

      .legend {
        display: flex;
        gap: var(--space-4);
        margin-top: var(--space-3);
        font-size: 11px;
        color: var(--text-muted);
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        display: inline-block;
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

  @state() private _period: Days = 7;
  @state() private _schedule: HeartbeatScheduleAgent[] = [];
  @state() private _buckets: HeartbeatHourBucket[] = [];
  @state() private _stats: HeartbeatAgentStats[] = [];
  @state() private _loading = true;
  @state() private _error: string | null = null;

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
      const [scheduleRes, heatmapRes] = await Promise.all([
        fetchHeartbeatSchedule(this.slug),
        fetchHeartbeatHeatmap(this.slug, this._period),
      ]);
      this._schedule = scheduleRes.agents;
      this._buckets = heatmapRes.buckets;
      this._stats = heatmapRes.stats;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "Failed to load heartbeat data";
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

  private _setPeriod(p: Days): void {
    this._period = p;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      ${this._renderHeader()}
      ${this._loading
        ? html`<div class="loading">${msg("Loading…", { id: "hb-loading" })}</div>`
        : this._error
          ? html`<div class="error">${this._error}</div>`
          : this._schedule.length === 0 && this._stats.length === 0
            ? html`<div class="empty">
                ${msg("No heartbeat configured for this instance", { id: "hb-empty" })}
              </div>`
            : this._renderContent()}
    `;
  }

  private _renderHeader() {
    const periods: Days[] = [7, 14, 30];
    return html`
      <div class="header">
        <button class="btn-back" @click=${this._goBack}>← ${msg("Back", { id: "hb-back" })}</button>
        <div class="title">${msg("Heartbeat Heatmap", { id: "hb-title" })}</div>
        <div class="period-selector">
          ${periods.map(
            (p) => html`
              <button
                class="period-btn ${this._period === p ? "active" : ""}"
                @click=${() => this._setPeriod(p)}
              >
                ${p}d
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _renderContent() {
    const totalTicks = this._stats.reduce((s, a) => s + a.totalTicks, 0);
    const totalAlerts = this._stats.reduce((s, a) => s + a.totalAlerts, 0);
    const uptime = totalTicks > 0 ? ((totalTicks - totalAlerts) / totalTicks) * 100 : 100;

    // Merge schedule agents with stats agents (some agents may have ticks but no schedule)
    const agentIds = new Set<string>();
    for (const a of this._schedule) agentIds.add(a.agentId);
    for (const a of this._stats) agentIds.add(a.agentId);
    const sortedAgents = [...agentIds].sort();

    return html`
      ${this._renderSummary(sortedAgents.length, totalTicks, totalAlerts, uptime)}
      ${sortedAgents.map((id) => this._renderAgent(id))}
    `;
  }

  private _renderSummary(agents: number, ticks: number, alerts: number, uptime: number) {
    return html`
      <div class="summary-row">
        <div class="card">
          <div class="card-label">${msg("Active Agents", { id: "hb-agents" })}</div>
          <div class="card-value">${agents}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Total Ticks", { id: "hb-ticks" })}</div>
          <div class="card-value">${ticks.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Alerts", { id: "hb-alerts" })}</div>
          <div class="card-value ${alerts > 0 ? "amber" : ""}">${alerts}</div>
        </div>
        <div class="card">
          <div class="card-label">${msg("Uptime", { id: "hb-uptime" })}</div>
          <div class="card-value green">${uptime.toFixed(1)}%</div>
        </div>
      </div>
    `;
  }

  private _renderAgent(agentId: string) {
    const schedule = this._schedule.find((a) => a.agentId === agentId);
    const stats = this._stats.find((a) => a.agentId === agentId);
    const agentBuckets = this._buckets.filter((b) => b.agentId === agentId);

    // Build bucket lookup
    const lookup = new Map<string, HeartbeatHourBucket>();
    for (const b of agentBuckets) lookup.set(bucketKey(b.day, b.hour), b);

    const days = lastNDays(this._period);

    // Config label
    const configParts: string[] = [];
    if (schedule?.every) configParts.push(`every ${schedule.every}`);
    if (schedule?.activeHours) {
      const ah = schedule.activeHours;
      configParts.push(`${ah.start}–${ah.end}`);
      if (ah.tz) configParts.push(ah.tz);
    } else if (schedule) {
      configParts.push("always active");
    }

    return html`
      <div class="agent-section">
        <div class="agent-header">
          <span class="agent-name">${agentId}</span>
          ${configParts.length > 0
            ? html`<span class="agent-config">(${configParts.join(" · ")})</span>`
            : nothing}
        </div>
        ${stats
          ? html`<div class="agent-stats">
              <span>${msg("Ticks", { id: "hb-stat-ticks" })}: ${stats.totalTicks}</span>
              <span>${msg("Alerts", { id: "hb-stat-alerts" })}: ${stats.totalAlerts}</span>
              ${stats.lastTick
                ? html`<span
                    >${msg("Last", { id: "hb-stat-last" })}: ${timeAgo(stats.lastTick)}</span
                  >`
                : nothing}
            </div>`
          : nothing}
        <div class="heatmap-wrap">${this._renderHeatmap(days, lookup, schedule)}</div>
        <div class="legend">
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--state-running)"></span>
            ${msg("OK", { id: "hb-legend-ok" })}
          </span>
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--state-warning)"></span>
            ${msg("Alert", { id: "hb-legend-alert" })}
          </span>
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--state-error)"></span>
            ${msg("Missing", { id: "hb-legend-missing" })}
          </span>
          <span class="legend-item">
            <span class="legend-dot" style="background: var(--bg-border)"></span>
            ${msg("Inactive", { id: "hb-legend-inactive" })}
          </span>
        </div>
      </div>
    `;
  }

  private _renderHeatmap(
    days: string[],
    lookup: Map<string, HeartbeatHourBucket>,
    schedule?: HeartbeatScheduleAgent,
  ) {
    const svgW = Y_LABEL_W + days.length * STEP;
    const svgH = 24 * STEP + X_LABEL_H;

    return svg`
      <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
        ${/* Y-axis labels (hours) */ ""}
        ${Array.from({ length: 24 }, (_, h) => {
          const y = h * STEP;
          return svg`<text
            x="${Y_LABEL_W - 4}"
            y="${y + CELL / 2 + 4}"
            text-anchor="end"
            fill="var(--text-muted)"
            font-size="10"
            font-family="var(--font-mono)"
          >${String(h).padStart(2, "0")}</text>`;
        })}

        ${/* X-axis labels (dates) */ ""}
        ${days.map((day, col) => {
          const x = Y_LABEL_W + col * STEP + CELL / 2;
          return svg`<text
            x="${x}"
            y="${24 * STEP + 14}"
            text-anchor="middle"
            fill="var(--text-muted)"
            font-size="9"
            font-family="var(--font-mono)"
          >${shortDate(day)}</text>`;
        })}

        ${/* Grid cells */ ""}
        ${days.flatMap((day, col) =>
          Array.from({ length: 24 }, (_, hour) => {
            const x = Y_LABEL_W + col * STEP;
            const y = hour * STEP;
            const active = isHourActive(hour, schedule?.activeHours);
            const bucket = lookup.get(bucketKey(day, hour));
            const fill = this._cellColor(bucket, active);

            // Tooltip text
            const tip = active
              ? bucket && bucket.tickCount > 0
                ? `${day} ${String(hour).padStart(2, "0")}:00 — ${bucket.tickCount} tick${bucket.tickCount > 1 ? "s" : ""}${bucket.alertCount > 0 ? `, ${bucket.alertCount} alert${bucket.alertCount > 1 ? "s" : ""}` : ""}`
                : `${day} ${String(hour).padStart(2, "0")}:00 — no ticks`
              : `${day} ${String(hour).padStart(2, "0")}:00 — inactive`;

            return svg`<rect
              x="${x}" y="${y}"
              width="${CELL}" height="${CELL}"
              rx="3" ry="3"
              fill="${fill}"
              opacity="${active ? 1 : 0.3}"
            ><title>${tip}</title></rect>`;
          }),
        )}
      </svg>
    `;
  }

  private _cellColor(bucket: HeartbeatHourBucket | undefined, active: boolean): string {
    if (!active) return "var(--bg-border)";
    if (!bucket || bucket.tickCount === 0) return "var(--state-error)";
    if (bucket.alertCount > 0) return "var(--state-warning)";
    return "var(--state-running)";
  }
}
