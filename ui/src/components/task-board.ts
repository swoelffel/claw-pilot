// ui/src/components/task-board.ts
// Task Board — Kanban view with drag & drop between columns.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { fetchTasks, fetchEpics, createTaskApi, changeTaskStatusApi } from "../api.js";
import type { TaskInfo, EpicInfo } from "../types.js";
import "./task-card.js";
import "./task-detail.js";
import "./epic-tree.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ColumnId = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const REFRESH_MS = 30_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-task-board")
export class TaskBoard extends LitElement {
  @property({ type: String }) slug = "";

  @state() private _tasks: TaskInfo[] = [];
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _selectedTaskId: number | null = null;
  @state() private _dragOverColumn: ColumnId | null = null;
  @state() private _showCreateForm = false;
  @state() private _newTitle = "";
  @state() private _newPriority = "medium";
  @state() private _newType: "epic" | "task" = "task";
  @state() private _newParentId: number | null = null;
  @state() private _viewMode: "board" | "epics" = "board";
  @state() private _epics: EpicInfo[] = [];

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

  private async _load(): Promise<void> {
    if (!this.slug) return;
    try {
      const [tasks, epics] = await Promise.all([fetchTasks(this.slug), fetchEpics(this.slug)]);
      this._tasks = tasks;
      this._epics = epics;
      if (this._loading) this._loading = false;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._loading = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------------------

  private _onDragOver(e: DragEvent, columnId: ColumnId): void {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    this._dragOverColumn = columnId;
  }

  private _onDragLeave(_e: DragEvent, columnId: ColumnId): void {
    if (this._dragOverColumn === columnId) this._dragOverColumn = null;
  }

  private async _onDrop(e: DragEvent, columnId: ColumnId): Promise<void> {
    e.preventDefault();
    this._dragOverColumn = null;
    const taskId = Number(e.dataTransfer?.getData("text/plain"));
    if (!taskId) return;

    const task = this._tasks.find((t) => t.id === taskId);
    if (!task || task.status === columnId) return;

    // Calculate position: append at end of target column
    const colTasks = this._tasks.filter((t) => t.status === columnId);
    const maxPos = colTasks.length > 0 ? Math.max(...colTasks.map((t) => t.position)) : 0;
    const newPosition = maxPos + 100;

    // Optimistic update
    const snapshot = [...this._tasks];
    this._tasks = this._tasks.map((t) =>
      t.id === taskId ? { ...t, status: columnId, position: newPosition } : t,
    );

    try {
      await changeTaskStatusApi(this.slug, taskId, columnId, newPosition);
    } catch {
      // Revert on failure
      this._tasks = snapshot;
    }
  }

  // ---------------------------------------------------------------------------
  // Create task
  // ---------------------------------------------------------------------------

  private async _createTask(): Promise<void> {
    if (!this._newTitle.trim()) return;
    try {
      await createTaskApi(this.slug, {
        title: this._newTitle.trim(),
        priority: this._newPriority,
        type: this._newType,
        ...(this._newParentId !== null ? { parentId: this._newParentId } : {}),
      });
      this._newTitle = "";
      this._newPriority = "medium";
      this._newType = "task";
      this._newParentId = null;
      this._showCreateForm = false;
      void this._load();
    } catch {
      // silent
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private _goBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { slug: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  override render() {
    if (this._loading) {
      return html`<div class="loading">
        ${msg("Loading tasks...", { id: "task-board-loading" })}
      </div>`;
    }

    return html`
      <div class="header">
        <button class="btn-back" @click=${this._goBack}>
          ← ${msg("Back", { id: "task-board-back" })}
        </button>
        <div class="title">${msg("Tasks", { id: "task-board-title" })} — ${this.slug}</div>
        <div class="view-toggle">
          <button
            class="btn-toggle ${this._viewMode === "board" ? "active" : ""}"
            @click=${() => (this._viewMode = "board")}
          >
            ${msg("Board", { id: "task-board-view-board" })}
          </button>
          <button
            class="btn-toggle ${this._viewMode === "epics" ? "active" : ""}"
            @click=${() => (this._viewMode = "epics")}
          >
            ${msg("Epics", { id: "task-board-view-epics" })}
          </button>
        </div>
        <button class="btn-new" @click=${() => (this._showCreateForm = !this._showCreateForm)}>
          + ${msg("New Task", { id: "task-board-new" })}
        </button>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${this._showCreateForm ? this._renderCreateForm() : nothing}

      <div class="board ${this._selectedTaskId !== null ? "with-detail" : ""}">
        ${this._viewMode === "board"
          ? html`<div class="columns">
              ${COLUMNS.map((col) => this._renderColumn(col.id, col.label))}
            </div>`
          : html`<div class="epics-container">
              <cp-epic-tree
                .slug=${this.slug}
                .epics=${this._epics}
                @task-selected=${(e: CustomEvent<{ taskId: number }>) =>
                  (this._selectedTaskId = e.detail.taskId)}
                @refresh=${() => void this._load()}
              ></cp-epic-tree>
            </div>`}
        ${this._selectedTaskId !== null
          ? html`
              <div class="detail-pane">
                <cp-task-detail
                  .slug=${this.slug}
                  .taskId=${this._selectedTaskId}
                  @close=${() => (this._selectedTaskId = null)}
                  @task-updated=${() => void this._load()}
                  @task-deleted=${() => {
                    this._selectedTaskId = null;
                    void this._load();
                  }}
                  @task-status-change=${(e: CustomEvent<{ taskId: number; status: string }>) => {
                    void changeTaskStatusApi(this.slug, e.detail.taskId, e.detail.status).then(
                      () => void this._load(),
                    );
                  }}
                  @navigate=${(e: Event) =>
                    this.dispatchEvent(
                      new CustomEvent("navigate", {
                        detail: (e as CustomEvent).detail,
                        bubbles: true,
                        composed: true,
                      }),
                    )}
                ></cp-task-detail>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderColumn(columnId: ColumnId, label: string) {
    const tasks = this._tasks
      .filter((t) => t.status === columnId && t.type === "task")
      .sort((a, b) => a.position - b.position);
    const isDragOver = this._dragOverColumn === columnId;

    return html`
      <div
        class="column ${isDragOver ? "drag-over" : ""}"
        @dragover=${(e: DragEvent) => this._onDragOver(e, columnId)}
        @dragleave=${(e: DragEvent) => this._onDragLeave(e, columnId)}
        @drop=${(e: DragEvent) => void this._onDrop(e, columnId)}
      >
        <div class="column-header">
          <span class="column-label">${label}</span>
          <span class="column-count">${tasks.length}</span>
        </div>
        <div class="column-body">
          ${tasks.map(
            (t) => html`
              <cp-task-card
                .task=${t}
                @task-selected=${(e: CustomEvent<{ taskId: number }>) =>
                  (this._selectedTaskId = e.detail.taskId)}
              ></cp-task-card>
            `,
          )}
          ${tasks.length === 0
            ? html`<div class="empty-col">${msg("No tasks", { id: "task-board-empty-col" })}</div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderCreateForm() {
    return html`
      <div class="create-form">
        <select
          @change=${(e: Event) => {
            this._newType = (e.target as HTMLSelectElement).value as "epic" | "task";
            if (this._newType === "epic") this._newParentId = null;
          }}
        >
          <option value="task" ?selected=${this._newType === "task"}>
            ${msg("Task", { id: "task-type-task" })}
          </option>
          <option value="epic" ?selected=${this._newType === "epic"}>
            ${msg("Epic", { id: "task-type-epic" })}
          </option>
        </select>
        <input
          type="text"
          placeholder=${msg("Task title...", { id: "task-board-title-placeholder" })}
          .value=${this._newTitle}
          @input=${(e: Event) => (this._newTitle = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") void this._createTask();
          }}
        />
        <select
          .value=${this._newPriority}
          @change=${(e: Event) => (this._newPriority = (e.target as HTMLSelectElement).value)}
        >
          <option value="low">${msg("Low", { id: "task-priority-low" })}</option>
          <option value="medium">${msg("Medium", { id: "task-priority-medium" })}</option>
          <option value="high">${msg("High", { id: "task-priority-high" })}</option>
          <option value="critical">${msg("Critical", { id: "task-priority-critical" })}</option>
        </select>
        ${this._newType === "task" && this._epics.length > 0
          ? html`
              <select
                @change=${(e: Event) => {
                  const val = (e.target as HTMLSelectElement).value;
                  this._newParentId = val ? Number(val) : null;
                }}
              >
                <option value="" ?selected=${this._newParentId === null}>
                  ${msg("None", { id: "task-no-parent" })}
                </option>
                ${this._epics.map(
                  (ep) => html`
                    <option value=${ep.id} ?selected=${this._newParentId === ep.id}>
                      ${ep.title}
                    </option>
                  `,
                )}
              </select>
            `
          : nothing}
        <button class="btn-create" @click=${() => void this._createTask()}>
          ${msg("Create", { id: "task-board-create" })}
        </button>
        <button class="btn-cancel" @click=${() => (this._showCreateForm = false)}>
          ${msg("Cancel", { id: "task-board-cancel" })}
        </button>
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
      .btn-back {
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        padding: 4px 12px;
        cursor: pointer;
        font-size: 13px;
      }
      .btn-back:hover {
        background: var(--bg-hover);
        color: var(--accent);
        border-color: var(--accent-border);
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
      .view-toggle {
        display: flex;
        gap: 0;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      .btn-toggle {
        padding: 4px 12px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .btn-toggle.active {
        background: var(--accent);
        color: #fff;
      }
      .btn-toggle:not(.active):hover {
        background: var(--bg-hover);
      }
      .epics-container {
        flex: 1;
        overflow-y: auto;
      }
      .loading {
        text-align: center;
        padding: 48px;
        color: var(--text-muted);
      }
      .error {
        color: var(--state-error);
        margin-bottom: 12px;
        font-size: 13px;
      }

      /* Create form */
      .create-form {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        padding: 12px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
      }
      .create-form input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        color: var(--text-primary);
        font-size: 13px;
      }
      .create-form select {
        padding: 6px 8px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        color: var(--text-primary);
        font-size: 12px;
      }
      .btn-create {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid var(--accent-border);
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .btn-cancel {
        padding: 6px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 12px;
      }

      /* Board layout */
      .board {
        display: flex;
        gap: 0;
        height: calc(100% - 100px);
        min-height: 400px;
      }
      .board.with-detail .columns {
        flex: 1;
      }
      .board.with-detail .detail-pane {
        width: 360px;
        flex-shrink: 0;
        border-left: 1px solid var(--bg-border);
        background: var(--bg-surface);
        overflow-y: auto;
      }
      .columns {
        display: flex;
        gap: 12px;
        flex: 1;
        overflow-x: auto;
      }

      /* Column */
      .column {
        flex: 1;
        min-width: 200px;
        max-width: 280px;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        transition:
          border-color 0.15s,
          background 0.15s;
      }
      .column.drag-over {
        border-color: var(--accent);
        background: var(--accent-subtle);
      }
      .column-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--bg-border);
      }
      .column-label {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-muted);
        letter-spacing: 0.5px;
      }
      .column-count {
        font-size: 11px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        background: var(--bg-surface);
        border-radius: var(--radius-sm);
        padding: 1px 6px;
      }
      .column-body {
        flex: 1;
        padding: 8px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .empty-col {
        text-align: center;
        padding: 24px 8px;
        color: var(--text-muted);
        font-size: 12px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-task-board": TaskBoard;
  }
}
