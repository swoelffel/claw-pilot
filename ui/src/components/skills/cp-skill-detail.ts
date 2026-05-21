// ui/src/components/skills/cp-skill-detail.ts
//
// SKILLS-002 — structured skill detail page.
// Two-column layout: sidebar (file list + assigned agents) + editor pane.
// Routes: /instances/:slug/skills/:id
//
// File-tree decision: flat sorted list (v1) — no nested rendering. Spec §3.3
// allows this; nested tree-building can come later if needed.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../../styles/shared.js";
import {
  getStructuredSkill,
  upsertStructuredSkillFile,
  deleteStructuredSkillFile,
  assignStructuredSkillToAgent,
  unassignStructuredSkillFromAgent,
  deleteStructuredSkill,
  downloadStructuredSkillExport,
  fetchAgents,
  type StructuredSkillFile,
  type StructuredSkillRecord,
} from "../../api.js";
import { userMessage } from "../../lib/error-messages.js";

interface AgentSummary {
  agent_id: string;
  name: string;
}

@localized()
@customElement("cp-skill-detail")
export class CpSkillDetail extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        padding: 16px 20px;
        font-family: var(--font-ui);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
        gap: 12px;
      }
      .breadcrumb {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: var(--text-muted);
        flex: 1;
        min-width: 0;
      }
      .breadcrumb a {
        color: var(--accent);
        cursor: pointer;
        text-decoration: none;
      }
      .breadcrumb a:hover {
        text-decoration: underline;
      }
      .breadcrumb .name {
        color: var(--text-primary);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .header-actions {
        display: flex;
        gap: 8px;
      }
      .icon-btn {
        background: none;
        border: 1px solid var(--bg-border);
        color: var(--text-primary);
        cursor: pointer;
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        font-size: 13px;
      }
      .icon-btn:hover {
        background: var(--bg-hover);
      }
      .icon-btn.danger {
        color: var(--text-danger, #d44);
      }

      .layout {
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 16px;
        min-height: 60vh;
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
      .panel {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .panel-head {
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .panel-body {
        max-height: 50vh;
        overflow-y: auto;
        padding: 4px 0;
      }
      .file-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-primary);
        border-left: 2px solid transparent;
      }
      .file-row:hover {
        background: var(--bg-hover);
      }
      .file-row.active {
        background: var(--bg-hover);
        border-left-color: var(--accent);
        color: var(--accent);
      }
      .file-row .file-path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-row .file-del {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        font-size: 12px;
        padding: 0 4px;
      }
      .file-row:hover .file-del {
        opacity: 1;
      }
      .file-row .file-del:hover {
        color: var(--text-danger, #d44);
      }
      .file-row .file-del[disabled] {
        opacity: 0.2;
        cursor: not-allowed;
      }

      .agent-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        font-size: 12px;
        cursor: pointer;
      }
      .agent-row:hover {
        background: var(--bg-hover);
      }
      .agent-row input[type="checkbox"] {
        cursor: pointer;
      }
      .agent-row .agent-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .editor {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .editor-head {
        padding: 10px 14px;
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .editor-head .path {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }
      .editor-body {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      textarea {
        flex: 1;
        width: 100%;
        min-height: 50vh;
        padding: 12px 14px;
        background: var(--bg-base);
        color: var(--text-primary);
        border: none;
        outline: none;
        resize: vertical;
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre;
        overflow: auto;
        box-sizing: border-box;
      }
      .editor-empty {
        padding: 32px;
        text-align: center;
        color: var(--text-muted);
        font-size: 13px;
      }
      .save-error {
        margin: 8px 14px 0;
      }
      .add-btn {
        background: none;
        border: 1px solid var(--bg-border);
        color: var(--text-primary);
        cursor: pointer;
        padding: 1px 8px;
        border-radius: var(--radius-sm);
        font-size: 12px;
      }
      .add-btn:hover {
        background: var(--bg-hover);
      }
      .new-file-form {
        padding: 8px 12px;
        display: flex;
        gap: 6px;
        border-bottom: 1px solid var(--bg-border);
      }
      .new-file-form input {
        flex: 1;
        min-width: 0;
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        padding: 4px 8px;
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .empty-state {
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
        font-size: 12px;
      }
    `,
  ];

  // ── Properties ──────────────────────────────────────────────────────────

  @property({ type: String }) slug = "";
  @property({ type: String }) skillId = "";

  // ── State ───────────────────────────────────────────────────────────────

  @state() private _loading = true;
  @state() private _error = "";
  @state() private _skill: StructuredSkillRecord | null = null;
  @state() private _files: StructuredSkillFile[] = [];
  @state() private _assignedAgents: string[] = [];
  @state() private _allAgents: AgentSummary[] = [];

  @state() private _selectedPath = "";
  @state() private _draft = "";
  @state() private _dirty = false;
  @state() private _saving = false;
  @state() private _saveError = "";

  @state() private _newFileOpen = false;
  @state() private _newFilePath = "";

  // ── Lifecycle ───────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") || changed.has("skillId")) {
      void this._load();
    }
  }

  // ── Data loading ────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this.slug || !this.skillId) return;
    this._loading = true;
    this._error = "";
    try {
      const [detail, agents] = await Promise.all([
        getStructuredSkill(this.slug, this.skillId),
        fetchAgents(this.slug).catch(() => [] as AgentSummary[]),
      ]);
      this._skill = detail.skill;
      this._files = [...detail.files].sort((a, b) => a.path.localeCompare(b.path));
      this._assignedAgents = detail.agents;
      this._allAgents = agents;
      // Default selection: SKILL.md if present, else first file
      if (!this._selectedPath || !this._files.find((f) => f.path === this._selectedPath)) {
        const skillMd = this._files.find((f) => f.path === "SKILL.md");
        const target = skillMd ?? this._files[0];
        if (target) {
          this._selectedPath = target.path;
          this._draft = target.content;
          this._dirty = false;
          this._saveError = "";
        }
      } else {
        // Refresh draft from server if not dirty
        if (!this._dirty) {
          const refreshed = this._files.find((f) => f.path === this._selectedPath);
          if (refreshed) this._draft = refreshed.content;
        }
      }
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _refetchDetail(): Promise<void> {
    try {
      const detail = await getStructuredSkill(this.slug, this.skillId);
      this._skill = detail.skill;
      this._files = [...detail.files].sort((a, b) => a.path.localeCompare(b.path));
      this._assignedAgents = detail.agents;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  // ── File selection ──────────────────────────────────────────────────────

  private _selectFile(path: string): void {
    if (path === this._selectedPath) return;
    if (this._dirty) {
      const ok = window.confirm(
        msg("Discard unsaved changes?", { id: "skills-detail-discard-confirm" }),
      );
      if (!ok) return;
    }
    const file = this._files.find((f) => f.path === path);
    if (!file) return;
    this._selectedPath = path;
    this._draft = file.content;
    this._dirty = false;
    this._saveError = "";
  }

  private _onTextareaInput(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    this._draft = t.value;
    this._dirty = true;
    this._saveError = "";
  }

  private async _save(): Promise<void> {
    if (!this._selectedPath || this._saving) return;
    this._saving = true;
    this._saveError = "";
    try {
      const updated = await upsertStructuredSkillFile(
        this.slug,
        this.skillId,
        this._selectedPath,
        this._draft,
      );
      this._files = this._files
        .map((f) => (f.path === updated.path ? updated : f))
        .sort((a, b) => a.path.localeCompare(b.path));
      this._dirty = false;
    } catch (err) {
      this._saveError = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  // ── New file ────────────────────────────────────────────────────────────

  private _toggleNewFileForm(): void {
    this._newFileOpen = !this._newFileOpen;
    this._newFilePath = "";
    this._saveError = "";
  }

  private async _submitNewFile(): Promise<void> {
    const path = this._newFilePath.trim();
    if (!path) return;
    if (this._files.some((f) => f.path === path)) {
      this._saveError = msg("File already exists", { id: "skills-detail-file-exists" });
      return;
    }
    try {
      const created = await upsertStructuredSkillFile(this.slug, this.skillId, path, "");
      this._files = [...this._files, created].sort((a, b) => a.path.localeCompare(b.path));
      this._newFileOpen = false;
      this._newFilePath = "";
      this._selectedPath = created.path;
      this._draft = created.content;
      this._dirty = false;
    } catch (err) {
      this._saveError = userMessage(err);
    }
  }

  private async _deleteFile(path: string, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (path === "SKILL.md") return;
    const ok = window.confirm(
      `${msg("Delete file?", { id: "skills-detail-delete-file-confirm" })}\n\n${path}`,
    );
    if (!ok) return;
    try {
      await deleteStructuredSkillFile(this.slug, this.skillId, path);
      this._files = this._files.filter((f) => f.path !== path);
      if (this._selectedPath === path) {
        const fallback = this._files.find((f) => f.path === "SKILL.md") ?? this._files[0];
        if (fallback) {
          this._selectedPath = fallback.path;
          this._draft = fallback.content;
        } else {
          this._selectedPath = "";
          this._draft = "";
        }
        this._dirty = false;
      }
    } catch (err) {
      this._saveError = userMessage(err);
    }
  }

  // ── Agent assignment ────────────────────────────────────────────────────

  private async _toggleAgent(agentId: string, ev: Event): Promise<void> {
    const checked = (ev.target as HTMLInputElement).checked;
    try {
      if (checked) {
        await assignStructuredSkillToAgent(this.slug, this.skillId, agentId);
      } else {
        await unassignStructuredSkillFromAgent(this.slug, this.skillId, agentId);
      }
      await this._refetchDetail();
    } catch (err) {
      this._error = userMessage(err);
      // Revert checkbox visual
      (ev.target as HTMLInputElement).checked = !checked;
    }
  }

  // ── Header actions ──────────────────────────────────────────────────────

  private _goBack(): void {
    if (this._dirty) {
      const ok = window.confirm(
        msg("Discard unsaved changes?", { id: "skills-detail-discard-confirm" }),
      );
      if (!ok) return;
    }
    this.dispatchEvent(
      new CustomEvent("skill-closed", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _onExport(): Promise<void> {
    try {
      await downloadStructuredSkillExport(this.slug, this.skillId);
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private async _onDelete(): Promise<void> {
    const name = this._skill?.name ?? this.skillId;
    const ok = window.confirm(
      msg(`Delete skill "${name}"? This cannot be undone.`, {
        id: "skills-detail-confirm-delete",
      }),
    );
    if (!ok) return;
    try {
      await deleteStructuredSkill(this.slug, this.skillId);
      this.dispatchEvent(
        new CustomEvent("skill-closed", {
          detail: { deleted: true },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  override render() {
    if (this._loading && !this._skill) {
      return html`<div class="spinner"></div>`;
    }
    if (this._error && !this._skill) {
      return html`<div class="error-banner">${this._error}</div>`;
    }
    if (!this._skill) {
      return html`<div class="empty-state">
        ${msg("Skill not found", { id: "skills-detail-not-found" })}
      </div>`;
    }

    return html`
      <div class="header">
        <div class="breadcrumb">
          <a @click=${this._goBack}>← ${msg("Skills", { id: "skills-tab-title" })}</a>
          <span>/</span>
          <span class="name" title=${this._skill.name}>${this._skill.name}</span>
          ${this._skill.version
            ? html`<span style="font-family:var(--font-mono);color:var(--text-muted)"
                >v${this._skill.version}</span
              >`
            : nothing}
        </div>
        <div class="header-actions">
          <button class="icon-btn" @click=${this._onExport}>
            ${msg("Export ZIP", { id: "skills-detail-export-zip" })}
          </button>
          <button class="icon-btn danger" @click=${this._onDelete} title="Delete">🗑</button>
        </div>
      </div>

      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

      <div class="layout">
        <div class="sidebar">
          <div class="panel">
            <div class="panel-head">
              <span>${msg("Files", { id: "skills-detail-files" })}</span>
              <button class="add-btn" @click=${this._toggleNewFileForm} title="Add file">
                ${this._newFileOpen ? "×" : "+"}
              </button>
            </div>
            ${this._newFileOpen
              ? html`<div class="new-file-form">
                  <input
                    type="text"
                    placeholder="path/to/file.md"
                    .value=${this._newFilePath}
                    @input=${(e: Event) =>
                      (this._newFilePath = (e.target as HTMLInputElement).value)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") void this._submitNewFile();
                      if (e.key === "Escape") this._toggleNewFileForm();
                    }}
                  />
                  <button class="btn btn-primary" @click=${this._submitNewFile}>
                    ${msg("Add", { id: "skills-detail-add" })}
                  </button>
                </div>`
              : nothing}
            <div class="panel-body">
              ${this._files.length === 0
                ? html`<div class="empty-state">
                    ${msg("No files yet", { id: "skills-detail-no-files" })}
                  </div>`
                : this._files.map(
                    (f) => html`
                      <div
                        class="file-row ${this._selectedPath === f.path ? "active" : ""}"
                        @click=${() => this._selectFile(f.path)}
                      >
                        <span class="file-path" title=${f.path}>${f.path}</span>
                        <button
                          class="file-del"
                          @click=${(e: Event) => void this._deleteFile(f.path, e)}
                          ?disabled=${f.path === "SKILL.md"}
                          title=${f.path === "SKILL.md"
                            ? msg("SKILL.md cannot be deleted", {
                                id: "skills-detail-skillmd-immutable",
                              })
                            : msg("Delete file", { id: "skills-detail-delete-file" })}
                        >
                          🗑
                        </button>
                      </div>
                    `,
                  )}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              ${msg("Assigned agents", { id: "skills-detail-assigned-agents" })}
            </div>
            <div class="panel-body">
              ${this._allAgents.length === 0
                ? html`<div class="empty-state">
                    ${msg("No agents in this instance", { id: "skills-detail-no-agents" })}
                  </div>`
                : this._allAgents.map((a) => {
                    const checked = this._assignedAgents.includes(a.agent_id);
                    return html`
                      <label class="agent-row">
                        <input
                          type="checkbox"
                          .checked=${checked}
                          @change=${(e: Event) => void this._toggleAgent(a.agent_id, e)}
                        />
                        <span class="agent-name" title=${a.name}>${a.name}</span>
                      </label>
                    `;
                  })}
            </div>
          </div>
        </div>

        <div class="editor">
          ${this._selectedPath
            ? html`
                <div class="editor-head">
                  <span class="path">${this._selectedPath}</span>
                  <button
                    class="btn btn-primary"
                    ?disabled=${!this._dirty || this._saving}
                    @click=${this._save}
                  >
                    ${this._saving
                      ? msg("Saving…", { id: "skills-detail-saving" })
                      : msg("Save", { id: "skills-detail-save" })}
                  </button>
                </div>
                ${this._saveError
                  ? html`<div class="error-banner save-error">${this._saveError}</div>`
                  : nothing}
                <div class="editor-body">
                  <textarea
                    spellcheck="false"
                    .value=${this._draft}
                    @input=${this._onTextareaInput}
                  ></textarea>
                </div>
              `
            : html`<div class="editor-empty">
                ${msg("Select a file to edit", { id: "skills-detail-select-file" })}
              </div>`}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-skill-detail": CpSkillDetail;
  }
}
