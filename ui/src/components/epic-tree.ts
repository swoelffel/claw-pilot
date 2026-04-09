// ui/src/components/epic-tree.ts
// Epic Tree — collapsible tree view showing epics with children and progress.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { fetchEpicChildren } from "../api.js";
import type { TaskInfo, EpicInfo } from "../types.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-epic-tree")
export class EpicTree extends LitElement {
  @property({ type: String }) slug = "";
  @property({ type: Array }) epics: EpicInfo[] = [];

  @state() private _expanded = new Set<number>();
  @state() private _children = new Map<number, TaskInfo[]>();

  private async _toggleExpand(epicId: number): Promise<void> {
    if (this._expanded.has(epicId)) {
      this._expanded.delete(epicId);
      this._expanded = new Set(this._expanded);
    } else {
      this._expanded.add(epicId);
      this._expanded = new Set(this._expanded);
      if (!this._children.has(epicId)) {
        const children = await fetchEpicChildren(this.slug, epicId);
        this._children.set(epicId, children);
        this._children = new Map(this._children);
      }
    }
  }

  private _selectTask(taskId: number): void {
    this.dispatchEvent(
      new CustomEvent("task-selected", {
        detail: { taskId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (this.epics.length === 0) {
      return html`<div class="empty">${msg("No epics yet", { id: "epic-tree-empty" })}</div>`;
    }

    return html` <div class="tree">${this.epics.map((epic) => this._renderEpic(epic))}</div> `;
  }

  private _renderEpic(epic: EpicInfo) {
    const isExpanded = this._expanded.has(epic.id);
    const children = this._children.get(epic.id) ?? [];
    const pct =
      epic.progress.total > 0
        ? Math.round((epic.progress.completed / epic.progress.total) * 100)
        : 0;

    return html`
      <div class="epic-row">
        <div class="epic-header" @click=${() => void this._toggleExpand(epic.id)}>
          <span class="expand-icon">${isExpanded ? "▼" : "▶"}</span>
          <span
            class="epic-title"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._selectTask(epic.id);
            }}
          >
            ${epic.title}
          </span>
          <span class="badge priority-${epic.priority}">${epic.priority}</span>
          <span class="badge status-${epic.status}">${epic.status}</span>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${pct}%"></div>
          </div>
          <span class="progress-text">${epic.progress.completed}/${epic.progress.total}</span>
        </div>
        ${isExpanded
          ? html`
              <div class="children">
                ${children.length > 0
                  ? children.map((child) => this._renderChild(child))
                  : html`<div class="no-children">
                      ${msg("No subtasks", { id: "epic-tree-no-children" })}
                    </div>`}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderChild(child: TaskInfo) {
    const statusIcon =
      child.status === "completed"
        ? "✓"
        : child.status === "cancelled"
          ? "✗"
          : child.status === "blocked"
            ? "⛔"
            : child.status === "in_progress"
              ? "●"
              : "○";

    return html`
      <div class="child-row" @click=${() => this._selectTask(child.id)}>
        <span class="child-status">${statusIcon}</span>
        <span class="child-title">${child.title}</span>
        <span class="badge priority-${child.priority}">${child.priority}</span>
        ${child.assigneeId
          ? html`<span class="child-assignee">${child.assigneeId}</span>`
          : nothing}
      </div>
    `;
  }

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        padding: var(--space-2);
      }
      .empty {
        text-align: center;
        padding: 48px;
        color: var(--text-muted);
        font-size: 14px;
      }
      .tree {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .epic-row {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
      }
      .epic-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
      }
      .epic-header:hover {
        background: var(--bg-hover);
      }
      .expand-icon {
        font-size: 10px;
        color: var(--text-muted);
        width: 12px;
        flex-shrink: 0;
      }
      .epic-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .epic-title:hover {
        text-decoration: underline;
        color: var(--accent);
      }
      .badge {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
      }
      .priority-critical {
        background: var(--state-error);
        color: #fff;
      }
      .priority-high {
        background: var(--state-warning);
        color: #000;
      }
      .priority-medium {
        background: var(--bg-border);
        color: var(--text-secondary);
      }
      .priority-low {
        background: var(--bg-base);
        color: var(--text-muted);
      }
      .status-pending {
        background: var(--bg-base);
        color: var(--text-muted);
      }
      .status-in_progress {
        background: var(--accent-subtle);
        color: var(--accent);
      }
      .status-completed {
        background: var(--state-success);
        color: #fff;
      }
      .status-blocked {
        background: var(--state-error);
        color: #fff;
      }
      .status-cancelled {
        background: var(--bg-base);
        color: var(--text-muted);
      }

      .progress-bar {
        width: 80px;
        height: 6px;
        background: var(--bg-base);
        border-radius: 3px;
        overflow: hidden;
        flex-shrink: 0;
      }
      .progress-fill {
        height: 100%;
        background: var(--state-success);
        border-radius: 3px;
        transition: width 0.3s ease;
      }
      .progress-text {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        width: 32px;
        text-align: right;
        flex-shrink: 0;
      }

      .children {
        border-top: 1px solid var(--bg-border);
        padding: 4px 12px 8px 32px;
      }
      .child-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 13px;
      }
      .child-row:hover {
        background: var(--bg-hover);
      }
      .child-status {
        font-size: 12px;
        width: 16px;
        text-align: center;
        flex-shrink: 0;
      }
      .child-title {
        flex: 1;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .child-assignee {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        background: var(--bg-base);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
      }
      .no-children {
        padding: 8px;
        color: var(--text-muted);
        font-size: 12px;
        font-style: italic;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-epic-tree": EpicTree;
  }
}
