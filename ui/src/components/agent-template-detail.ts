// ui/src/components/agent-template-detail.ts
//
// Detail view for a single agent blueprint template.
// Displays metadata + file list with file editing capability.
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBlueprintInfo, AgentBlueprintFileSummary } from "../types.js";
import {
  fetchAgentBlueprint,
  updateAgentBlueprint,
  fetchAgentBlueprintFile,
  updateAgentBlueprintFile,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-agent-template-detail")
export class AgentTemplateDetail extends LitElement {
  static override styles = [
    tokenStyles,
    sectionLabelStyles,
    errorBannerStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 16px;
        max-width: 900px;
        margin: 0 auto;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .back-btn {
        background: none;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px 8px;
        font-size: 14px;
      }

      .back-btn:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
      }

      .category-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 2px 6px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .category-user {
        color: var(--accent);
        background: var(--accent-subtle);
        border: 1px solid var(--accent-border);
      }

      .category-tool {
        color: var(--text-muted);
        border: 1px solid var(--bg-border);
      }

      .category-system {
        color: color-mix(in srgb, var(--text-muted) 70%, transparent);
        border: 1px dashed var(--bg-border);
      }

      .meta-section {
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 16px;
        margin-bottom: 16px;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 8px 16px;
        font-size: 13px;
      }

      .meta-label {
        color: var(--text-muted);
        font-weight: 600;
      }

      .meta-value {
        color: var(--text-primary);
        word-break: break-word;
      }

      .description-input {
        width: 100%;
        min-height: 60px;
        background: var(--bg-input);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 13px;
        padding: 8px;
        resize: vertical;
      }

      .files-section {
        margin-top: 16px;
      }

      .files-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 12px;
      }

      .file-tabs {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      .file-tab {
        padding: 6px 12px;
        font-size: 12px;
        font-family: var(--font-mono);
        color: var(--text-muted);
        cursor: pointer;
        border: none;
        background: none;
        border-bottom: 2px solid transparent;
        transition:
          color 0.15s,
          border-color 0.15s;
      }

      .file-tab:hover {
        color: var(--text-primary);
      }

      .file-tab.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }

      .file-editor {
        position: relative;
      }

      .file-textarea {
        width: 100%;
        min-height: 300px;
        background: var(--bg-input);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 12px;
        padding: 12px;
        resize: vertical;
        line-height: 1.5;
        tab-size: 2;
      }

      .file-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
      }

      .btn-save {
        background: var(--accent);
        color: var(--bg-base);
        border: none;
        border-radius: var(--radius-sm);
        padding: 6px 16px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-save:hover {
        opacity: 0.9;
      }

      .btn-save:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .loading {
        text-align: center;
        padding: 48px;
        color: var(--text-muted);
      }
    `,
  ];

  @property({ type: String }) templateId = "";

  @state() private _blueprint: AgentBlueprintInfo | null = null;
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _activeFile = "";
  @state() private _fileContent = "";
  @state() private _fileOriginal = "";
  @state() private _loadingFile = false;
  @state() private _savingFile = false;

  override connectedCallback() {
    super.connectedCallback();
    if (this.templateId) {
      void this._load();
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has("templateId") && this.templateId) {
      void this._load();
    }
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      this._blueprint = await fetchAgentBlueprint(this.templateId);
      // Auto-select first file
      if (this._blueprint.files && this._blueprint.files.length > 0) {
        await this._selectFile(this._blueprint.files[0]!.filename);
      }
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _selectFile(filename: string): Promise<void> {
    if (this._activeFile === filename) return;
    this._activeFile = filename;
    this._loadingFile = true;
    try {
      const file = await fetchAgentBlueprintFile(this.templateId, filename);
      this._fileContent = file.content;
      this._fileOriginal = file.content;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loadingFile = false;
    }
  }

  private async _saveFile(): Promise<void> {
    if (!this._activeFile || this._fileContent === this._fileOriginal) return;
    this._savingFile = true;
    try {
      await updateAgentBlueprintFile(this.templateId, this._activeFile, this._fileContent);
      this._fileOriginal = this._fileContent;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._savingFile = false;
    }
  }

  private _navigateBack(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { view: "agent-templates" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (this._loading) {
      return html`<div class="loading">${msg("Loading...", { id: "atd-loading" })}</div>`;
    }

    if (!this._blueprint) {
      return html`<div class="loading">${this._error || "Template not found"}</div>`;
    }

    const bp = this._blueprint;
    const files: AgentBlueprintFileSummary[] = bp.files ?? [];
    const hasChanges = this._fileContent !== this._fileOriginal;

    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

      <div class="header">
        <button class="back-btn" @click=${this._navigateBack}>&larr;</button>
        <span class="title">${bp.name}</span>
        <span class="category-badge category-${bp.category}">${bp.category}</span>
      </div>

      <div class="meta-section">
        <div class="meta-grid">
          <span class="meta-label">${msg("ID", { id: "atd-meta-id" })}</span>
          <span class="meta-value" style="font-family: var(--font-mono); font-size: 11px;"
            >${bp.id}</span
          >

          <span class="meta-label">${msg("Description", { id: "atd-meta-desc" })}</span>
          <span class="meta-value">${bp.description || "-"}</span>

          <span class="meta-label">${msg("Category", { id: "atd-meta-category" })}</span>
          <span class="meta-value">${bp.category}</span>

          <span class="meta-label">${msg("Created", { id: "atd-meta-created" })}</span>
          <span class="meta-value">${bp.created_at?.slice(0, 10) ?? "-"}</span>

          <span class="meta-label">${msg("Files", { id: "atd-meta-files" })}</span>
          <span class="meta-value">${files.length}</span>
        </div>
      </div>

      <div class="files-section">
        <div class="files-title">
          ${msg("Workspace files", { id: "atd-files-title" })} (${files.length})
        </div>

        ${files.length > 0
          ? html`
              <div class="file-tabs">
                ${files.map(
                  (f) => html`
                    <button
                      class="file-tab ${this._activeFile === f.filename ? "active" : ""}"
                      @click=${() => void this._selectFile(f.filename)}
                    >
                      ${f.filename}
                    </button>
                  `,
                )}
              </div>

              <div class="file-editor">
                ${this._loadingFile
                  ? html`<div class="loading">
                      ${msg("Loading file...", { id: "atd-file-loading" })}
                    </div>`
                  : html`
                      <textarea
                        class="file-textarea"
                        .value=${this._fileContent}
                        @input=${(e: Event) => {
                          this._fileContent = (e.target as HTMLTextAreaElement).value;
                        }}
                      ></textarea>
                      <div class="file-actions">
                        <button
                          class="btn-save"
                          ?disabled=${!hasChanges || this._savingFile}
                          @click=${() => void this._saveFile()}
                        >
                          ${this._savingFile
                            ? msg("Saving...", { id: "atd-file-saving" })
                            : msg("Save", { id: "atd-file-save" })}
                        </button>
                      </div>
                    `}
              </div>
            `
          : html`<div class="loading">${msg("No files yet", { id: "atd-files-empty" })}</div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-template-detail": AgentTemplateDetail;
  }
}
