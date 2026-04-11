// ui/src/components/flow-run-detail.ts
// Flow Run Detail — shows a flow run with its step execution details.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { getFlowRun, cancelFlowRun } from "../api.js";
import type { FlowRun, FlowStepRun, FlowSitrep } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FlowStatus = FlowRun["status"];
type StepStatus = FlowStepRun["status"];

function statusColor(status: FlowStatus | StepStatus): string {
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

function formatTimestamp(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(startIso: string | null, endIso: string | null): string {
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

function parseSitrep(json: string | null): FlowSitrep | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as FlowSitrep;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-flow-run-detail")
export class FlowRunDetail extends LitElement {
  @property({ type: String }) slug = "";
  @property({ type: Number }) runId = 0;

  @state() private _run: FlowRun | null = null;
  @state() private _steps: FlowStepRun[] = [];
  @state() private _loading = true;
  @state() private _expandedSitreps: Set<string> = new Set();
  @state() private _cancelling = false;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._fetchData();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearPoll();
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("slug") || changed.has("runId")) {
      this._clearPoll();
      void this._fetchData();
    }
  }

  // ── Data fetching ──────────────────────────────────────────────

  private async _fetchData(): Promise<void> {
    if (!this.slug || !this.runId) return;
    try {
      this._loading = !this._run; // only show spinner on first load
      const data = await getFlowRun(this.slug, this.runId);
      this._run = data.run;
      this._steps = data.steps;
      this._managePoll();
    } catch (err) {
      console.error("[flow-run-detail] fetch error", err);
    } finally {
      this._loading = false;
    }
  }

  private _managePoll(): void {
    if (this._run?.status === "running" || this._run?.status === "pending") {
      if (!this._pollTimer) {
        this._pollTimer = setInterval(() => void this._fetchData(), POLL_MS);
      }
    } else {
      this._clearPoll();
    }
  }

  private _clearPoll(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── Actions ────────────────────────────────────────────────────

  private async _handleCancel(): Promise<void> {
    if (!this.slug || !this.runId || this._cancelling) return;
    this._cancelling = true;
    try {
      await cancelFlowRun(this.slug, this.runId);
      await this._fetchData();
    } catch (err) {
      console.error("[flow-run-detail] cancel error", err);
    } finally {
      this._cancelling = false;
    }
  }

  private _toggleSitrep(stepId: string): void {
    const next = new Set(this._expandedSitreps);
    if (next.has(stepId)) {
      next.delete(stepId);
    } else {
      next.add(stepId);
    }
    this._expandedSitreps = next;
  }

  private _navigateBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "flows", slug: this.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ── Render ─────────────────────────────────────────────────────

  override render() {
    if (this._loading && !this._run) {
      return html`<div class="loading">${msg("Loading...")}</div>`;
    }
    if (!this._run) {
      return html`<div class="empty">${msg("Run not found")}</div>`;
    }
    const run = this._run;
    return html`
      <div class="container">
        ${this._renderHeader(run)} ${this._renderMeta(run)}
        ${run.error ? this._renderError(run.error) : nothing}
        <h3 class="section-title">${msg("Steps")}</h3>
        <div class="steps-list">
          ${this._steps.map((step) => this._renderStepCard(step))}
          ${this._steps.length === 0
            ? html`<p class="no-steps">${msg("No steps yet")}</p>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderHeader(run: FlowRun) {
    const canCancel = run.status === "running" || run.status === "pending";
    return html`
      <div class="header">
        <button class="btn-back" @click=${this._navigateBack}>${msg("Back")}</button>
        <h2 class="title">${msg("Flow run")} #${run.id}</h2>
        <span class="badge" style="--badge-color: ${statusColor(run.status)}">${run.status}</span>
        ${canCancel
          ? html`
              <button class="btn-cancel" ?disabled=${this._cancelling} @click=${this._handleCancel}>
                ${this._cancelling ? msg("Cancelling...") : msg("Cancel")}
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private _renderMeta(run: FlowRun) {
    return html`
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">${msg("Started")}</span>
          <span class="meta-value">${formatTimestamp(run.started_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">${msg("Finished")}</span>
          <span class="meta-value">${formatTimestamp(run.finished_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">${msg("Duration")}</span>
          <span class="meta-value">${formatDuration(run.started_at, run.finished_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">${msg("Trigger")}</span>
          <span class="meta-value">${run.trigger_type}</span>
        </div>
      </div>
    `;
  }

  private _renderError(error: string) {
    return html` <div class="error-banner"><strong>${msg("Error")}:</strong> ${error}</div> `;
  }

  private _renderStepCard(step: FlowStepRun) {
    const sitrep = parseSitrep(step.sitrep_json);
    const expanded = this._expandedSitreps.has(step.step_id);
    return html`
      <div class="step-card">
        <div class="step-header">
          <span class="step-id">${step.step_id}</span>
          <span class="step-agent">${step.agent_id}</span>
          <span class="badge badge-sm" style="--badge-color: ${statusColor(step.status)}"
            >${step.status}</span
          >
        </div>
        <div class="step-meta">
          ${step.started_at
            ? html`<span class="step-stat"
                >${formatDuration(step.started_at, step.finished_at)}</span
              >`
            : nothing}
          <span class="step-stat">${step.tokens_in} in / ${step.tokens_out} out</span>
          <span class="step-stat">$${step.cost_usd.toFixed(4)}</span>
          ${step.retry_count > 0
            ? html`<span class="step-stat retry">${step.retry_count} ${msg("retries")}</span>`
            : nothing}
        </div>
        ${step.error
          ? html`<div class="step-error"><strong>${msg("Error")}:</strong> ${step.error}</div>`
          : nothing}
        ${sitrep
          ? html`
              <button class="sitrep-toggle" @click=${() => this._toggleSitrep(step.step_id)}>
                ${expanded ? "▾" : "▸"} ${msg("SITREP")}
              </button>
              ${expanded ? this._renderSitrep(sitrep) : nothing}
            `
          : nothing}
      </div>
    `;
  }

  private _renderSitrep(sitrep: FlowSitrep) {
    return html`
      <div class="sitrep">
        <div class="sitrep-row">
          <span class="sitrep-label">${msg("Outcome")}:</span>
          <span class="sitrep-value sitrep-outcome-${sitrep.outcome}">${sitrep.outcome}</span>
        </div>
        <div class="sitrep-row">
          <span class="sitrep-label">${msg("Summary")}:</span>
          <span class="sitrep-value">${sitrep.summary}</span>
        </div>
        ${sitrep.keyFindings.length > 0
          ? html`
              <div class="sitrep-findings">
                <span class="sitrep-label">${msg("Key findings")}:</span>
                <ul>
                  ${sitrep.keyFindings.map((f) => html`<li>${f}</li>`)}
                </ul>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Styles ─────────────────────────────────────────────────────

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-6);
        max-width: 960px;
        margin: 0 auto;
      }

      .loading,
      .empty {
        text-align: center;
        padding: var(--space-8);
        color: var(--text-secondary);
        font-size: 14px;
      }

      /* ── Header ────────────────────────────────────────────── */

      .header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
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
        margin: 0;
        flex: 1;
      }

      .badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--badge-color);
        background: color-mix(in srgb, var(--badge-color) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--badge-color) 30%, transparent);
      }

      .badge-sm {
        font-size: 11px;
        padding: 1px 8px;
      }

      .btn-cancel {
        background: none;
        border: 1px solid var(--state-error);
        border-radius: var(--radius-sm);
        color: var(--state-error);
        cursor: pointer;
        padding: 4px 12px;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        transition:
          background 0.15s,
          color 0.15s;
      }

      .btn-cancel:hover:not(:disabled) {
        background: var(--state-error);
        color: #fff;
      }

      .btn-cancel:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* ── Meta grid ─────────────────────────────────────────── */

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: var(--space-3);
        margin-bottom: var(--space-6);
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: var(--space-4);
      }

      .meta-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .meta-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
      }

      .meta-value {
        font-size: 14px;
        color: var(--text-primary);
        font-family: var(--font-mono);
      }

      /* ── Error banner ──────────────────────────────────────── */

      .error-banner {
        background: color-mix(in srgb, var(--state-error) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--state-error) 30%, transparent);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
        color: var(--state-error);
        font-size: 13px;
        margin-bottom: var(--space-6);
      }

      /* ── Section title ─────────────────────────────────────── */

      .section-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 var(--space-3) 0;
      }

      /* ── Steps list ────────────────────────────────────────── */

      .steps-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .no-steps {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        padding: var(--space-4);
      }

      .step-card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: var(--space-4);
      }

      .step-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-2);
      }

      .step-id {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        color: var(--accent);
      }

      .step-agent {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .step-meta {
        display: flex;
        gap: var(--space-4);
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--text-secondary);
        font-family: var(--font-mono);
      }

      .step-stat {
        white-space: nowrap;
      }

      .step-stat.retry {
        color: var(--state-warning);
      }

      .step-error {
        margin-top: var(--space-2);
        font-size: 12px;
        color: var(--state-error);
        background: color-mix(in srgb, var(--state-error) 6%, transparent);
        border-radius: var(--radius-sm);
        padding: var(--space-2) var(--space-3);
      }

      /* ── SITREP ────────────────────────────────────────────── */

      .sitrep-toggle {
        background: none;
        border: none;
        color: var(--accent);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: var(--space-1) 0;
        margin-top: var(--space-2);
        font-family: inherit;
      }

      .sitrep-toggle:hover {
        color: var(--accent-hover);
      }

      .sitrep {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        padding: var(--space-3);
        margin-top: var(--space-2);
        font-size: 13px;
      }

      .sitrep-row {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-1);
      }

      .sitrep-label {
        font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap;
      }

      .sitrep-value {
        color: var(--text-primary);
      }

      .sitrep-outcome-success {
        color: var(--state-running);
      }

      .sitrep-outcome-failure {
        color: var(--state-error);
      }

      .sitrep-outcome-partial {
        color: var(--state-warning);
      }

      .sitrep-findings {
        margin-top: var(--space-2);
      }

      .sitrep-findings ul {
        margin: var(--space-1) 0 0 var(--space-4);
        padding: 0;
        color: var(--text-primary);
      }

      .sitrep-findings li {
        margin-bottom: 2px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-flow-run-detail": FlowRunDetail;
  }
}
