// ui/src/components/instance-dashboard.ts
// Instance Dashboard — overview page with KPIs, agents, tasks, costs widgets.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { badgeStyles } from "../styles/shared.js";
import {
  fetchCostSummary,
  fetchDailyCosts,
  fetchBuilderData,
  fetchTasks,
  fetchRtEvents,
  listFlows,
  fetchHeartbeatHeatmap,
  fetchRuntimeSessions,
  fetchMemoryAgents,
} from "../api.js";
import type {
  InstanceInfo,
  CostSummary,
  DailyCost,
  AgentBuilderInfo,
  TaskInfo,
  RtEvent,
  FlowDefinitionWithLastRun,
  HeartbeatAgentStats,
  RuntimeSession,
  MemoryAgentSummary,
} from "../types.js";
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

/** Event level → CSS variable. */
function levelColor(level: string): string {
  switch (level) {
    case "info":
      return "var(--state-info)";
    case "warn":
      return "var(--state-warning)";
    case "error":
      return "var(--state-error)";
    default:
      return "var(--text-muted)";
  }
}

/** Format duration in seconds to compact string. */
function fmtDuration(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.round(seconds)}s`;
}

/** Format bytes to KB or MB. */
function fmtBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Resolve default_model JSON to a display string. */
function resolveModelDisplay(raw: string | null): string {
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw) as { providerId?: string; modelId?: string };
    if (parsed.modelId) {
      return parsed.providerId ? `${parsed.providerId}/${parsed.modelId}` : parsed.modelId;
    }
  } catch {
    // Not JSON — return as-is
  }
  return raw;
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

type WidgetKey =
  | "agents"
  | "tasks"
  | "costs"
  | "dailyCosts"
  | "activity"
  | "flows"
  | "heartbeat"
  | "sessions"
  | "memory";

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
        max-width: 1200px;
        margin: 0 auto;
      }

      /* ── Header ──────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
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
        font-size: 20px;
        font-weight: 700;
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
        margin-bottom: var(--space-4);
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
      .kpi-clickable {
        cursor: pointer;
      }
      .kpi-clickable:hover {
        color: var(--accent);
      }

      /* ── Layout ──────────────────────────────────────────────── */

      .dash-layout {
        display: grid;
        grid-template-columns: 1fr 340px;
        gap: var(--space-6);
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
        height: calc(100vh - 56px - 48px);
        min-height: 400px;
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

      .agent-row-clickable {
        cursor: pointer;
      }
      .agent-row-clickable:hover .agent-name {
        color: var(--accent);
      }

      .agent-name {
        font-size: 13px;
        font-weight: 600;
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

      /* ── Activity Widget ────────────────────────────────────── */

      .event-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 4px 0;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
      }
      .event-row:last-child {
        border-bottom: none;
      }
      .event-time {
        font-family: var(--font-mono);
        color: var(--text-muted);
        font-size: 11px;
        flex-shrink: 0;
      }
      .event-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .event-type {
        font-family: var(--font-mono);
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .event-agent {
        color: var(--text-muted);
        font-size: 11px;
        margin-left: auto;
        flex-shrink: 0;
      }

      /* ── Flows Widget ────────────────────────────────────────── */

      .flow-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 4px 0;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
      }
      .flow-row:last-child {
        border-bottom: none;
      }
      .flow-status {
        flex-shrink: 0;
        font-size: 13px;
        width: 16px;
        text-align: center;
      }
      .flow-name {
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      .flow-duration {
        font-family: var(--font-mono);
        color: var(--text-muted);
        font-size: 11px;
        flex-shrink: 0;
      }

      /* ── Heartbeat Widget ────────────────────────────────────── */

      .heartbeat-row {
        padding: 3px 0;
        font-size: 11px;
        color: var(--text-muted);
        border-bottom: 1px solid var(--bg-border);
      }
      .heartbeat-row:last-child {
        border-bottom: none;
      }
      .heartbeat-footer {
        margin-top: var(--space-2);
        font-size: 12px;
        font-weight: 600;
      }

      /* ── Logs Widget ─────────────────────────────────────────── */

      .logs-stat {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
        font-size: 12px;
      }
      .logs-stat-label {
        color: var(--text-muted);
      }
      .logs-stat-value {
        font-weight: 700;
        font-family: var(--font-mono);
        color: var(--text-primary);
      }

      /* ── Memory Widget ───────────────────────────────────────── */

      .memory-stat {
        font-size: 13px;
        color: var(--text-secondary);
        padding: 2px 0;
      }
      .memory-stat strong {
        color: var(--text-primary);
        font-family: var(--font-mono);
      }

      /* ── Settings Widget ─────────────────────────────────────── */

      .settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
        font-size: 12px;
        border-bottom: 1px solid var(--bg-border);
      }
      .settings-row:last-child {
        border-bottom: none;
      }
      .settings-label {
        color: var(--text-muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .settings-value {
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 180px;
        text-align: right;
      }

      /* ── Widget grid 3 columns ───────────────────────────────── */

      .widget-grid-3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--space-4);
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
        .widget-grid-2,
        .widget-grid-3 {
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
  @state() private _events: RtEvent[] = [];
  @state() private _flows: FlowDefinitionWithLastRun[] = [];
  @state() private _heartbeatStats: HeartbeatAgentStats[] = [];
  @state() private _sessions: RuntimeSession[] = [];
  @state() private _memoryAgents: MemoryAgentSummary[] = [];
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
      fetchRtEvents(this.slug, { limit: 5 }),
      listFlows(this.slug),
      fetchHeartbeatHeatmap(this.slug, 7),
      fetchRuntimeSessions(this.slug, { state: "all", limit: 5 }),
      fetchMemoryAgents(this.slug),
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

    // 4. Activity events
    if (results[4].status === "fulfilled") {
      this._events = results[4].value.events;
    } else {
      errors.activity = String((results[4] as PromiseRejectedResult).reason);
    }

    // 5. Flows
    if (results[5].status === "fulfilled") {
      this._flows = results[5].value;
    } else {
      errors.flows = String((results[5] as PromiseRejectedResult).reason);
    }

    // 6. Heartbeat
    if (results[6].status === "fulfilled") {
      this._heartbeatStats = results[6].value.stats;
    } else {
      errors.heartbeat = String((results[6] as PromiseRejectedResult).reason);
    }

    // 7. Sessions
    if (results[7].status === "fulfilled") {
      this._sessions = results[7].value;
    } else {
      errors.sessions = String((results[7] as PromiseRejectedResult).reason);
    }

    // 8. Memory agents
    if (results[8].status === "fulfilled") {
      this._memoryAgents = results[8].value.agents;
    } else {
      errors.memory = String((results[8] as PromiseRejectedResult).reason);
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
          ${this._renderActivityWidget()}
          <div class="widget-grid-3">
            ${this._renderFlowsWidget()} ${this._renderHeartbeatWidget()}
            ${this._renderLogsWidget()}
          </div>
          <div class="widget-grid-2">
            ${this._renderMemoryWidget()} ${this._renderSettingsWidget()}
          </div>
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
          title=${msg("Back to instances", { id: "dashboard-back-instances" })}
        >
          ← ${msg("Instances", { id: "dashboard-instances-label" })}
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
    const taskTotal = pending + inProgress;

    // Alerts from heartbeat (from WS health_update payload)
    const alerts =
      ((inst as Record<string, unknown> | null)?.heartbeatAlerts as number | undefined) ?? 0;

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
        <div class="kpi-pill kpi-clickable" @click=${() => this._navigate("agents-builder")}>
          <span class="kpi-label">${msg("Agents", { id: "dashboard-kpi-agents" })}</span>
          <span class="kpi-value">${agentCount}</span>
        </div>
        <div class="kpi-pill kpi-clickable" @click=${() => this._navigate("tasks")}>
          <span class="kpi-label">${msg("Tasks", { id: "dashboard-kpi-tasks" })}</span>
          <span class="kpi-value">${taskTotal}</span>
        </div>
        <div class="kpi-pill kpi-clickable" @click=${() => this._navigate("costs")}>
          <span class="kpi-label">${msg("Cost", { id: "dashboard-kpi-cost" })}</span>
          <span class="kpi-value">${cs ? fmtUsd(cs.totalCostUsd) : "—"}</span>
        </div>
        <div class="kpi-pill kpi-clickable" @click=${() => this._navigate("costs")}>
          <span class="kpi-label">${msg("Tokens", { id: "dashboard-kpi-tokens" })}</span>
          <span class="kpi-value"
            >${cs ? fmtTokens(cs.totalTokensIn + cs.totalTokensOut) : "—"}</span
          >
        </div>
        <div class="kpi-pill kpi-clickable" @click=${() => this._navigate("heartbeat")}>
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
          <span class="widget-label"
            >${msg("Agents", { id: "dashboard-agents-title" })} (${this._agents.length})</span
          >
          <span class="widget-link" @click=${() => this._navigate("agents-builder")}
            >${msg("Builder", { id: "dashboard-agents-link" })} →</span
          >
        </div>
        ${visible.length === 0
          ? html`<div class="widget-empty">
              ${msg("No agents", { id: "dashboard-agents-empty" })}
            </div>`
          : visible.map(
              (a) => html`
                <div
                  class="agent-row agent-row-clickable"
                  @click=${() => this._navigate("agents-builder")}
                >
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
              <div class="agent-more" @click=${() => this._navigate("agents-builder")}>
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
    const completed = this._tasks.filter((t) => t.status === "completed").length;

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
            <span class="task-counter-dot" style="background: var(--state-warning)"></span>
            <span class="task-counter-label"
              >${msg("Pending", { id: "dashboard-tasks-pending" })}</span
            >
            <span class="task-counter-value">${pending}</span>
          </div>
          <div class="task-counter">
            <span class="task-counter-dot" style="background: var(--accent)"></span>
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
          <div class="task-counter">
            <span
              style="width: 10px; height: 10px; flex-shrink: 0; text-align: center; font-size: 10px; line-height: 10px; color: var(--text-muted)"
              >✓</span
            >
            <span class="task-counter-label"
              >${msg("Completed", { id: "dashboard-tasks-completed" })}</span
            >
            <span class="task-counter-value">${completed}</span>
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
  // ── Activity Widget ──────────────────────────────────────────

  private _renderActivityWidget() {
    if (this._widgetErrors.activity) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Activity", { id: "dashboard-activity-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.activity}</div>
        </div>
      `;
    }

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Activity", { id: "dashboard-activity-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("activity")}
            >${msg("Activity", { id: "dashboard-activity-link" })} →</span
          >
        </div>
        ${this._events.length === 0
          ? html`<div class="widget-empty">
              ${msg("No activity", { id: "dashboard-activity-empty" })}
            </div>`
          : this._events.map((ev) => {
              const d = new Date(ev.createdAt);
              const hh = String(d.getHours()).padStart(2, "0");
              const mm = String(d.getMinutes()).padStart(2, "0");
              return html`
                <div class="event-row">
                  <span class="event-time">${hh}:${mm}</span>
                  <span class="event-dot" style="background: ${levelColor(ev.level)}"></span>
                  <span class="event-type">${ev.eventType}</span>
                  <span class="event-agent">${ev.agentId ?? ""}</span>
                </div>
              `;
            })}
      </div>
    `;
  }

  // ── Flows Widget ────────────────────────────────────────────

  private _renderFlowsWidget() {
    if (this._widgetErrors.flows) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Flows", { id: "dashboard-flows-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.flows}</div>
        </div>
      `;
    }

    // Sort by lastRun started_at descending, take 3
    const sorted = [...this._flows]
      .filter((f) => f.lastRun)
      .sort((a, b) => {
        const ta = a.lastRun?.started_at ?? a.lastRun?.created_at ?? "";
        const tb = b.lastRun?.started_at ?? b.lastRun?.created_at ?? "";
        return tb.localeCompare(ta);
      })
      .slice(0, 3);

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Flows", { id: "dashboard-flows-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("flows")}
            >${msg("Flows", { id: "dashboard-flows-link" })} →</span
          >
        </div>
        ${sorted.length === 0
          ? html`<div class="widget-empty">
              ${msg("No flows", { id: "dashboard-flows-empty" })}
            </div>`
          : sorted.map((f) => {
              const run = f.lastRun!;
              let icon = "○";
              let color = "var(--text-muted)";
              if (run.status === "completed") {
                icon = "✓";
                color = "var(--state-running)";
              } else if (run.status === "failed") {
                icon = "✗";
                color = "var(--state-error)";
              } else if (run.status === "running") {
                icon = "●";
                color = "var(--accent)";
              }

              let duration = "";
              if (run.started_at) {
                const start = new Date(run.started_at).getTime();
                const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
                duration = fmtDuration((end - start) / 1000);
              }

              return html`
                <div class="flow-row">
                  <span class="flow-status" style="color: ${color}">${icon}</span>
                  <span class="flow-name">${f.name}</span>
                  <span class="flow-duration">${duration}</span>
                </div>
              `;
            })}
      </div>
    `;
  }

  // ── Heartbeat Widget ────────────────────────────────────────

  private _renderHeartbeatWidget() {
    if (this._widgetErrors.heartbeat) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label"
              >${msg("Heartbeat", { id: "dashboard-heartbeat-title" })}</span
            >
          </div>
          <div class="widget-error">${this._widgetErrors.heartbeat}</div>
        </div>
      `;
    }

    const visible = this._heartbeatStats.slice(0, 3);
    const totalAlerts = this._heartbeatStats.reduce((sum, s) => sum + s.totalAlerts, 0);

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Heartbeat", { id: "dashboard-heartbeat-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("heartbeat")}
            >${msg("Heartbeat", { id: "dashboard-heartbeat-link" })} →</span
          >
        </div>
        ${visible.length === 0
          ? html`<div class="widget-empty">
              ${msg("No heartbeat data", { id: "dashboard-heartbeat-empty" })}
            </div>`
          : html`
              ${visible.map((s) => html` <div class="heartbeat-row">${s.agentId}</div> `)}
              <div
                class="heartbeat-footer"
                style="color: ${totalAlerts > 0 ? "var(--state-error)" : "var(--text-muted)"}"
              >
                ⚠ ${totalAlerts} ${msg("alerts", { id: "dashboard-heartbeat-alerts" })}
              </div>
            `}
      </div>
    `;
  }

  // ── Logs Widget ─────────────────────────────────────────────

  private _renderLogsWidget() {
    if (this._widgetErrors.sessions) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Logs", { id: "dashboard-logs-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.sessions}</div>
        </div>
      `;
    }

    const total = this._sessions.length;
    const active = this._sessions.filter((s) => s.state === "active").length;
    const lastUpdate =
      this._sessions.length > 0
        ? this._sessions
            .map((s) => s.updatedAt)
            .sort()
            .reverse()[0]
        : null;
    const lastFmt = lastUpdate ? new Date(lastUpdate).toLocaleString() : "—";

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Logs", { id: "dashboard-logs-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("session-logs")}
            >${msg("Logs", { id: "dashboard-logs-link" })} →</span
          >
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label">${msg("Sessions", { id: "dashboard-logs-sessions" })}</span>
          <span class="logs-stat-value">${total}</span>
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label">${msg("Active", { id: "dashboard-logs-active" })}</span>
          <span class="logs-stat-value">${active}</span>
        </div>
        <div class="logs-stat">
          <span class="logs-stat-label"
            >${msg("Last update", { id: "dashboard-logs-last-update" })}</span
          >
          <span class="logs-stat-value">${lastFmt}</span>
        </div>
      </div>
    `;
  }

  // ── Memory Widget ───────────────────────────────────────────

  private _renderMemoryWidget() {
    if (this._widgetErrors.memory) {
      return html`
        <div class="widget">
          <div class="widget-header">
            <span class="widget-label">${msg("Memory", { id: "dashboard-memory-title" })}</span>
          </div>
          <div class="widget-error">${this._widgetErrors.memory}</div>
        </div>
      `;
    }

    const agentsWithFiles = this._memoryAgents.filter((a) => a.fileCount > 0).length;
    const totalFiles = this._memoryAgents.reduce((sum, a) => sum + a.fileCount, 0);
    const totalSize = this._memoryAgents.reduce((sum, a) => sum + a.totalSize, 0);

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Memory", { id: "dashboard-memory-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("memory")}
            >${msg("Memory", { id: "dashboard-memory-link" })} →</span
          >
        </div>
        <div class="memory-stat">
          <strong>${agentsWithFiles}</strong>
          ${msg("agents with files", { id: "dashboard-memory-agents-with-files" })}
        </div>
        <div class="memory-stat">
          <strong>${totalFiles}</strong> ${msg("files", { id: "dashboard-memory-files" })} ·
          <strong>${fmtBytes(totalSize)}</strong>
        </div>
      </div>
    `;
  }

  // ── Settings Widget ─────────────────────────────────────────

  private _renderSettingsWidget() {
    const inst = this._instance;

    const model = resolveModelDisplay(inst?.default_model ?? null);
    const telegramBot = inst?.telegram_bot;
    const telegramDisplay = telegramBot ? `✈ @${telegramBot}` : "—";
    const port = inst?.port ?? "—";

    return html`
      <div class="widget">
        <div class="widget-header">
          <span class="widget-label">${msg("Settings", { id: "dashboard-settings-title" })}</span>
          <span class="widget-link" @click=${() => this._navigate("instance-settings")}
            >${msg("Settings", { id: "dashboard-settings-link" })} →</span
          >
        </div>
        <div class="settings-row">
          <span class="settings-label">${msg("Model", { id: "dashboard-settings-model" })}</span>
          <span class="settings-value">${model}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label"
            >${msg("Telegram", { id: "dashboard-settings-telegram" })}</span
          >
          <span class="settings-value">${telegramDisplay}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">${msg("Port", { id: "dashboard-settings-port" })}</span>
          <span class="settings-value">${port}</span>
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
