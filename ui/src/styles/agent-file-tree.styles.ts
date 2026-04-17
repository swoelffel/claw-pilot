// ui/src/styles/agent-file-tree.styles.ts
// Styles for the cp-agent-file-tree component.
import { css } from "lit";

export const agentFileTreeStyles = css`
  :host {
    display: block;
    font-size: 12px;
    color: var(--text-primary);
  }

  .tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid var(--bg-border);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tree-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tree-header-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .tree-header-icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tree-body {
    padding: 4px 0;
    overflow-y: auto;
    max-height: 480px;
  }

  .tree-empty {
    padding: 12px;
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
  }

  .tree-node {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    cursor: pointer;
    user-select: none;
    border-radius: 3px;
    font-family: var(--mono-font, ui-monospace, monospace);
  }

  .tree-node:hover {
    background: var(--bg-hover, rgba(127, 127, 127, 0.08));
  }

  .tree-node.active {
    background: var(--bg-selected, rgba(80, 80, 200, 0.15));
    color: var(--accent);
  }

  .tree-node.dir {
    font-weight: 500;
  }

  .tree-chevron {
    width: 12px;
    flex-shrink: 0;
    text-align: center;
    font-size: 10px;
    color: var(--text-muted);
    transition: transform 0.1s;
  }

  .tree-chevron.open {
    transform: rotate(90deg);
  }

  .tree-icon {
    flex-shrink: 0;
    opacity: 0.7;
    width: 14px;
    text-align: center;
  }

  .tree-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-actions {
    display: none;
    gap: 2px;
    flex-shrink: 0;
  }

  .tree-node:hover .tree-actions {
    display: flex;
  }

  .tree-action-btn {
    background: none;
    border: none;
    padding: 2px 4px;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: 2px;
    font-size: 12px;
    line-height: 1;
  }

  .tree-action-btn:hover {
    background: var(--bg-border);
    color: var(--text-primary);
  }

  .tree-action-btn.danger:hover {
    color: var(--danger, #e06060);
  }

  .tree-children {
    display: none;
  }

  .tree-children.open {
    display: block;
  }
`;
