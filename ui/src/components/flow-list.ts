// ui/src/components/flow-list.ts
// Flow List — displays flow definitions for an instance with run/edit/delete actions.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { listFlows, runFlow, deleteFlow, updateFlow, fetchInstances } from "../api.js";
import type { FlowDefinitionWithLastRun, FlowStepDef } from "../types.js";
import "./flow-editor.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_MS = 15_000;
const DESC_MAX_LEN = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseStepCount(stepsJson: string): number {
  try {
    const steps = JSON.parse(stepsJson) as FlowStepDef[];
    return Array.isArray(steps) ? steps.length : 0;
  } catch {
    return 0;
  }
}

function parseTriggerType(triggerJson: string): string {
  try {
    const trigger = JSON.parse(triggerJson) as { type?: string };
    return trigger?.type ?? "manual";
  } catch {
    return "manual";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-flow-list")
export class FlowList extends LitElement {
  @property({ type: String }) slug = "";

  @state() private _flows: FlowDefinitionWithLastRun[] = [];
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _runningIds: Set<number> = new Set();
  @state() private _instanceRunning = false;
  @state() private _editorOpen = false;
  @state() private _editFlowId: number | undefined;

  private _refreshTimer: number | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
    this._refreshTimer = window.setInterval(() => void this._load(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) clearInterval(this._refreshTimer);
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  private async _load(): Promise<void> {
    if (!this.slug) return;
    try {
      const [flows, instances] = await Promise.all([listFlows(this.slug), fetchInstances()]);
      this._flows = flows;
      this._instanceRunning = instances.find((i) => i.slug === this.slug)?.state === "running";
      // Sync running ids from actual server state
      const stillRunning = new Set(
        flows.filter((f) => f.lastRun?.status === "running").map((f) => f.id),
      );
      this._runningIds = stillRunning;
      if (this._loading) this._loading = false;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async _runFlow(id: number): Promise<void> {
    this._runningIds = new Set([...this._runningIds, id]);
    this.requestUpdate();
    try {
      await runFlow(this.slug, id);
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._runningIds = new Set([...this._runningIds].filter((x) => x !== id));
    }
  }

  private async _deleteFlow(id: number, name: string): Promise<void> {
    const confirmed = window.confirm(
      msg('Delete flow "{name}"?', { id: "flow-list-confirm-delete" }).replace("{name}", name),
    );
    if (!confirmed) return;
    try {
      await deleteFlow(this.slug, id);
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  private _editFlow(id: number): void {
    this._editFlowId = id;
    this._editorOpen = true;
  }

  private _openNewFlowEditor(): void {
    this._editFlowId = undefined;
    this._editorOpen = true;
  }

  private _closeEditor(): void {
    this._editorOpen = false;
    this._editFlowId = undefined;
  }

  private _onFlowSaved(): void {
    this._closeEditor();
    void this._load();
  }

  private async _toggleEnabled(flow: FlowDefinitionWithLastRun): Promise<void> {
    try {
      await updateFlow(this.slug, flow.id, { enabled: flow.enabled ? 0 : 1 });
      void this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading flows...", { id: "flow-list-loading" })}
      </div>`;
    }

    return html`
      <div class="header">
        <div class="title">${msg("Flows", { id: "flow-list-title" })}</div>
        <button class="btn-new" @click=${this._openNewFlowEditor}>
          + ${msg("New Flow", { id: "flow-list-new" })}
        </button>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${this._flows.length === 0
        ? html`<div class="empty">${msg("No flows defined yet.", { id: "flow-list-empty" })}</div>`
        : html`<div class="flow-table">${this._flows.map((f) => this._renderRow(f))}</div>`}
      ${this._editorOpen
        ? html`<cp-flow-editor
            .slug=${this.slug}
            .flowId=${this._editFlowId}
            @close-dialog=${this._closeEditor}
            @flow-saved=${this._onFlowSaved}
          ></cp-flow-editor>`
        : nothing}
    `;
  }

  private _renderRow(flow: FlowDefinitionWithLastRun) {
    const isRunning = this._runningIds.has(flow.id) || flow.lastRun?.status === "running";
    const stepCount = parseStepCount(flow.steps_json);
    const triggerType = parseTriggerType(flow.trigger_json);
    const lastStatus = flow.lastRun?.status ?? null;
    const lastRunAt = flow.lastRun?.started_at ?? flow.lastRun?.created_at ?? null;

    return html`
      <div class="flow-row">
        <div class="flow-info">
          <div class="flow-name">${flow.name}</div>
          <div class="flow-desc">${truncate(flow.description, DESC_MAX_LEN)}</div>
        </div>

        <div class="flow-meta">
          <span class="meta-badge steps" title=${msg("Steps", { id: "flow-list-steps" })}>
            ${stepCount} ${msg("steps", { id: "flow-list-step-count" })}
          </span>
          <span class="meta-badge trigger" title=${msg("Trigger", { id: "flow-list-trigger" })}>
            ${triggerType}
          </span>
        </div>

        <div class="flow-status">
          ${lastStatus
            ? html`
                <span class="status-dot status-${lastStatus}"></span>
                <span class="status-label">${lastStatus}</span>
              `
            : html`<span class="status-label muted">--</span>`}
          <span class="status-time">${formatTimestamp(lastRunAt)}</span>
        </div>

        <div class="flow-toggle">
          <label class="toggle-switch" title=${msg("Enabled", { id: "flow-list-enabled" })}>
            <input
              type="checkbox"
              .checked=${!!flow.enabled}
              @change=${() => void this._toggleEnabled(flow)}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="flow-actions">
          ${flow.sessionCount > 0
            ? html`<button
                class="btn-action btn-logs"
                title=${msg("Session logs", { id: "flow-list-logs" })}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.dispatchEvent(
                    new CustomEvent("navigate", {
                      detail: { view: "flow-sessions", slug: this.slug, flowId: flow.id },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                ${msg("Logs", { id: "flow-list-logs-btn" })} (${flow.sessionCount})
              </button>`
            : nothing}
          <button
            class="btn-action btn-run"
            ?disabled=${isRunning || !this._instanceRunning}
            title=${!this._instanceRunning
              ? msg("Instance must be running to execute flows", { id: "flow-list-run-disabled" })
              : msg("Run", { id: "flow-list-run" })}
            @click=${() => void this._runFlow(flow.id)}
          >
            ${isRunning
              ? msg("Running...", { id: "flow-list-running" })
              : msg("Run", { id: "flow-list-run-btn" })}
          </button>
          <button
            class="btn-action btn-edit"
            title=${msg("Edit", { id: "flow-list-edit" })}
            @click=${() => this._editFlow(flow.id)}
          >
            ${msg("Edit", { id: "flow-list-edit-btn" })}
          </button>
          <button
            class="btn-action btn-delete"
            title=${msg("Delete", { id: "flow-list-delete" })}
            @click=${() => void this._deleteFlow(flow.id, flow.name)}
          >
            ${msg("Delete", { id: "flow-list-delete-btn" })}
          </button>
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
        padding: var(--space-6);
        height: 100%;
        box-sizing: border-box;
      }

      /* Header */
      .header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        margin-bottom: var(--space-4);
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
      }
      .btn-new {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid var(--accent-border);
        background: transparent;
        color: var(--accent);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
      }
      .btn-new:hover {
        background: var(--accent-subtle);
      }

      /* Loading / Error / Empty */
      .loading,
      .empty {
        text-align: center;
        padding: 48px;
        color: var(--text-muted);
        font-size: 14px;
      }
      .error {
        color: var(--state-error);
        margin-bottom: 12px;
        font-size: 13px;
      }

      /* Table */
      .flow-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .flow-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        transition: border-color 0.15s;
      }
      .flow-row:hover {
        border-color: var(--accent-border);
      }

      /* Flow info */
      .flow-info {
        flex: 1;
        min-width: 0;
      }
      .flow-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .flow-desc {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Meta badges */
      .flow-meta {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .meta-badge {
        font-size: 11px;
        font-family: var(--font-mono);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        background: var(--bg-base);
        color: var(--text-secondary);
        border: 1px solid var(--bg-border);
        white-space: nowrap;
      }

      /* Status */
      .flow-status {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        min-width: 140px;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .status-completed {
        background: var(--state-running);
      }
      .status-failed {
        background: var(--state-error);
      }
      .status-running {
        background: var(--state-warning);
        animation: pulse 1.2s infinite;
      }
      .status-pending {
        background: var(--text-muted);
      }
      .status-cancelled {
        background: var(--text-muted);
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
      .status-label {
        font-size: 12px;
        color: var(--text-secondary);
        text-transform: capitalize;
      }
      .status-label.muted {
        color: var(--text-muted);
      }
      .status-time {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }

      /* Toggle switch */
      .flow-toggle {
        flex-shrink: 0;
      }
      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 36px;
        height: 20px;
        cursor: pointer;
      }
      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .toggle-slider {
        position: absolute;
        inset: 0;
        background: var(--bg-border);
        border-radius: 10px;
        transition: background 0.2s;
      }
      .toggle-slider::before {
        content: "";
        position: absolute;
        width: 14px;
        height: 14px;
        left: 3px;
        bottom: 3px;
        background: var(--text-secondary);
        border-radius: 50%;
        transition:
          transform 0.2s,
          background 0.2s;
      }
      .toggle-switch input:checked + .toggle-slider {
        background: var(--accent);
      }
      .toggle-switch input:checked + .toggle-slider::before {
        transform: translateX(16px);
        background: #fff;
      }

      /* Action buttons */
      .flow-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .btn-action {
        padding: 4px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition:
          background 0.15s,
          border-color 0.15s,
          color 0.15s;
      }
      .btn-logs {
        color: var(--text-secondary);
        border-color: var(--bg-border);
      }
      .btn-logs:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .btn-run {
        color: var(--state-running);
        border-color: rgba(16, 185, 129, 0.25);
      }
      .btn-run:hover:not(:disabled) {
        background: rgba(16, 185, 129, 0.1);
      }
      .btn-run:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-edit {
        color: var(--accent);
        border-color: var(--accent-border);
      }
      .btn-edit:hover {
        background: var(--accent-subtle);
      }
      .btn-delete {
        color: var(--state-error);
        border-color: rgba(239, 68, 68, 0.25);
      }
      .btn-delete:hover {
        background: rgba(239, 68, 68, 0.1);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-flow-list": FlowList;
  }
}
