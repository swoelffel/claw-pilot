// ui/src/components/task-card.ts
// Kanban card — small draggable card for rendering inside board columns.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tokenStyles } from "../styles/tokens.js";
import type { TaskInfo } from "../types.js";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--state-error)",
  high: "var(--state-warning)",
  medium: "var(--text-secondary)",
  low: "var(--text-muted)",
};

@customElement("cp-task-card")
export class TaskCard extends LitElement {
  @property({ type: Object }) task!: TaskInfo;

  override render() {
    const t = this.task;
    const labels: string[] = t.labels ?? [];
    return html`
      <div
        class="card"
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
      .card-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 6px;
        line-height: 1.3;
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
