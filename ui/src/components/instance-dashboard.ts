// ui/src/components/instance-dashboard.ts
// Instance Dashboard — overview page with KPIs, agents, tasks, costs widgets.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles } from "../styles/shared.js";
import { fetchCostSummary, fetchDailyCosts, fetchBuilderData, fetchTasks } from "../api.js";
import type { InstanceInfo, CostSummary, DailyCost, AgentBuilderInfo, TaskInfo } from "../types.js";
import "./dashboard-pilot.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Period = "7d" | "30d" | "all";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Map archetype to a stripe color. */
function archetypeColor(archetype: string | null): string {
  switch (archetype) {
    case "planner":
      return "#a78bfa";
    case "generator":
      return "#60a5fa";
    case "evaluator":
      return "#f59e0b";
    case "orchestrator":
      return "#f472b6";
    case "analyst":
      return "#34d399";
    case "communicator":
      return "#fb923c";
    default:
      return "#64748b";
  }
}

/** State dot color. */
function stateColor(s: string | undefined): string {
  switch (s) {
    case "running":
      return "var(--state-running)";
    case "error":
      return "var(--state-error)";
    case "stopped":
      return "var(--state-warning)";
    default:
      return "var(--text-muted)";
  }
}

// ---------------------------------------------------------------------------
// Widget error tracking
// ---------------------------------------------------------------------------

type WidgetKey = "agents" | "tasks" | "costs" | "dailyCosts";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-instance-dashboard")
export class InstanceDashboard extends LitElement {
  static override styles = [
    tokenStyles,
    badgeStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1400px;
        margin: 0 auto;
      }

      /* ── Header ──────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-5);
        flex-wrap: wrap;
      }

      .btn-back {
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        padding: 6px 10px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.15s;
      }
      .btn-back:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .header-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }

      .state-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
      }

      .period-selector {
        margin-left: auto;
        display: flex;
        gap: 2px;
        background: var(--bg-base);
        border-radius: var(--radius-sm);
        padding: 2px;
      }
      .period-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.15s;
        font-family: var(--font-ui);
      }
      .period-btn:hover {
        color: var(--text-secondary);
      }
      .period-btn.active {
        background: var(--accent);
        color: #fff;
      }

      /* ── KPI Bar ─────────────────────────────────────────────── */

