// ui/src/components/instance-shared-files.ts
//
// Admin panel for the instance shared workspace (v38).
// Files live at `<stateDir>/workspaces/shared/` on the server and are
// readable by every agent of the instance via ws_list_files / ws_search_files
// (entries prefixed with @shared/).

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
import { errorBannerStyles, spinnerStyles } from "../styles/shared.js";
import "./agent-file-tree.js";
import "./agent-file-editor.js";
import "./workspace-file-dialogs.js";

@localized()
@customElement("cp-instance-shared-files")
export class InstanceSharedFiles extends LitElement {
  static override styles = [tokenStyles, errorBannerStyles, spinnerStyles];

  @property({ type: String }) slug = "";

  @state() private _tree: AgentFileTreeNode[] = [];
  @state() private _activePath = "";
  @state() private _loading = true;
  @state() private _error = "";

  @state() private _newFileDialogOpen = false;
  @state() private _newFileParentDir = "";
  @state() private _newFolderMode = false;

  @state() private _deleteDialogOpen = false;
  @state() private _deleteTarget = "";

  private _loadFileFn = (filename: string): Promise<string> => {
    return fetchSharedFile(this.slug, filename).then((f) => f.content);
  };

  private _saveFileFn = async (filename: string, content: string): Promise<void> => {
    await updateSharedFile(this.slug, filename, content);
    await this._loadTree();
  };

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

  private _onFileSelect(e: CustomEvent<{ path: string }>): void {
    this._activePath = e.detail.path;
  }

  private _onFileNewRequested(e: CustomEvent<{ parentDir: string }>): void {
    this._newFolderMode = false;
    this._newFileParentDir = e.detail.parentDir;
    this._newFileDialogOpen = true;
  }

  private _onFolderNewRequested(e: CustomEvent<{ parentDir: string }>): void {
    this._newFolderMode = true;
    this._newFileParentDir = e.detail.parentDir;
    this._newFileDialogOpen = true;
  }

  private _onFileDeleteRequested(e: CustomEvent<{ path: string }>): void {
    this._deleteTarget = e.detail.path;
    this._deleteDialogOpen = true;
  }

  private async _onNewFileConfirmed(
    e: CustomEvent<{ path: string; content: string }>,
  ): Promise<void> {
    const dialog = this.renderRoot.querySelector("cp-new-file-dialog");
    try {
      await updateSharedFile(this.slug, e.detail.path, e.detail.content);
      this._newFileDialogOpen = false;
      this._activePath = e.detail.path;
      await this._loadTree();
    } catch (err) {
      dialog?.showError(userMessage(err));
    }
  }

  private async _onDeleteFileConfirmed(e: CustomEvent<{ path: string }>): Promise<void> {
    const dialog = this.renderRoot.querySelector("cp-delete-file-dialog");
    try {
      await deleteSharedFile(this.slug, e.detail.path);
      this._deleteDialogOpen = false;
      if (this._activePath === e.detail.path) this._activePath = "";
      await this._loadTree();
    } catch (err) {
      dialog?.showError(userMessage(err));
    }
  }

  override render() {
    if (this._loading) {
      return html`<div class="spinner"></div>`;
    }
    return html`
      <div class="shared-files">
        <p class="hint">
          ${msg(
            "Files placed here are shared with every agent of this instance via ws_list_files, ws_search_files, ws_write_shared_file and ws_delete_shared_file (prefixed with @shared/). Use this space for team-wide reference documents and cross-agent collaboration.",
            { id: "isf-hint" },
          )}
        </p>
        ${this._error ? html`<div class="error-banner">${this._error}</div>` : nothing}
        <div class="layout">
          <div class="tree-pane">
            <cp-agent-file-tree
              .tree=${this._tree}
              .activePath=${this._activePath}
              @file-select=${this._onFileSelect}
              @file-new=${this._onFileNewRequested}
              @folder-new=${this._onFolderNewRequested}
              @file-delete=${this._onFileDeleteRequested}
            ></cp-agent-file-tree>
          </div>
          <div class="editor-pane">
            ${this._activePath
              ? html`
                  <cp-agent-file-editor
                    .files=${[this._activePath]}
                    .activeFile=${this._activePath}
                    .loadFile=${this._loadFileFn}
                    .saveFile=${this._saveFileFn}
                    .editableFiles=${null}
                  ></cp-agent-file-editor>
                `
              : html`<p class="placeholder">
                  ${msg("Select a file to view or edit, or create a new one.", {
                    id: "isf-placeholder",
                  })}
                </p>`}
          </div>
        </div>
        ${this._newFileDialogOpen
          ? html`
              <cp-new-file-dialog
                .parentDir=${this._newFileParentDir}
                .folderMode=${this._newFolderMode}
                @close-dialog=${() => (this._newFileDialogOpen = false)}
                @file-new-confirmed=${this._onNewFileConfirmed}
              ></cp-new-file-dialog>
            `
          : nothing}
        ${this._deleteDialogOpen
          ? html`
              <cp-delete-file-dialog
                .filePath=${this._deleteTarget}
                @close-dialog=${() => (this._deleteDialogOpen = false)}
                @file-delete-confirmed=${this._onDeleteFileConfirmed}
              ></cp-delete-file-dialog>
            `
          : nothing}
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
          min-height: 320px;
        }
        .placeholder {
          color: var(--cp-color-text-muted, #888);
          padding: 20px;
          text-align: center;
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
