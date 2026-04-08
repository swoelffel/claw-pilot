// ui/src/components/task-detail.ts
// Task detail slide-in panel — full task info + comments.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import {
  fetchTaskDetail,
  updateTaskApi,
  addTaskCommentApi,
  fetchAgents,
  deleteTaskApi,
} from "../api.js";
import type { TaskDetail as TaskDetailType, TaskComment } from "../types.js";

@localized()
@customElement("cp-task-detail")
export class TaskDetailPanel extends LitElement {
  @property({ type: String }) slug = "";
  @property({ type: Number }) taskId = 0;

  @state() private _task: TaskDetailType | null = null;
  @state() private _loading = true;
  @state() private _newComment = "";
  @state() private _agents: Array<{ agent_id: string; name: string }> = [];
  @state() private _selectedAgent = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("taskId") && this.taskId > 0) void this._load();
  }

  private async _load(): Promise<void> {
    if (!this.slug || !this.taskId) return;
    this._loading = true;
    try {
      const [task, agents] = await Promise.all([
        fetchTaskDetail(this.slug, this.taskId),
        this._agents.length === 0 ? fetchAgents(this.slug) : Promise.resolve(this._agents),
      ]);
      this._task = task;
      this._agents = agents;
      this._selectedAgent = task.assigneeId ?? "";
    } catch {
      this._task = null;
    } finally {
      this._loading = false;
    }
  }

  private async _updateField(field: string, value: unknown): Promise<void> {
    if (!this._task) return;
    try {
      await updateTaskApi(this.slug, this._task.id, { [field]: value });
      void this._load();
      this.dispatchEvent(new CustomEvent("task-updated", { bubbles: true, composed: true }));
    } catch (err) {
      console.error("[cp-task-detail] _updateField failed:", field, value, err);
    }
  }

  private async _addComment(): Promise<void> {
    if (!this._task || !this._newComment.trim()) return;
    try {
      await addTaskCommentApi(this.slug, this._task.id, this._newComment.trim());
      this._newComment = "";
      void this._load();
    } catch {
      // silent
    }
  }

  private async _delete(): Promise<void> {
    if (!this._task) return;
    try {
      await deleteTaskApi(this.slug, this._task.id);
      this.dispatchEvent(new CustomEvent("task-deleted", { bubbles: true, composed: true }));
    } catch {
      // silent
    }
  }

  override render() {
    if (this._loading)
      return html`<div class="center">${msg("Loading...", { id: "task-loading" })}</div>`;
    if (!this._task)
      return html`<div class="center">${msg("Task not found", { id: "task-not-found" })}</div>`;

    const t = this._task;
    return html`
      <div class="panel">
        <div class="panel-header">
          <span class="task-id">#${t.id}</span>
          <div class="header-actions">
            ${t.status === "pending" || t.status === "cancelled"
              ? html`<button
                  class="btn-delete"
                  @click=${() => void this._delete()}
                  title=${msg("Delete task", { id: "task-delete" })}
                >
                  🗑
                </button>`
              : nothing}
            <button
              class="btn-close"
              @click=${() =>
                this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }))}
            >
              ✕
            </button>
          </div>
        </div>

        <div class="field">
          <label>${msg("Title", { id: "task-field-title" })}</label>
          <input
            type="text"
            .value=${t.title}
            @change=${(e: Event) =>
              void this._updateField("title", (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="field-row">
          <div class="field">
            <label>${msg("Status", { id: "task-field-status" })}</label>
            <select
              .value=${t.status}
              @change=${(e: Event) => {
                const status = (e.target as HTMLSelectElement).value;
                this.dispatchEvent(
                  new CustomEvent("task-status-change", {
                    detail: { taskId: t.id, status },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
            >
              <option value="pending">${msg("Pending", { id: "task-status-pending" })}</option>
              <option value="in_progress">
                ${msg("In Progress", { id: "task-status-in-progress" })}
              </option>
              <option value="blocked">${msg("Blocked", { id: "task-status-blocked" })}</option>
              <option value="completed">
                ${msg("Completed", { id: "task-status-completed" })}
              </option>
              <option value="cancelled">
                ${msg("Cancelled", { id: "task-status-cancelled" })}
              </option>
            </select>
          </div>
          <div class="field">
            <label>${msg("Priority", { id: "task-field-priority" })}</label>
            <select
              .value=${t.priority}
              @change=${(e: Event) =>
                void this._updateField("priority", (e.target as HTMLSelectElement).value)}
            >
              <option value="low">${msg("Low", { id: "task-priority-low" })}</option>
              <option value="medium">${msg("Medium", { id: "task-priority-medium" })}</option>
              <option value="high">${msg("High", { id: "task-priority-high" })}</option>
              <option value="critical">${msg("Critical", { id: "task-priority-critical" })}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>${msg("Assignee", { id: "task-field-assignee" })}</label>
          <div class="assign-row">
            <select
              @change=${(e: Event) => {
                this._selectedAgent = (e.target as HTMLSelectElement).value;
              }}
            >
              <option value="" ?selected=${!this._selectedAgent}>
                ${msg("Unassigned", { id: "task-unassigned" })}
              </option>
              ${this._agents.map(
                (a) =>
                  html`<option value=${a.agent_id} ?selected=${this._selectedAgent === a.agent_id}>
                    ${a.name} (${a.agent_id})
                  </option>`,
              )}
            </select>
            ${this._selectedAgent !== (t.assigneeId ?? "")
              ? html`<button
                  class="btn-assign"
                  @click=${() => void this._updateField("assigneeId", this._selectedAgent || null)}
                >
                  ${msg("Assign", { id: "task-assign" })}
                </button>`
              : nothing}
          </div>
          ${t.sessionId
            ? html`<a
                class="session-link"
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent("navigate", {
                      detail: { view: "session-logs", slug: this.slug },
                      bubbles: true,
                      composed: true,
                    }),
                  )}
              >
                ${msg("View session", { id: "task-view-session" })}
              </a>`
            : nothing}
        </div>

        <div class="field">
          <label>${msg("Description", { id: "task-field-description" })}</label>
          <textarea
            rows="3"
            .value=${t.description ?? ""}
            @change=${(e: Event) =>
              void this._updateField("description", (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div class="field">
          <label>${msg("Created", { id: "task-field-created" })}</label>
          <span class="meta"
            >${t.createdAt.slice(0, 16)} ${msg("by", { id: "task-by" })} ${t.createdBy}</span
          >
        </div>

        <div class="comments-section">
          <label>${msg("Comments", { id: "task-field-comments" })} (${t.comments.length})</label>
          <div class="comments-list">
            ${t.comments.map(
              (c: TaskComment) => html`
                <div class="comment">
                  <span class="comment-author">${c.authorId}</span>
                  <span class="comment-date">${c.createdAt.slice(5, 16)}</span>
                  <div class="comment-content">${c.content}</div>
                </div>
              `,
            )}
          </div>
          <div class="comment-input">
            <input
              type="text"
              placeholder=${msg("Add a comment...", { id: "task-comment-placeholder" })}
              .value=${this._newComment}
              @input=${(e: Event) => (this._newComment = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this._addComment();
              }}
            />
            <button class="btn-send" @click=${() => void this._addComment()}>
              ${msg("Send", { id: "task-comment-send" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
      }
      .center {
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
      }
      .panel {
        padding: 16px;
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .header-actions {
        display: flex;
        gap: 4px;
        align-items: center;
        margin-bottom: 16px;
      }
      .task-id {
        font-family: var(--font-mono);
        font-size: 14px;
        color: var(--text-muted);
      }
      .btn-delete {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
      }
      .btn-delete:hover {
        color: var(--state-error);
      }
      .assign-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .assign-row select {
        flex: 1;
      }
      .btn-assign {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid var(--accent-border);
        background: var(--accent-subtle);
        color: var(--accent);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .btn-assign:hover {
        background: var(--accent);
        color: var(--bg-base);
      }
      .btn-close {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 16px;
        padding: 4px 8px;
      }
      .btn-close:hover {
        color: var(--text-primary);
      }
      .field {
        margin-bottom: 12px;
      }
      .field label {
        display: block;
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .field-row {
        display: flex;
        gap: 12px;
      }
      .field-row .field {
        flex: 1;
      }
      .field input[type="text"],
      .field textarea,
      .field select {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        color: var(--text-primary);
        font-size: 13px;
        box-sizing: border-box;
        font-family: inherit;
      }
      .field textarea {
        resize: vertical;
      }
      .mono {
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--text-secondary);
      }
      .meta {
        font-size: 12px;
        color: var(--text-muted);
      }
      .session-link {
        font-size: 11px;
        color: var(--accent);
        cursor: pointer;
        margin-left: 8px;
      }
      .session-link:hover {
        text-decoration: underline;
      }
      .comments-section {
        margin-top: 16px;
        border-top: 1px solid var(--bg-border);
        padding-top: 12px;
      }
      .comments-section > label {
        display: block;
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
      .comments-list {
        max-height: 200px;
        overflow-y: auto;
        margin-bottom: 8px;
      }
      .comment {
        padding: 6px 0;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
      }
      .comment-author {
        font-family: var(--font-mono);
        font-weight: 600;
        color: var(--text-secondary);
        margin-right: 6px;
      }
      .comment-date {
        color: var(--text-muted);
        font-size: 10px;
      }
      .comment-content {
        margin-top: 2px;
        color: var(--text-secondary);
        line-height: 1.4;
      }
      .comment-input {
        display: flex;
        gap: 6px;
      }
      .comment-input input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-base);
        color: var(--text-primary);
        font-size: 12px;
      }
      .btn-send {
        padding: 6px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--accent-border);
        background: transparent;
        color: var(--accent);
        cursor: pointer;
        font-size: 12px;
      }
      .btn-send:hover {
        background: var(--accent-subtle);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-task-detail": TaskDetailPanel;
  }
}
