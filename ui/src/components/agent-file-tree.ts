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
          <span class="tree-icon">📄</span>
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
        <span class="tree-icon">📁</span>
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
              <button class="btn-new-file" @click=${() => this._emitNew("")}>
                ${msg("New file…", { id: "aft-new" })}
              </button>
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
}
