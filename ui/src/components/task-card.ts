// ui/src/components/task-card.ts
// Kanban card — small draggable card for rendering inside board columns.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import type { TaskInfo } from "../types.js";
import {
  acquireSessionActivityStore,
  releaseSessionActivityStore,
  type SessionActivityState,
  type SessionActivityStore,
} from "../services/session-activity-store.js";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--state-error)",
  high: "var(--state-warning)",
  medium: "var(--text-secondary)",
  low: "var(--text-muted)",
};

@localized()
@customElement("cp-task-card")
export class TaskCard extends LitElement {
  @property({ type: Object }) task!: TaskInfo;
  /** Instance slug — required for the live activity indicator when status is in_progress. */
  @property({ type: String }) slug = "";

  @state() private _activity: SessionActivityState | undefined = undefined;

  private _store: SessionActivityStore | null = null;
  private _unsubActivity: (() => void) | null = null;
  private _subscribedSlug: string | null = null;
  private _subscribedSessionId: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._syncActivitySubscription();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardownActivitySubscription();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("task") || changed.has("slug")) {
      this._syncActivitySubscription();
    }
  }

  /**
   * Open (or reopen) the activity subscription for the current (slug, sessionId)
   * pair. Only active while the task is in_progress AND a session is linked.
   */
  private _syncActivitySubscription(): void {
    const sessionId = this._isLive() ? (this.task.sessionId ?? null) : null;
    const slug = this.slug || null;

    if (slug === this._subscribedSlug && sessionId === this._subscribedSessionId) return;

    this._teardownActivitySubscription();

    if (!slug || !sessionId) return;

    this._store = acquireSessionActivityStore(slug);
    this._subscribedSlug = slug;
    this._subscribedSessionId = sessionId;
    // Seed with the current snapshot so there's no flicker on mount.
    this._activity = this._store.get(sessionId);
    this._unsubActivity = this._store.subscribe(sessionId, (state) => {
      this._activity = state;
    });
  }

  private _teardownActivitySubscription(): void {
    if (this._unsubActivity) {
      this._unsubActivity();
      this._unsubActivity = null;
    }
    if (this._subscribedSlug) {
      releaseSessionActivityStore(this._subscribedSlug);
    }
    this._store = null;
    this._subscribedSlug = null;
    this._subscribedSessionId = null;
    this._activity = undefined;
  }

  private _isLive(): boolean {
    return this.task.status === "in_progress";
  }

  override render() {
    const t = this.task;
    const labels: string[] = t.labels ?? [];
    return html`
      <div
        class="card ${this._activity ? "card-active" : ""}"
        draggable="true"
        @dragstart=${this._onDragStart}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("task-selected", {
              detail: { taskId: t.id },
              bubbles: true,
              composed: true,
            }),
          )}
      >
        <div class="card-title">${t.title}</div>
        ${this._activity ? this._renderActivity(this._activity) : nothing}
        <div class="card-meta">
          <span
            class="priority"
            style="color: ${PRIORITY_COLORS[t.priority] ?? "var(--text-muted)"}"
          >
            ${t.priority}
          </span>
          ${t.assigneeId ? html`<span class="assignee">${t.assigneeId}</span>` : nothing}
          ${t.parentId ? html`<span class="epic-tag">E</span>` : nothing}
        </div>
        ${labels.length > 0
          ? html`<div class="labels">
              ${labels.map((l) => html`<span class="label">${l}</span>`)}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderActivity(a: SessionActivityState) {
    const seconds = Math.max(0, Math.floor((Date.now() - a.since) / 1000));
    const tooltip = `${msg("active", { id: "task-activity-active" })} ${seconds}s`;
    return html`
      <div class="activity" title=${tooltip}>
        <span class="activity-dot" aria-hidden="true"></span>
        ${a.kind === "tool"
          ? html`<span class="activity-label">
              ${msg("running", { id: "task-activity-running" })}
              <code>${a.toolName}</code>
            </span>`
          : html`<span class="activity-label">
              ${msg("thinking…", { id: "task-activity-thinking" })}
            </span>`}
      </div>
    `;
  }

  private _onDragStart(e: DragEvent): void {
    e.dataTransfer?.setData("text/plain", String(this.task.id));
    e.dataTransfer!.effectAllowed = "move";
    this.dispatchEvent(
      new CustomEvent("task-drag-start", {
        detail: { taskId: this.task.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .card {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        cursor: grab;
        transition:
          box-shadow 0.15s,
          border-color 0.15s;
      }
      .card:hover {
        border-color: var(--accent-border);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .card:active {
        cursor: grabbing;
      }
      .card-active {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent-border);
      }
      .card-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 6px;
        line-height: 1.3;
      }
      .activity {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        font-size: 11px;
        color: var(--accent);
        font-family: var(--font-mono);
      }
      .activity-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--accent);
        animation: cp-task-activity-pulse 1.2s ease-in-out infinite;
      }
      .activity-label {
        letter-spacing: 0.02em;
      }
      @keyframes cp-task-activity-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.4;
          transform: scale(0.85);
        }
      }
      .card-meta {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 11px;
      }
      .priority {
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .assignee {
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 10px;
      }
      .labels {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .label {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        background: var(--accent-subtle);
        color: var(--accent);
        border: 1px solid var(--accent-border);
      }
      .epic-tag {
        font-size: 9px;
        font-weight: 700;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        background: var(--accent-subtle);
        color: var(--accent);
        border: 1px solid var(--accent-border);
        margin-left: auto;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-task-card": TaskCard;
  }
}
