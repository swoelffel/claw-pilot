// ui/src/styles/agent-file-editor.styles.ts
// Styles for the cp-agent-file-editor component.
// Extracted from agent-detail-panel.styles.ts for reuse across agent panels and template detail.
import { css } from "lit";

export const agentFileEditorStyles = css`
  :host {
    display: block;
  }

  /* ── File tabs strip ──────────────────────────────────────────────────── */

  .file-tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--bg-border);
    margin-bottom: 0;
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
  }

  .file-tabs::-webkit-scrollbar {
    display: none;
  }

  .file-tab {
    padding: 8px 14px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    transition:
      color 0.15s,
      border-color 0.15s;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    font-family: inherit;
  }

  .file-tab:hover {
    color: var(--text-secondary);
  }

  .file-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* ── File content area ────────────────────────────────────────────────── */

  .file-body {
    padding: 16px 0 0;
    position: relative;
    min-height: 200px;
  }

  .loading-text {
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
  }

  /* ── File view mode ───────────────────────────────────────────────────── */

  .file-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    margin-bottom: 10px;
  }

  .badge-editable {
    color: var(--state-running);
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 3px;
    padding: 1px 6px;
  }

  .badge-readonly {
    color: var(--text-muted);
    background: var(--bg-border);
    border-radius: 3px;
    padding: 1px 6px;
  }

  .btn-edit-file {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--text-muted);
    transition: color 0.12s;
    line-height: 1;
  }

  .btn-edit-file:hover {
    color: var(--accent);
  }

  /* ── Markdown renderer ────────────────────────────────────────────────── */

  .md-render {
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-secondary);
  }

  .md-render h1,
  .md-render h2,
  .md-render h3 {
    color: var(--text-primary);
    margin-top: 14px;
    margin-bottom: 6px;
    font-size: 14px;
  }

  .md-render h1 {
    font-size: 16px;
  }

  .md-render p {
    margin: 6px 0;
  }

  .md-render ul,
  .md-render ol {
    padding-left: 18px;
    margin: 6px 0;
  }

  .md-render code {
    background: var(--bg-border);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .md-render pre {
    background: var(--bg-base);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    overflow-x: auto;
  }

  .md-render pre code {
    background: none;
    padding: 0;
  }

  .md-render blockquote {
    border-left: 3px solid var(--accent-border);
    margin: 8px 0;
    padding: 4px 12px;
    color: var(--text-muted);
  }

  /* ── File edit mode ───────────────────────────────────────────────────── */

  .file-edit-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .badge-editing {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    border-radius: 3px;
    padding: 1px 6px;
  }

  .editor-tabs {
    display: flex;
    gap: 3px;
  }

  .editor-tab {
    background: none;
    border: 1px solid var(--bg-border);
    border-radius: 4px;
    padding: 2px 10px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    color: var(--text-muted);
    transition:
      background 0.12s,
      color 0.12s;
  }

  .editor-tab.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .editor-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .btn-file-save {
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    color: var(--accent);
    border-radius: 5px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-file-save:hover:not(:disabled) {
    background: rgba(79, 110, 247, 0.15);
  }

  .btn-file-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-file-cancel {
    background: none;
    border: 1px solid var(--bg-border);
    color: var(--text-muted);
    border-radius: 5px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
  }

  .btn-file-cancel:hover:not(:disabled) {
    border-color: var(--state-error);
    color: var(--state-error);
  }

  .file-textarea {
    width: 100%;
    min-height: 280px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    resize: vertical;
    box-sizing: border-box;
    background: var(--bg-base);
    color: var(--text-secondary);
  }

  .file-textarea:focus {
    outline: none;
    border-color: var(--accent-border);
  }

  .file-save-error {
    color: var(--state-error);
    font-size: 11px;
    margin-bottom: 6px;
  }

  /* ── Discard changes dialog ───────────────────────────────────────────── */

  .discard-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
    border-radius: var(--radius-md);
  }

  .discard-dialog {
    background: var(--bg-surface);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 20px;
    max-width: 300px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .discard-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .discard-body {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 16px;
  }

  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-keep-editing {
    background: none;
    border: 1px solid var(--bg-border);
    color: var(--text-secondary);
    border-radius: 5px;
    padding: 5px 12px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
  }

  .btn-discard {
    background: var(--state-error, #e53e3e);
    border: none;
    color: white;
    border-radius: 5px;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
`;