      .kpi-bar {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-5);
        overflow-x: auto;
        padding-bottom: var(--space-1);
      }

      .kpi-pill {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 6px 12px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .kpi-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
      }
      .kpi-value {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        font-family: var(--font-mono);
      }
      .kpi-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      /* ── Layout ──────────────────────────────────────────────── */

      .dash-layout {
        display: grid;
        grid-template-columns: 1fr 340px;
        gap: var(--space-5);
        align-items: start;
      }

      .dash-main {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .dash-sidebar {
        position: sticky;
        top: var(--space-4);
      }

      .widget-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
      }

      /* ── Widget base ─────────────────────────────────────────── */

      .widget {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        padding: var(--space-3);
      }

      .widget-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-3);
      }
      .widget-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
      }
      .widget-link {
        font-size: 12px;
        color: var(--text-muted);
        text-decoration: none;
        cursor: pointer;
        transition: color 0.15s;
      }
      .widget-link:hover {
        color: var(--accent);
      }

      .widget-error {
        color: var(--state-error);
        font-size: 12px;
        padding: var(--space-2);
      }

      .widget-empty {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        padding: var(--space-4) 0;
      }

      /* ── Agents Widget ───────────────────────────────────────── */

      .agent-row {
        display: grid;
        grid-template-columns: 4px 1fr auto auto;
        gap: var(--space-2);
        align-items: center;
        padding: var(--space-2) 0;
        border-bottom: 1px solid var(--bg-border);
      }
      .agent-row:last-child {
        border-bottom: none;
      }

      .agent-stripe {
        width: 4px;
        height: 28px;
        border-radius: 2px;
      }

      .agent-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .agent-role {
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 150px;
      }

      .agent-model {
        font-size: 11px;
        color: var(--text-secondary);
        font-family: var(--font-mono);
      }

      .agent-more {
        font-size: 12px;
        color: var(--text-muted);
        padding: var(--space-2) 0;
        cursor: pointer;
      }
      .agent-more:hover {
        color: var(--accent);
      }

      /* ── Tasks Widget ────────────────────────────────────────── */

      .tasks-counters {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .task-counter {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 13px;
      }
      .task-counter-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .task-counter-label {
        color: var(--text-secondary);
        flex: 1;
      }
      .task-counter-value {
        font-weight: 700;
        font-family: var(--font-mono);
        color: var(--text-primary);
      }

      /* ── Costs Widget ────────────────────────────────────────── */

      .costs-sparkline {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 48px;
        margin-bottom: var(--space-3);
      }
      .spark-bar {
        flex: 1;
        background: var(--accent);
        border-radius: 2px 2px 0 0;
        min-height: 2px;
        opacity: 0.7;
        transition: opacity 0.15s;
      }
      .spark-bar:hover {
        opacity: 1;
      }

      .costs-totals {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .cost-total {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary);
        font-family: var(--font-mono);
      }
      .cost-tokens {
        font-size: 12px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }

      /* ── Responsive ──────────────────────────────────────────── */

      @media (max-width: 900px) {
        .dash-layout {
          grid-template-columns: 1fr;
        }
        .dash-sidebar {
          position: static;
          height: 300px;
        }
      }

      @media (max-width: 700px) {
        .kpi-bar {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
      }

      @media (max-width: 600px) {
        .widget-grid-2 {
          grid-template-columns: 1fr;
        }
        .agent-row {
          grid-template-columns: 4px 1fr;
        }
        .agent-role,
        .agent-model {
          display: none;
        }
      }
    `,
  ];

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  @property({ type: String }) slug = "";

  @state() private _period: Period = "7d";
  @state() private _instance: InstanceInfo | null = null;
  @state() private _agents: AgentBuilderInfo[] = [];
  @state() private _tasks: TaskInfo[] = [];
  @state() private _costSummary: CostSummary | null = null;
  @state() private _dailyCosts: DailyCost[] = [];
  @state() private _widgetErrors: Partial<Record<WidgetKey, string>> = {};

  private _wsHandler: ((e: Event) => void) | null = null;
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();

    // 1. Listen to WS health updates
    this._wsHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        type: string;
        payload: { instances?: Array<Partial<InstanceInfo> & { slug: string }> };
      };
      if (detail?.type === "health_update" && detail.payload?.instances) {
        const match = detail.payload.instances.find((i) => i.slug === this.slug);
        if (match) {
          this._instance = {
            ...(this._instance ?? ({} as InstanceInfo)),
            ...match,
          } as InstanceInfo;
        }
      }
    };
    window.addEventListener("cp-ws-message", this._wsHandler);

    // 2. Load data
    void this._loadAll();

    // 3. Auto-refresh non-WS data
    this._refreshTimer = setInterval(() => {
      void this._loadAll();
    }, AUTO_REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._wsHandler) {
      window.removeEventListener("cp-ws-message", this._wsHandler);
      this._wsHandler = null;
    }
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") || changed.has("_period")) {
      void this._loadAll();
    }
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  private async _loadAll(): Promise<void> {
    if (!this.slug) return;

    const errors: Partial<Record<WidgetKey, string>> = {};

    const results = await Promise.allSettled([
      fetchBuilderData(this.slug),
      fetchTasks(this.slug),
      fetchCostSummary(this.slug, this._period),
      fetchDailyCosts(this.slug, this._period),
    ]);

    // 0. Agents (from builder data)
    if (results[0].status === "fulfilled") {
      this._agents = results[0].value.agents;
    } else {
      errors.agents = String((results[0] as PromiseRejectedResult).reason);
    }

    // 1. Tasks
    if (results[1].status === "fulfilled") {
      this._tasks = results[1].value;
    } else {
      errors.tasks = String((results[1] as PromiseRejectedResult).reason);
    }

    // 2. Cost summary
    if (results[2].status === "fulfilled") {
      this._costSummary = results[2].value;
    } else {
      errors.costs = String((results[2] as PromiseRejectedResult).reason);
    }

    // 3. Daily costs (sparkline)
    if (results[3].status === "fulfilled") {
      this._dailyCosts = results[3].value;
    } else {
      errors.dailyCosts = String((results[3] as PromiseRejectedResult).reason);
    }

    this._widgetErrors = errors;
  }

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  private _navigate(view: string, extra?: Record<string, unknown>): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view, slug: this.slug, ...extra },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  override render() {
    return html`
      ${this._renderHeader()} ${this._renderKpiBar()}
      <div class="dash-layout">
        <div class="dash-main">
          ${this._renderAgentsWidget()}
          <div class="widget-grid-2">${this._renderTasksWidget()} ${this._renderCostsWidget()}</div>
          <!-- More widgets will be added in future tasks -->
        </div>
        <div class="dash-sidebar">
          <cp-dashboard-pilot .slug=${this.slug}></cp-dashboard-pilot>
        </div>
      </div>
    `;
  }

  // ── Header ──────────────────────────────────────────────────

  private _renderHeader() {
    const instanceState = this._instance?.state;
    return html`
      <div class="header">
        <button
          class="btn-back"
          @click=${() => this._navigate("cluster")}
          title=${msg("Back to cluster", { id: "dashboard-back-cluster" })}
        >
          ← ${msg("Cluster", { id: "dashboard-cluster-label" })}
        </button>
        <div class="header-title">
          <span class="state-dot" style="background: ${stateColor(instanceState)}"></span>
          ${msg("Dashboard", { id: "dashboard-title" })} — ${this.slug}
        </div>
        <div class="period-selector">
          ${(["7d", "30d", "all"] as Period[]).map(
            (p) => html`
              <button
                class="period-btn ${this._period === p ? "active" : ""}"
                @click=${() => {
                  this._period = p;
                }}
              >
                ${p === "all" ? msg("All", { id: "dashboard-period-all" }) : p}
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  // ── KPI Bar ─────────────────────────────────────────────────

  private _renderKpiBar() {
    const inst = this._instance;
    const cs = this._costSummary;

    const gatewayState = inst?.gateway ?? "unknown";
    const gatewayColor =
      gatewayState === "healthy"
        ? "var(--state-running)"
        : gatewayState === "unhealthy"
          ? "var(--state-error)"
          : "var(--text-muted)";

    const agentCount = this._agents.length;

    // Task counters
    const pending = this._tasks.filter((t) => t.status === "pending").length;
    const inProgress = this._tasks.filter((t) => t.status === "in_progress").length;
    const blocked = this._tasks.filter((t) => t.status === "blocked").length;
    const taskTotal = pending + inProgress + blocked;

    // Alerts from heartbeat (from WS)
    const alerts = inst?.pendingPermissions ?? 0;

    return html`
      <div class="kpi-bar">
        <div class="kpi-pill">
          <span class="kpi-dot" style="background: ${stateColor(inst?.state)}"></span>
          <span class="kpi-label">${msg("State", { id: "dashboard-kpi-state" })}</span>
          <span class="kpi-value">${inst?.state ?? "—"}</span>
        </div>
        <div class="kpi-pill">
          <span class="kpi-dot" style="background: ${gatewayColor}"></span>
          <span class="kpi-label">${msg("Gateway", { id: "dashboard-kpi-gateway" })}</span>
          <span class="kpi-value">${gatewayState}</span>
        </div>
        <div class="kpi-pill">
          <span class="kpi-label">${msg("Agents", { id: "dashboard-kpi-agents" })}</span>
          <span class="kpi-value">${agentCount}</span>
        </div>
        <div class="kpi-pill">
          <span class="kpi-label">${msg("Tasks", { id: "dashboard-kpi-tasks" })}</span>
          <span class="kpi-value">${taskTotal}</span>
        </div>
        <div class="kpi-pill">
          <span class="kpi-label">${msg("Cost", { id: "dashboard-kpi-cost" })}</span>
          <span class="kpi-value">${cs ? fmtUsd(cs.totalCostUsd) : "—"}</span>
        </div>
        <div class="kpi-pill">
          <span class="kpi-label">${msg("Tokens", { id: "dashboard-kpi-tokens" })}</span>
          <span class="kpi-value"
            >${cs ? fmtTokens(cs.totalTokensIn + cs.totalTokensOut) : "—"}</span
          >
        </div>
        <div class="kpi-pill">
          <span class="kpi-label">${msg("Alerts", { id: "dashboard-kpi-alerts" })}</span>
          <span class="kpi-value">${alerts}</span>
        </div>
      </div>
    `;
  }

  // ── Agents Widget ───────────────────────────────────────────

  private _renderAgentsWidget() {
    if (this._widgetErrors.agents) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Agents", { id: "dashboard-agents-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.agents}</div>
        </div>
      `;
    }

    const maxRows = 4;
    const visible = this._agents.slice(0, maxRows);
    const remaining = this._agents.length - maxRows;

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Agents", { id: "dashboard-agents-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("builder")}
            >${msg("Builder", { id: "dashboard-agents-link" })} →</span
          >
        </div>
        ${visible.length === 0
          ? html`<div class="widget-empty">
              ${msg("No agents", { id: "dashboard-agents-empty" })}
            </div>`
          : visible.map(
              (a) => html`
                <div class="agent-row">
                  <div
                    class="agent-stripe"
                    style="background: ${archetypeColor(a.archetype)}"
                  ></div>
                  <div class="agent-name">${a.name}</div>
                  <div class="agent-role">${a.role ?? ""}</div>
                  <div class="agent-model">${a.model ?? ""}</div>
                </div>
              `,
            )}
        ${remaining > 0
          ? html`
              <div class="agent-more" @click=${() => this._navigate("builder")}>
                + ${remaining} ${msg("more…", { id: "dashboard-agents-more" })}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Tasks Widget ────────────────────────────────────────────

  private _renderTasksWidget() {
    if (this._widgetErrors.tasks) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Tasks", { id: "dashboard-tasks-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.tasks}</div>
        </div>
      `;
    }

    const pending = this._tasks.filter((t) => t.status === "pending").length;
    const inProgress = this._tasks.filter((t) => t.status === "in_progress").length;
    const blocked = this._tasks.filter((t) => t.status === "blocked").length;

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Tasks", { id: "dashboard-tasks-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("tasks")}
            >${msg("Board", { id: "dashboard-tasks-link" })} →</span
          >
        </div>
        <div class="tasks-counters">
          <div class="task-counter">
            <span class="task-counter-dot" style="background: var(--text-muted)"></span>
            <span class="task-counter-label"
              >${msg("Pending", { id: "dashboard-tasks-pending" })}</span
            >
            <span class="task-counter-value">${pending}</span>
          </div>
          <div class="task-counter">
            <span class="task-counter-dot" style="background: var(--state-info)"></span>
            <span class="task-counter-label"
              >${msg("In Progress", { id: "dashboard-tasks-inprogress" })}</span
            >
            <span class="task-counter-value">${inProgress}</span>
          </div>
          <div class="task-counter">
            <span class="task-counter-dot" style="background: var(--state-error)"></span>
            <span class="task-counter-label"
              >${msg("Blocked", { id: "dashboard-tasks-blocked" })}</span
            >
            <span class="task-counter-value">${blocked}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ── Costs Widget ────────────────────────────────────────────

  private _renderCostsWidget() {
    if (this._widgetErrors.costs) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Costs", { id: "dashboard-costs-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.costs}</div>
        </div>
      `;
    }

    const cs = this._costSummary;

    // Aggregate daily costs by day for sparkline
    const dayMap = new Map<string, number>();
    for (const dc of this._dailyCosts) {
      dayMap.set(dc.day, (dayMap.get(dc.day) ?? 0) + dc.costUsd);
    }
    const bars = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    const maxBar = Math.max(...bars, 0.001);

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Costs", { id: "dashboard-costs-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("costs")}
            >${msg("Details", { id: "dashboard-costs-link" })} →</span
          >
        </div>
        ${bars.length > 0
          ? html`
              <div class="costs-sparkline">
                ${bars.map(
                  (v) => html`
                    <div
                      class="spark-bar"
                      style="height: ${Math.max((v / maxBar) * 100, 4)}%"
                      title="${fmtUsd(v)}"
                    ></div>
                  `,
                )}
              </div>
            `
          : html`<div class="widget-empty">
              ${msg("No data", { id: "dashboard-costs-empty" })}
            </div>`}
        <div class="costs-totals">
          <span class="cost-total">${cs ? fmtUsd(cs.totalCostUsd) : "—"}</span>
          <span class="cost-tokens"
            >${cs ? fmtTokens(cs.totalTokensIn + cs.totalTokensOut) : "—"} tokens</span
          >
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-dashboard": InstanceDashboard;
  }
}
