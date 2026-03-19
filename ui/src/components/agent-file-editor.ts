// ui/src/components/agent-file-editor.ts
//
// Reusable file editor component used in:
//   - cp-agent-detail-panel  (instance & blueprint agent files)
//   - cp-agent-template-detail (agent blueprint template files)
//
// Usage:
//   <cp-agent-file-editor
//     .files=${["SOUL.md", "HEARTBEAT.md"]}
//     .activeFile=${"SOUL.md"}
//     .loadFile=${(filename) => fetchAgentFile(slug, agentId, filename)}
//     .saveFile=${(filename, content) => updateAgentFile(slug, agentId, filename, content)}
//     .editableFiles=${new Set(["SOUL.md", "HEARTBEAT.md"])}   <!-- omit for all-editable -->
//     @file-tab-change=${e => this._activeTab = e.detail.filename}
//   ></cp-agent-file-editor>
//
// The parent controls which file is selected via the `activeFile` property.
// The component emits `file-tab-change` when the user clicks a different tab,
// so the parent can react (e.g. update its own routing state or trigger a discard check
// before allowing the switch).
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { agentFileEditorStyles } from "../styles/agent-file-editor.styles.js";

@localized()
@customElement("cp-agent-file-editor")
export class AgentFileEditor extends LitElement {
  static override styles = [tokenStyles, agentFileEditorStyles];

  // ── Public properties ────────────────────────────────────────────────────

  /** List of filenames to show as tabs. */
  @property({ type: Array }) files: string[] = [];

  /**
   * Async function that loads a file's content.
   * Called once per file (results are cached internally).
   */
  @property({ attribute: false })
  loadFile: ((filename: string) => Promise<string>) | null = null;

  /**
   * Async function that persists a file's content.
   * Receives (filename, newContent).
   */
  @property({ attribute: false })
  saveFile: ((filename: string, content: string) => Promise<void>) | null = null;

  /**
   * Optional whitelist of filenames that can be edited.
   * If null/undefined, ALL files are editable.
   */
  @property({ attribute: false }) editableFiles: Set<string> | null = null;

  // ── Internal state ───────────────────────────────────────────────────────

  /** Currently selected filename — managed internally. */
  @state() private _activeFile = "";

  /** Cached content per filename. Reset when `files` prop changes. */
  @state() private _cache = new Map<string, string>();

  @state() private _loading = false;
  @state() private _editMode = false;
  @state() private _editContent = "";
  @state() private _editOriginal = "";
  @state() private _editTab: "edit" | "preview" = "edit";
  @state() private _saving = false;
  @state() private _saveError = "";
  @state() private _discardOpen = false;
  /** Filename the user wants to switch to, pending discard confirmation. */
  @state() private _pendingFile: string | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  override updated(changed: Map<string, unknown>): void {
    // When the file list is replaced (new agent loaded), wipe the cache and reset state.
    if (changed.has("files")) {
      this._cache = new Map();
      this._editMode = false;
      this._editContent = "";
      this._editOriginal = "";
      this._discardOpen = false;
      this._pendingFile = null;
      this._saveError = "";
      // Auto-select the first file when the list changes
      const first = this.files[0] ?? "";
      if (first !== this._activeFile) {
        this._activeFile = first;
        if (first) void this._ensureLoaded(first);
      }
    }
  }

  // ── Private methods ──────────────────────────────────────────────────────

  private async _ensureLoaded(filename: string): Promise<void> {
    if (this._cache.has(filename) || !this.loadFile) return;
    this._loading = true;
    try {
      const content = await this.loadFile(filename);
      this._cache = new Map(this._cache).set(filename, content);
    } catch {
      // Silently ignore — file may not be synced yet
    } finally {
      this._loading = false;
    }
  }

  /** Requests a tab switch. Intercepts if there are unsaved edits. */
  private _requestTabSwitch(filename: string): void {
    if (filename === this._activeFile) return;
    if (this._editMode && this._editContent !== this._editOriginal) {
      this._pendingFile = filename;
      this._discardOpen = true;
      return;
    }
    this._exitEditMode();
    this._switchToFile(filename);
  }

