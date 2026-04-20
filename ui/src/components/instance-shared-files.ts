// ui/src/components/instance-shared-files.ts
//
// Admin panel for the instance shared workspace (v38).
// Files live at `<stateDir>/workspaces/shared/` on the server and are
// read-only for agents (via ws_list_files / ws_search_files).

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentFileTreeNode } from "../types.js";
import {
  fetchSharedFileTree,
  fetchSharedFile,
  updateSharedFile,
  deleteSharedFile,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, errorBannerStyles, spinnerStyles } from "../styles/shared.js";
import "./agent-file-tree.js";

@localized()
@customElement("cp-instance-shared-files")
export class InstanceSharedFiles extends LitElement {
  static override styles = [tokenStyles, buttonStyles, errorBannerStyles, spinnerStyles];

  @property({ type: String }) slug = "";

  @state() private _tree: AgentFileTreeNode[] = [];
  @state() private _activePath = "";
  @state() private _content = "";
  @state() private _originalContent = "";
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _saving = false;
  @state() private _toast = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadTree();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") && this.slug) {
      void this._loadTree();
    }
  }

  private async _loadTree(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = "";
    try {
      const res = await fetchSharedFileTree(this.slug);
      this._tree = res.tree;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadFile(path: string): Promise<void> {
    this._error = "";
    this._activePath = path;
    try {
      const file = await fetchSharedFile(this.slug, path);
      this._content = file.content;
      this._originalContent = file.content;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private async _save(): Promise<void> {
    if (!this._activePath) return;
    this._saving = true;
    this._error = "";
    try {
      await updateSharedFile(this.slug, this._activePath, this._content);
      this._originalContent = this._content;
      this._toast = msg("Saved", { id: "isf-saved" });
      setTimeout(() => (this._toast = ""), 2000);
      await this._loadTree();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._saving = false;
    }
  }

  private async _delete(path: string): Promise<void> {
    if (
      !window.confirm(msg("Delete this file from the shared workspace?", { id: "isf-confirm-del" }))
    )
      return;
    this._error = "";
    try {
      await deleteSharedFile(this.slug, path);
      if (this._activePath === path) {
        this._activePath = "";
        this._content = "";
        this._originalContent = "";
      }
      await this._loadTree();
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private async _newFile(parentDir: string): Promise<void> {
    const name = window.prompt(msg("New file name (e.g. README.md)", { id: "isf-new-prompt" }));
    if (!name) return;
    const relPath = parentDir ? `${parentDir}/${name}` : name;
    try {
      await updateSharedFile(this.slug, relPath, "");
      await this._loadTree();
      void this._loadFile(relPath);
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _onTreeSelect(e: CustomEvent<{ path: string }>): void {
    void this._loadFile(e.detail.path);
  }

  private _onTreeDelete(e: CustomEvent<{ path: string }>): void {
    void this._delete(e.detail.path);
  }

  private _onTreeNew(e: CustomEvent<{ parentDir: string }>): void {
    void this._newFile(e.detail.parentDir);
  }

  override render() {
    if (this._loading) {
      return html`<div class="spinner"></div>`;
    }
    const dirty = this._content !== this._originalContent && this._activePath !== "";
    return html`
      <div class="shared-files">
        <p class="hint">
          ${msg(
            "Files here live under workspaces/shared and are readable by every agent of this instance via ws_list_files / ws_search_files (prefixed with @shared/). Agents cannot write here.",
            { id: "isf-hint" },
          )}
        </p>
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
        ${this._toast ? html`<div class="toast">${this._toast}</div>` : nothing}
        <div class="layout">
          <aside class="tree-pane">
            <cp-agent-file-tree
              .tree=${this._tree}
              .activePath=${this._activePath}
              .readonly=${false}
              @file-select=${this._onTreeSelect}
              @file-delete=${this._onTreeDelete}
              @file-new=${this._onTreeNew}
            ></cp-agent-file-tree>
          </aside>
          <section class="editor-pane">
            ${this._activePath
              ? html`
                  <header class="editor-header">
                    <strong>${this._activePath}</strong>
                    <button
                      class="btn btn-primary"
                      ?disabled=${!dirty || this._saving}
                      @click=${this._save}
                    >
                      ${this._saving
                        ? msg("Saving…", { id: "isf-saving" })
                        : msg("Save", { id: "isf-save" })}
                    </button>
                  </header>
                  <textarea
                    class="editor"
                    .value=${this._content}
                    @input=${(e: InputEvent) =>
                      (this._content = (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                `
              : html`<div class="placeholder">
                  ${msg("Select a file on the left or create a new one.", {
                    id: "isf-placeholder",
                  })}
                </div>`}
          </section>
        </div>
      </div>
      <style>
        .shared-files {
          display: flex;
          flex-direction: column;
          gap: var(--cp-space-3, 12px);
          height: 100%;
        }
        .hint {
          font-size: 12px;
          color: var(--cp-color-text-muted, #888);
          margin: 0;
        }
        .layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: var(--cp-space-3, 12px);
          flex: 1;
          min-height: 400px;
        }
        .tree-pane {
          border: 1px solid var(--cp-color-border, #333);
          border-radius: 6px;
          overflow: auto;
        }
        .editor-pane {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .editor {
          flex: 1;
          min-height: 320px;
          font-family: var(--cp-font-mono, ui-monospace, monospace);
          font-size: 13px;
          padding: 8px;
          border: 1px solid var(--cp-color-border, #333);
          border-radius: 6px;
          background: var(--cp-color-surface, #111);
          color: inherit;
          resize: vertical;
        }
        .placeholder {
          color: var(--cp-color-text-muted, #888);
          padding: 20px;
          text-align: center;
        }
        .toast {
          background: var(--cp-color-success-bg, #154f30);
          color: var(--cp-color-success-text, #b7f5c7);
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          align-self: flex-start;
        }
      </style>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-shared-files": InstanceSharedFiles;
  }
}
