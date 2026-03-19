// ui/src/components/agent-template-detail.ts
//
// Detail view for a single agent blueprint template.
// Displays metadata + file list with file editing capability via cp-agent-file-editor.
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentBlueprintInfo, AgentBlueprintFileSummary } from "../types.js";
import {
  fetchAgentBlueprint,
  fetchAgentBlueprintFile,
  updateAgentBlueprintFile,
  exportAgentBlueprint,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { sectionLabelStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";
import "./agent-file-editor.js";

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

      .files-section {
        margin-top: 16px;
      }

      .files-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 12px;
      }

      .loading {
        text-align: center;
        padding: 48px;
        color: var(--text-muted);
      }

      .files-empty {
        color: var(--text-muted);
        font-size: 13px;
        font-style: italic;
        padding: 16px 0;
      }
    `,
  ];

  @property({ type: String }) templateId = "";

  @state() private _blueprint: AgentBlueprintInfo | null = null;
  @state() private _loading = true;
  @state() private _error = "";

  // Stable references passed to cp-agent-file-editor.
  // Must not be recreated inside render() — Lit uses === equality for prop diffing,
  // so new references on every render would trigger spurious updated() cycles and
  // could cause unwanted navigate events (redirect to /agent-templates after save).
  private _loadFileFn: ((filename: string) => Promise<string>) | null = null;
  private _saveFileFn: ((filename: string, content: string) => Promise<void>) | null = null;
  // Stable filenames array — cp-agent-file-editor.updated() resets all edit state when
  // `files` changes (cache wipe, edit mode off). A new array on every render would
  // discard any in-progress edits whenever the parent re-renders.
  private _filenames: string[] = [];

  override connectedCallback() {
    super.connectedCallback();
    if (this.templateId) {
      void this._load();
      this._loadFileFn = this._buildLoadFile();
      this._saveFileFn = this._buildSaveFile();
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has("templateId") && this.templateId) {
      void this._load();
      // Rebuild stable function refs when templateId changes so the closures
      // always capture the current templateId without being recreated in render().
      this._loadFileFn = this._buildLoadFile();
      this._saveFileFn = this._buildSaveFile();
    }
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      this._blueprint = await fetchAgentBlueprint(this.templateId);
      // Rebuild the stable filenames array once after fetch — not inline in render() —
      // so cp-agent-file-editor doesn't see a new `files` reference on every parent render
      // (which would wipe its cache and discard any in-progress edits).
      this._filenames = (this._blueprint.files ?? []).map((f) => f.filename);
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _onExport(): Promise<void> {
    if (!this._blueprint) return;
    try {
      await exportAgentBlueprint(this._blueprint.id);
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _onUseTemplate(): void {
    if (!this._blueprint) return;
    this.dispatchEvent(
      new CustomEvent("use-template", {
        detail: { templateId: this._blueprint.id, templateName: this._blueprint.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _buildLoadFile(): (filename: string) => Promise<string> {
    return async (filename: string) => {
      const file = await fetchAgentBlueprintFile(this.templateId, filename);
      return file.content;
    };
  }

  private _buildSaveFile(): (filename: string, content: string) => Promise<void> {
    return async (filename: string, content: string) => {
      await updateAgentBlueprintFile(this.templateId, filename, content);
    };
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

    return html`
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}

      <div class="header">
        <button class="back-btn" @click=${this._navigateBack}>←</button>
        <span class="title">${bp.name}</span>
        <span class="category-badge category-${bp.category}">${bp.category}</span>
        <button class="btn btn-ghost" @click=${this._onExport}>
          ${msg("Export", { id: "atd-btn-export" })}
        </button>
        <button class="btn btn-primary" @click=${this._onUseTemplate}>
          ${msg("Use template", { id: "atd-btn-use-template" })}
        </button>
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

        ${this._filenames.length > 0
          ? html`
              <cp-agent-file-editor
                .files=${this._filenames}
                .loadFile=${this._loadFileFn}
                .saveFile=${this._saveFileFn}
              ></cp-agent-file-editor>
            `
          : html`<div class="files-empty">${msg("No files yet", { id: "atd-files-empty" })}</div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-template-detail": AgentTemplateDetail;
  }
}
