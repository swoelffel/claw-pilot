// ui/src/components/agent-file-tree.ts
//
// Hierarchical workspace file tree for an agent.
//
// Usage:
//   <cp-agent-file-tree
//     .tree=${treeNodes}
//     .activePath=${"SOUL.md"}
//     .readonly=${false}
//     @file-select=${(e) => ...}
//     @file-delete=${(e) => ...}
//     @file-new=${(e) => ...}
//   ></cp-agent-file-tree>
//
// Events (CustomEvent detail):
//   file-select  { path: string }          — user clicked a file
//   file-delete  { path: string }          — user clicked the trash icon
//   file-new     { parentDir: string }     — user clicked "+" next to a dir
//                                            (parentDir === "" → workspace root)
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { AgentFileTreeNode } from "../types.js";
import { tokenStyles } from "../styles/tokens.js";
import { agentFileTreeStyles } from "../styles/agent-file-tree.styles.js";

@localized()
@customElement("cp-agent-file-tree")
export class AgentFileTree extends LitElement {
  static override styles = [tokenStyles, agentFileTreeStyles];

  /** Hierarchical workspace tree (files + directories). */
  @property({ type: Array }) tree: AgentFileTreeNode[] = [];

  /** Currently selected file path (workspace-relative). */
  @property({ type: String }) activePath = "";

  /** If true, hides create/delete actions (view-only mode). */
  @property({ type: Boolean }) readonly = false;

  /** Set of expanded directory paths. */
  @state() private _expanded = new Set<string>();

  override updated(changed: Map<string, unknown>): void {
    // Auto-expand the directories leading to the active path so the user
    // can always see which file is selected.
    if (changed.has("activePath") && this.activePath) {
      const segments = this.activePath.split("/");
      const dirs = new Set(this._expanded);
      for (let i = 0; i < segments.length - 1; i++) {
        dirs.add(segments.slice(0, i + 1).join("/"));
      }
      this._expanded = dirs;
    }
  }

  private _toggleDir(path: string): void {
    const next = new Set(this._expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._expanded = next;
  }

  private _emitSelect(path: string): void {
    this.dispatchEvent(
      new CustomEvent("file-select", { detail: { path }, bubbles: true, composed: true }),
    );
  }

  private _emitDelete(path: string, ev: Event): void {
    ev.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("file-delete", { detail: { path }, bubbles: true, composed: true }),
    );
  }

  private _emitNew(parentDir: string, ev?: Event): void {
    ev?.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("file-new", { detail: { parentDir }, bubbles: true, composed: true }),
    );
  }

  private _emitNewFolder(parentDir: string, ev?: Event): void {
    ev?.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("folder-new", { detail: { parentDir }, bubbles: true, composed: true }),
    );
  }

  private _renderNode(node: AgentFileTreeNode, depth: number): unknown {
    const indent = depth * 16;
    if (node.type === "file") {
      const active = node.path === this.activePath;
      return html`
        <div
          class="tree-node ${active ? "active" : ""}"
          style="padding-left: ${indent + 12}px"
          @click=${() => this._emitSelect(node.path)}
          title=${node.path}
        >
          <span class="tree-icon">◈</span>
          <span class="tree-name">${node.name}</span>
          ${this.readonly
            ? nothing
            : html`
                <div class="tree-actions">
                  <button
                    class="tree-action-btn danger"
                    title=${msg("Delete", { id: "aft-delete" })}
                    @click=${(e: Event) => this._emitDelete(node.path, e)}
                  >
                    ✕
                  </button>
                </div>
              `}
        </div>
      `;
    }

    const open = this._expanded.has(node.path);
    return html`
      <div
        class="tree-node dir"
        style="padding-left: ${indent}px"
        @click=${() => this._toggleDir(node.path)}
        title=${node.path}
      >
        <span class="tree-chevron ${open ? "open" : ""}">▶</span>
        <span class="tree-icon">⊟</span>
        <span class="tree-name">${node.name}</span>
        ${this.readonly
          ? nothing
          : html`
              <div class="tree-actions">
                <button
                  class="tree-action-btn"
                  title=${msg("New file here", { id: "aft-new-here" })}
                  @click=${(e: Event) => this._emitNew(node.path, e)}
                >
                  +
                </button>
              </div>
            `}
      </div>
      <div class="tree-children ${open ? "open" : ""}">
        ${node.children.map((child) => this._renderNode(child, depth + 1))}
      </div>
    `;
  }

  override render() {
    return html`
      <div class="tree-header">
        <span>${msg("Workspace", { id: "aft-title" })}</span>
        ${this.readonly
          ? nothing
          : html`
              <div class="tree-header-actions">
                <button
                  class="tree-header-icon-btn"
                  title=${msg("New file", { id: "aft-new-file" })}
                  @click=${() => this._emitNew("")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M9.5 1.1l3.4 3.5.1.4v2h-1V5H8V1H3v14h4v1H2.5l-.5-.5v-15l.5-.5h6.7l.3.1zM9 2v3h2.9L9 2zm4 14h-1v-2H9v-1h3v-2h1v2h2v1h-2v2z"
                    />
                  </svg>
                </button>
                <button
                  class="tree-header-icon-btn"
                  title=${msg("New folder", { id: "aft-new-folder" })}
                  @click=${() => this._emitNewFolder("")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8h-2v2h-1v-2h-2V10h2V8h1v2h2v1zm-7-4V6H5.5v1H4V5h3.5V4h1v3H7z"
                    />
                  </svg>
                </button>
              </div>
            `}
      </div>
      <div class="tree-body">
        ${this.tree.length === 0
          ? html`<div class="tree-empty">${msg("No files", { id: "aft-empty" })}</div>`
          : this.tree.map((n) => this._renderNode(n, 0))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-agent-file-tree": AgentFileTree;
  }
  interface HTMLElementEventMap {
    "folder-new": CustomEvent<{ parentDir: string }>;
  }
}