  private _switchToFile(filename: string): void {
    this._activeFile = filename;
    void this._ensureLoaded(filename);
    // Also emit event for parents that want to observe navigation
    this.dispatchEvent(
      new CustomEvent("file-tab-change", {
        detail: { filename },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _isEditable(filename: string): boolean {
    if (!this.editableFiles) return true;
    return this.editableFiles.has(filename);
  }

  private _enterEditMode(): void {
    const content = this._cache.get(this._activeFile) ?? "";
    this._editOriginal = content;
    this._editContent = content;
    this._editTab = "edit";
    this._saveError = "";
    this._editMode = true;
  }

  private _cancelEdit(): void {
    if (this._editContent !== this._editOriginal) {
      this._discardOpen = true;
    } else {
      this._exitEditMode();
    }
  }

  private _exitEditMode(): void {
    this._editMode = false;
    this._editContent = "";
    this._editOriginal = "";
    this._saveError = "";
    this._discardOpen = false;
    this._pendingFile = null;
  }

  private _confirmDiscard(): void {
    const target = this._pendingFile;
    this._exitEditMode();
    if (target) {
      this._switchToFile(target);
    }
  }

  private async _save(): Promise<void> {
    if (!this.saveFile || !this._activeFile) return;
    this._saving = true;
    this._saveError = "";
    try {
      await this.saveFile(this._activeFile, this._editContent);
      // Update cache with the saved content
      this._cache = new Map(this._cache).set(this._activeFile, this._editContent);
      this._exitEditMode();
    } catch (err) {
      this._saveError = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  private _renderMarkdown(content: string) {
    const rawHtml = marked.parse(content) as string;
    const clean = DOMPurify.sanitize(rawHtml);
    return html`<div class="md-render" .innerHTML=${clean}></div>`;
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  private _renderViewMode(filename: string, content: string) {
    const editable = this._isEditable(filename);
    return html`
      <div class="file-badge">
        <span class="${editable ? "badge-editable" : "badge-readonly"}">
          ${editable
            ? msg("editable", { id: "afe-badge-editable" })
            : msg("read-only", { id: "afe-badge-readonly" })}
        </span>
        ${editable
          ? html`
              <button
                class="btn-edit-file"
                title=${msg("Edit", { id: "afe-btn-edit" })}
                @click=${this._enterEditMode}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            `
          : nothing}
      </div>
      ${this._renderMarkdown(content)}
    `;
  }

  private _renderEditMode() {
    return html`
      <div class="file-edit-header">
        <span class="badge-editing">${msg("Editing", { id: "afe-badge-editing" })}</span>
        <div class="editor-tabs">
          <button
            class="editor-tab ${this._editTab === "edit" ? "active" : ""}"
            @click=${() => {
              this._editTab = "edit";
            }}
          >
            ${msg("Edit", { id: "afe-tab-edit" })}
          </button>
          <button
            class="editor-tab ${this._editTab === "preview" ? "active" : ""}"
            @click=${() => {
              this._editTab = "preview";
            }}
          >
            ${msg("Preview", { id: "afe-tab-preview" })}
          </button>
        </div>
        <div class="editor-actions">
          <button class="btn-file-save" ?disabled=${this._saving} @click=${() => void this._save()}>
            ${this._saving
              ? msg("Saving...", { id: "afe-btn-saving" })
              : msg("Save", { id: "afe-btn-save" })}
          </button>
          <button class="btn-file-cancel" ?disabled=${this._saving} @click=${this._cancelEdit}>
            ${msg("Cancel", { id: "afe-btn-cancel" })}
          </button>
        </div>
      </div>

      ${this._saveError ? html`<div class="file-save-error">${this._saveError}</div>` : nothing}
      ${this._editTab === "edit"
        ? html`<textarea
            class="file-textarea"
            .value=${this._editContent}
            @input=${(e: InputEvent) => {
              this._editContent = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>`
        : this._renderMarkdown(this._editContent)}
      ${this._discardOpen
        ? html`
            <div class="discard-overlay">
              <div class="discard-dialog">
                <h3 class="discard-title">
                  ${msg("Discard changes?", { id: "afe-discard-title" })}
                </h3>
                <p class="discard-body">
                  ${msg("Your changes will be lost.", { id: "afe-discard-body" })}
                </p>
                <div class="discard-actions">
                  <button
                    class="btn-keep-editing"
                    @click=${() => {
                      this._discardOpen = false;
                      this._pendingFile = null;
                    }}
                  >
                    ${msg("Keep editing", { id: "afe-discard-keep" })}
                  </button>
                  <button class="btn-discard" @click=${this._confirmDiscard}>
                    ${msg("Discard", { id: "afe-discard-ok" })}
                  </button>
                </div>
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _renderFileContent() {
    const filename = this._activeFile;
    if (!filename) return nothing;

    if (this._loading && !this._cache.has(filename)) {
      return html`<p class="loading-text">
        ${msg("Loading", { id: "afe-loading" })} ${filename}…
      </p>`;
    }

    const content = this._cache.get(filename);
    if (content === undefined) {
      return html`<p class="loading-text">
        ${msg("File not available.", { id: "afe-not-available" })}
      </p>`;
    }

    if (this._editMode && this._isEditable(filename)) {
      return this._renderEditMode();
    }

    return this._renderViewMode(filename, content);
  }

  override render() {
    return html`
      <div class="file-tabs">
        ${this.files.map(
          (f) => html`
            <button
              class="file-tab ${this._activeFile === f ? "active" : ""}"
              @click=${() => this._requestTabSwitch(f)}
            >
              ${f}
            </button>
          `,
        )}
      </div>
      <div class="file-body">${this._renderFileContent()}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-file-editor": AgentFileEditor;
  }
}
