// ui/src/components/flow-sessions.ts
// Flow Sessions — run-centric master/detail with nested step accordions.
// Left: flow runs list. Right: steps as accordions with lazy-loaded messages.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchFlowRuns,
  getFlow,
  getFlowRun as fetchRunDetail,
  fetchSessionMessages,
  getRuntimeChatStreamUrl,
} from "../api.js";
import type { FlowRun, FlowStepRun, PilotMessage, PilotPart } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;
const MSG_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyStatus = FlowRun["status"] | FlowStepRun["status"];

function statusColor(status: AnyStatus): string {
  switch (status) {
    case "pending":
      return "var(--text-muted)";
    case "running":
      return "var(--state-info)";
    case "completed":
      return "var(--state-running)";
    case "failed":
      return "var(--state-error)";
    case "cancelled":
      return "var(--state-warning)";
    case "skipped":
      return "var(--text-secondary)";
    default:
      return "var(--text-muted)";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "--";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = end - start;
  if (diffMs < 1_000) return `${diffMs}ms`;
  const secs = Math.floor(diffMs / 1_000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function fmtCost(usd: number | undefined): string {
  if (usd == null || usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number | undefined): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function parseToolMetadata(meta: string | undefined): {
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
} {
  if (!meta) return {};
  try {
    return JSON.parse(meta) as { toolName?: string; toolCallId?: string; args?: unknown };
  } catch {
    return {};
  }
}

function stringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

/** Color for a run, using worstOutcome when available (from enriched API response). */
function runDisplayColor(run: FlowRun): string {
  if (run.worstOutcome && (run.status === "failed" || run.status === "completed")) {
    if (run.worstOutcome === "failure") return "var(--state-error)";
    if (run.worstOutcome === "partial") return "var(--state-warning)";
    if (run.worstOutcome === "success") return "var(--state-running)";
  }
  return statusColor(run.status);
}

/** Display label for a run status, accounting for partial outcomes. */
function runDisplayLabel(run: FlowRun): string {
  if (run.status === "failed" && run.worstOutcome === "partial") return "partially failed";
  return run.status;
}

/** Effective color for a step, accounting for sitrep outcome on completed steps. */
function stepEffectiveColor(step: FlowStepRun): string {
  if (step.status === "completed" && step.sitrep_json) {
    try {
      const sitrep = JSON.parse(step.sitrep_json) as { outcome?: string };
      if (sitrep.outcome === "failure") return "var(--state-error)";
      if (sitrep.outcome === "partial") return "var(--state-warning)";
    } catch {
      // Malformed sitrep — treat as normal completed
    }
  }
  return statusColor(step.status);
}

/** Summarize step statuses for a run row label. */
function stepsSummary(steps: FlowStepRun[]): string {
  if (steps.length === 0) return "";
  const done = steps.filter(
    (s) => s.status === "completed" || s.status === "failed" || s.status === "skipped",
  ).length;
  return `${done}/${steps.length}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-flow-sessions")
export class FlowSessions extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 1400px;
        margin: 0 auto;
      }

      /* ── Header ─────────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
        flex-wrap: wrap;
      }

      .btn-back {
        background: transparent;
        border: 1px solid var(--bg-border);
        color: var(--text-secondary);
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 13px;
      }
      .btn-back:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }

      /* ── Layout ─────────────────────────────────────────────────── */

      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: var(--space-4);
        min-height: 600px;
      }

      @media (max-width: 800px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      /* ── Run list (left panel) ──────────────────────────────────── */

      .run-list {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        overflow-y: auto;
        max-height: 80vh;
      }

      .run-item {
        padding: var(--space-3) var(--space-4);
        cursor: pointer;
        border-bottom: 1px solid var(--bg-border);
        transition: background 0.1s;
      }
      .run-item:hover {
        background: var(--bg-hover);
      }
      .run-item.selected {
        background: var(--accent-subtle, rgba(79, 110, 247, 0.08));
        border-left: 3px solid var(--accent);
      }

      .run-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }

      .run-meta {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
        display: flex;
        gap: var(--space-2);
        align-items: center;
        flex-wrap: wrap;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
      }

      .load-sentinel {
        padding: var(--space-3);
        text-align: center;
        color: var(--text-muted);
        font-size: 12px;
      }

      /* ── Right panel ────────────────────────────────────────────── */

      .detail-panel {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        overflow-y: auto;
        max-height: 80vh;
        padding: var(--space-4);
      }

      .panel-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        font-size: 14px;
      }

      .run-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
        padding-bottom: var(--space-3);
        border-bottom: 1px solid var(--bg-border);
      }
      .run-header-info {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .run-header-info strong {
        color: var(--text-primary);
      }

      /* ── Step accordion ─────────────────────────────────────────── */

      .step-accordion {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        margin-bottom: var(--space-3);
        overflow: hidden;
      }

      .step-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        cursor: pointer;
        background: var(--bg-surface);
        transition: background 0.1s;
        user-select: none;
      }
      .step-header:hover {
        background: var(--bg-hover);
      }

      .step-chevron {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
        width: 12px;
        text-align: center;
      }

      .step-id {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .step-agent {
        font-size: 12px;
        color: var(--text-muted);
      }

      .step-stats {
        margin-left: auto;
        display: flex;
        gap: var(--space-3);
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .step-body {
        border-top: 1px solid var(--bg-border);
        padding: var(--space-4);
        max-height: 600px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .step-no-session {
        text-align: center;
        padding: var(--space-4);
        color: var(--text-muted);
        font-size: 13px;
        font-style: italic;
      }

      /* ── Toggle raw ─────────────────────────────────────────────── */

      .toggle-raw {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 12px;
        color: var(--text-muted);
        cursor: pointer;
        margin-left: auto;
      }
      .toggle-raw input {
        accent-color: var(--accent);
      }

      /* ── Messages ───────────────────────────────────────────────── */

      .msg {
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        font-size: 13px;
        line-height: 1.5;
      }

      .msg-user {
        background: var(--bg-surface);
      }

      .msg-assistant {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
      }

      .msg-role {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: var(--space-1);
      }
      .msg-role-user {
        color: var(--text-muted);
      }
      .msg-role-assistant {
        color: var(--accent);
      }

      .msg-text {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-primary);
      }

      .msg-compaction {
        border: 1px dashed var(--bg-border);
        background: transparent;
        font-style: italic;
        color: var(--text-muted);
      }

      /* ── Tool parts ─────────────────────────────────────────────── */

      .tool-part {
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-family: var(--font-mono);
      }

      .tool-call {
        background: rgba(79, 110, 247, 0.06);
        border: 1px solid rgba(79, 110, 247, 0.2);
        cursor: pointer;
      }
      .tool-call:hover {
        background: rgba(79, 110, 247, 0.1);
      }

      .tool-result {
        background: rgba(16, 185, 129, 0.06);
        border: 1px solid rgba(16, 185, 129, 0.2);
      }

      .tool-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
      }

      .tool-detail {
        margin-top: var(--space-2);
        padding-top: var(--space-2);
        border-top: 1px solid var(--bg-border);
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-muted);
        max-height: 300px;
        overflow-y: auto;
      }

      .reasoning-part {
        font-style: italic;
        color: var(--text-muted);
        padding: var(--space-2) var(--space-3);
        border-left: 2px solid var(--bg-border);
      }

      /* ── States ─────────────────────────────────────────────────── */

      .spinner {
        text-align: center;
        padding: var(--space-6);
        color: var(--text-muted);
      }

      .error {
        text-align: center;
        padding: var(--space-6);
        color: var(--state-error);
      }

      .empty {
        text-align: center;
        padding: var(--space-6);
        color: var(--text-muted);
      }
    `,
  ];

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  @property({ type: String }) slug = "";
  @property({ type: Number }) flowId = 0;

  @state() private _flowName = "";
  @state() private _runs: FlowRun[] = [];
  @state() private _selectedRun: FlowRun | null = null;
  @state() private _steps: FlowStepRun[] = [];
  @state() private _stepMessages = new Map<string, PilotMessage[]>();
  @state() private _expandedSteps = new Set<string>();
  @state() private _loadingSteps = new Set<string>();
  @state() private _rawMode = false;
  @state() private _expandedTools = new Set<string>();
  @state() private _hasMoreRuns = false;
  @state() private _loading = false;
  @state() private _error = "";

  private _runObserver: IntersectionObserver | null = null;
  private _sseConnections = new Map<string, EventSource>();
  private _pollTimer: number | undefined;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadFlowName();
    void this._loadRuns();
    this._pollTimer = window.setInterval(() => void this._pollActiveRun(), 5_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._runObserver?.disconnect();
    this._disconnectAllSSE();
    if (this._pollTimer !== undefined) clearInterval(this._pollTimer);
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private async _loadFlowName(): Promise<void> {
    if (!this.slug || !this.flowId) return;
    try {
      const { flow } = await getFlow(this.slug, this.flowId);
      this._flowName = flow.name;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private async _loadRuns(append = false): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._error = "";

    try {
      const { runs, hasMore } = await fetchFlowRuns(this.slug, this.flowId, {
        limit: PAGE_SIZE,
      });

      if (append) {
        this._runs = [...this._runs, ...runs];
      } else {
        this._runs = runs;
      }
      this._hasMoreRuns = hasMore;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _selectRun(run: FlowRun): Promise<void> {
    this._selectedRun = run;
    this._steps = [];
    this._stepMessages = new Map();
    this._expandedSteps = new Set();
    this._disconnectAllSSE();

    try {
      const { run: freshRun, steps } = await fetchRunDetail(this.slug, run.id);
      this._selectedRun = {
        ...freshRun,
        ...(run.worstOutcome !== undefined ? { worstOutcome: run.worstOutcome } : {}),
      };
      this._steps = steps;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Poll steps + run list while the selected run is active. */
  private async _pollActiveRun(): Promise<void> {
    const run = this._selectedRun;
    if (!run) return;

    const isActive = run.status === "running" || run.status === "pending";
    if (!isActive) return;

    try {
      // 1. Refresh steps
      const { run: freshRun, steps } = await fetchRunDetail(this.slug, run.id);
      this._selectedRun = {
        ...freshRun,
        ...(run.worstOutcome !== undefined ? { worstOutcome: run.worstOutcome } : {}),
      };
      this._steps = steps;

      // 2. For expanded running steps with a session, wire SSE + refresh messages
      for (const step of steps) {
        if (!this._expandedSteps.has(step.step_id)) continue;
        if (!step.session_id) continue;

        // Load messages if not yet loaded
        if (!this._stepMessages.has(step.session_id)) {
          void this._loadStepMessages(step);
        }

        // Connect SSE for running steps
        if (step.status === "running" && !this._sseConnections.has(step.session_id)) {
          this._connectSSE(step.session_id);
        }
      }

      // 3. Refresh runs list (left panel status)
      void this._loadRuns();
    } catch {
      // Silent — poll will retry
    }
  }

  private async _toggleStep(step: FlowStepRun): Promise<void> {
    const next = new Set(this._expandedSteps);
    if (next.has(step.step_id)) {
      // Collapse
      next.delete(step.step_id);
      if (step.session_id) this._disconnectSSE(step.session_id);
    } else {
      // Expand
      next.add(step.step_id);
      if (step.session_id && !this._stepMessages.has(step.session_id)) {
        await this._loadStepMessages(step);
      }
      // SSE for running steps
      if (step.session_id && step.status === "running") {
        this._connectSSE(step.session_id);
      }
    }
    this._expandedSteps = next;
  }

  private async _loadStepMessages(step: FlowStepRun): Promise<void> {
    if (!step.session_id) return;
    const sid = step.session_id;
    this._loadingSteps = new Set([...this._loadingSteps, step.step_id]);
    this.requestUpdate();

    try {
      const { messages } = await fetchSessionMessages(this.slug, sid, { limit: MSG_PAGE_SIZE });
      const next = new Map(this._stepMessages);
      next.set(sid, messages);
      this._stepMessages = next;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      const loading = new Set(this._loadingSteps);
      loading.delete(step.step_id);
      this._loadingSteps = loading;
    }
  }

  // ---------------------------------------------------------------------------
  // SSE
  // ---------------------------------------------------------------------------

  private _connectSSE(sessionId: string): void {
    if (this._sseConnections.has(sessionId)) return;
    const url = getRuntimeChatStreamUrl(this.slug, sessionId);
    const source = new EventSource(url, { withCredentials: true });
    source.onmessage = () => {
      void this._refetchStepMessages(sessionId);
    };
    this._sseConnections.set(sessionId, source);
  }

  private _disconnectSSE(sessionId: string): void {
    const source = this._sseConnections.get(sessionId);
    if (source) {
      source.close();
      this._sseConnections.delete(sessionId);
    }
  }

  private _disconnectAllSSE(): void {
    for (const source of this._sseConnections.values()) source.close();
    this._sseConnections.clear();
  }

  private async _refetchStepMessages(sessionId: string): Promise<void> {
    try {
      const { messages } = await fetchSessionMessages(this.slug, sessionId, {
        limit: MSG_PAGE_SIZE,
      });
      const next = new Map(this._stepMessages);
      next.set(sessionId, messages);
      this._stepMessages = next;
    } catch {
      // Silent — SSE will retry
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll sentinel
  // ---------------------------------------------------------------------------

  override updated(): void {
    this._setupRunSentinel();
  }

  private _setupRunSentinel(): void {
    this._runObserver?.disconnect();
    const sentinel = this.renderRoot.querySelector(".run-sentinel");
    if (!sentinel) return;

    this._runObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this._hasMoreRuns && !this._loading) {
          void this._loadRuns(true);
        }
      },
      { root: this.renderRoot.querySelector(".run-list"), threshold: 0.1 },
    );
    this._runObserver.observe(sentinel);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    return html`
      <div class="header">
        <button class="btn-back" @click=${this._goBack}>
          ${msg("\u2190 Back", { id: "flow-sessions-back" })}
        </button>
        <span class="title">
          ${msg("Flow Sessions", { id: "flow-sessions-title" })}
          ${this._flowName ? html` — ${this._flowName}` : nothing}
        </span>
        <label class="toggle-raw">
          <input
            type="checkbox"
            .checked=${this._rawMode}
            @change=${(e: Event) => {
              this._rawMode = (e.target as HTMLInputElement).checked;
            }}
          />
          ${msg("Raw LLM", { id: "flow-sessions-raw-mode" })}
        </label>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

      <div class="layout">${this._renderRunList()} ${this._renderDetail()}</div>
    `;
  }

  // --- Run list (left panel) ---

  private _renderRunList() {
    if (this._loading && this._runs.length === 0) {
      return html`<div class="run-list">
        <div class="spinner">${msg("Loading...", { id: "flow-sessions-loading" })}</div>
      </div>`;
    }

    if (this._runs.length === 0) {
      return html`<div class="run-list">
        <div class="empty">
          ${msg("No runs found for this flow", { id: "flow-sessions-no-runs" })}
        </div>
      </div>`;
    }

    return html`
      <div class="run-list">
        ${this._runs.map((r) => this._renderRunItem(r))}
        ${this._hasMoreRuns
          ? html`<div class="run-sentinel load-sentinel">
              ${this._loading ? msg("Loading...", { id: "flow-sessions-loading" }) : ""}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderRunItem(run: FlowRun) {
    const selected = this._selectedRun?.id === run.id;
    const isRunning = run.status === "running";

    return html`
      <div class="run-item ${selected ? "selected" : ""}" @click=${() => void this._selectRun(run)}>
        <div class="run-label">
          <span
            class="status-dot"
            style="background:${runDisplayColor(run)}${isRunning
              ? ";animation:pulse 1.2s infinite"
              : ""}"
          ></span>
          <span>Run #${run.id}</span>
          <span style="font-weight:400;color:var(--text-muted);font-size:12px">
            ${run.trigger_type}
          </span>
        </div>
        <div class="run-meta">
          <span>${fmtDate(run.started_at ?? run.created_at)}</span>
          <span>·</span>
          <span>${fmtDuration(run.started_at, run.finished_at)}</span>
          <span>·</span>
          <span style="color:${runDisplayColor(run)}">${runDisplayLabel(run)}</span>
        </div>
      </div>
    `;
  }

  // --- Detail panel (right) ---

  private _renderDetail() {
    if (!this._selectedRun) {
      return html`
        <div class="detail-panel">
          <div class="panel-empty">
            ${msg("Select a run to view", { id: "flow-sessions-select-run" })}
          </div>
        </div>
      `;
    }

    if (this._steps.length === 0 && !this._error) {
      return html`
        <div class="detail-panel">
          <div class="panel-empty">${msg("Loading...", { id: "flow-sessions-loading" })}</div>
        </div>
      `;
    }

    const run = this._selectedRun;
    const totalCost = this._steps.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
    const totalTokens = this._steps.reduce(
      (sum, s) => sum + (s.tokens_in ?? 0) + (s.tokens_out ?? 0),
      0,
    );

    return html`
      <div class="detail-panel">
        <div class="run-header">
          <span
            class="status-dot"
            style="background:${runDisplayColor(run)}${run.status === "running"
              ? ";animation:pulse 1.2s infinite"
              : ""}"
          ></span>
          <div class="run-header-info">
            <strong>Run #${run.id}</strong> · ${run.trigger_type} ·
            ${fmtDate(run.started_at ?? run.created_at)} ·
            ${fmtDuration(run.started_at, run.finished_at)} · ${fmtTokens(totalTokens)} tok ·
            ${fmtCost(totalCost)} ·
            <span style="color:${runDisplayColor(run)}">${runDisplayLabel(run)}</span>
            (${stepsSummary(this._steps)} steps)
          </div>
        </div>

        ${this._steps.map((s) => this._renderStepAccordion(s))}
      </div>
    `;
  }

  // --- Step accordion ---

  private _renderStepAccordion(step: FlowStepRun) {
    const expanded = this._expandedSteps.has(step.step_id);
    const isRunning = step.status === "running";
    const isLoading = this._loadingSteps.has(step.step_id);
    const messages = step.session_id ? this._stepMessages.get(step.session_id) : undefined;

    return html`
      <div class="step-accordion">
        <div class="step-header" @click=${() => void this._toggleStep(step)}>
          <span class="step-chevron">${expanded ? "\u25bc" : "\u25b6"}</span>
          <span
            class="status-dot"
            style="background:${stepEffectiveColor(step)}${isRunning
              ? ";animation:pulse 1.2s infinite"
              : ""}"
          ></span>
          <span class="step-id">${step.step_id}</span>
          <span class="step-agent">${step.agent_id}</span>
          <div class="step-stats">
            <span>${fmtDuration(step.started_at, step.finished_at)}</span>
            <span>${fmtTokens((step.tokens_in ?? 0) + (step.tokens_out ?? 0))} tok</span>
            <span>${fmtCost(step.cost_usd)}</span>
          </div>
        </div>

        ${expanded
          ? html`<div class="step-body">
              ${!step.session_id
                ? html`<div class="step-no-session">
                    ${msg("No session yet", { id: "flow-sessions-no-session" })}
                  </div>`
                : isLoading && !messages
                  ? html`<div class="spinner">
                      ${msg("Loading...", { id: "flow-sessions-loading" })}
                    </div>`
                  : messages
                    ? messages.map((m) => this._renderMessage(m))
                    : nothing}
            </div>`
          : nothing}
      </div>
    `;
  }

  // --- Messages ---

  private _renderMessage(m: PilotMessage) {
    if (m.isCompaction) {
      return html`
        <div class="msg msg-compaction">
          <div class="msg-role msg-role-assistant">compaction</div>
          ${m.parts.map((p) => html`<div class="msg-text">${p.content ?? ""}</div>`)}
        </div>
      `;
    }

    const isUser = m.role === "user";
    return html`
      <div class="msg ${isUser ? "msg-user" : "msg-assistant"}">
        <div class="msg-role ${isUser ? "msg-role-user" : "msg-role-assistant"}">
          ${isUser ? "\ud83d\udc64 user" : "\ud83e\udd16 assistant"}
        </div>
        ${m.parts.map((p) => this._renderPart(p))}
      </div>
    `;
  }

  private _renderPart(p: PilotPart) {
    switch (p.type) {
      case "text":
        return html`<div class="msg-text">${p.content ?? ""}</div>`;
      case "tool_call":
        return this._renderToolCall(p);
      case "tool_result":
        return this._renderToolResult(p);
      case "reasoning":
        return html`<div class="reasoning-part">${p.content ?? ""}</div>`;
      case "compaction":
        return html`<div class="msg-text" style="font-style:italic">${p.content ?? ""}</div>`;
      case "suggestion":
        return html`<div class="msg-text" style="color:var(--text-muted)">${p.content ?? ""}</div>`;
      default:
        return this._rawMode
          ? html`<div class="msg-text">[${p.type}] ${p.content ?? ""}</div>`
          : nothing;
    }
  }

  private _renderToolCall(p: PilotPart) {
    const meta = parseToolMetadata(p.metadata);
    const expanded = this._expandedTools.has(p.id);

    if (this._rawMode) {
      return html`
        <div class="tool-part tool-call">
          <div class="tool-header">🔧 tool_call: ${meta.toolName ?? "unknown"}</div>
          <div class="tool-detail">${stringify({ ...meta, content: p.content })}</div>
        </div>
      `;
    }

    return html`
      <div
        class="tool-part tool-call"
        @click=${(e: Event) => {
          e.stopPropagation();
          const next = new Set(this._expandedTools);
          if (expanded) next.delete(p.id);
          else next.add(p.id);
          this._expandedTools = next;
        }}
      >
        <div class="tool-header">
          <span>${expanded ? "\u25bc" : "\u25b6"}</span>
          <span>🔧 ${meta.toolName ?? "unknown"}</span>
          <span style="color:var(--text-muted)">→ ${p.state ?? "completed"}</span>
        </div>
        ${expanded
          ? html`<div class="tool-detail">${stringify(meta.args) || p.content || ""}</div>`
          : nothing}
      </div>
    `;
  }

  private _renderToolResult(p: PilotPart) {
    if (this._rawMode) {
      return html`
        <div class="tool-part tool-result">
          <div class="tool-header">🔧 tool_result</div>
          <div class="tool-detail">${p.content ?? ""}</div>
        </div>
      `;
    }

    const meta = parseToolMetadata(p.metadata);
    const toolCallId = meta.toolCallId;
    if (toolCallId && this._expandedTools.has(toolCallId)) {
      return nothing;
    }

    const expanded = this._expandedTools.has(p.id);
    return html`
      <div
        class="tool-part tool-result"
        @click=${(e: Event) => {
          e.stopPropagation();
          const next = new Set(this._expandedTools);
          if (expanded) next.delete(p.id);
          else next.add(p.id);
          this._expandedTools = next;
        }}
      >
        <div class="tool-header">
          <span>${expanded ? "\u25bc" : "\u25b6"}</span>
          <span>🔧 result</span>
          <span style="color:var(--text-muted)">${p.state ?? "completed"}</span>
        </div>
        ${expanded ? html`<div class="tool-detail">${p.content ?? ""}</div>` : nothing}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "flows", slug: this.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-flow-sessions": FlowSessions;
  }
}
