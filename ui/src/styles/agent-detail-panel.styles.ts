// ui/src/styles/agent-detail-panel.styles.ts
// Styles for the cp-agent-detail-panel component, extracted for readability.
import { css } from "lit";

export const agentDetailPanelStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 0;
    right: 0;
    width: 420px;
    height: 100%;
    background: var(--bg-surface);
    border-left: 1px solid var(--bg-border);
    overflow: hidden;
    z-index: 10;
    transition: width 0.25s ease;
  }

  :host(.expanded) {
    width: 100%;
    border-left: none;
  }

  /* ── Panel header ─────────────────────────────────────────────────────── */

  .panel-header {
    padding: 14px 16px;
    border-bottom: 1px solid var(--bg-border);
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .panel-header-info {
    flex: 1;
    min-width: 0;
  }

  .panel-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .panel-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 7px;
    border-radius: var(--radius-sm);
    transition:
      color 0.15s,
      background 0.15s;
    line-height: 1;
  }

  .panel-btn:hover {
    color: var(--text-primary);
    background: var(--bg-border);
  }

  .panel-btn.danger:hover {
    color: var(--state-error);
    background: var(--bg-border);
  }

  /* ── Agent identity rows ──────────────────────────────────────────────── */

  .agent-name-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 3px;
    min-width: 0;
  }

  .agent-name {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .agent-id-label {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .agent-role-label {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    margin-bottom: 2px;
  }

  .agent-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge-default {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    border-radius: 3px;
    padding: 1px 5px;
  }

  /* ── Tabs ─────────────────────────────────────────────────────────────── */

  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--bg-border);
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
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

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* ── Panel body ───────────────────────────────────────────────────────── */

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    position: relative;
  }

  .panel-body.has-save-bar {
    padding-bottom: 52px;
  }

  /* ── Info tab — field display ─────────────────────────────────────────── */

  .info-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .info-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .info-value {
    font-size: 13px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    word-break: break-all;
  }

  /* ── Spawn links ──────────────────────────────────────────────────────── */

  .links-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 4px;
  }

  .link-badge {
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--bg-border);
    border-radius: 3px;
    padding: 2px 7px;
    font-family: var(--font-mono);
  }

  .link-badge.spawn {
    color: var(--text-secondary);
  }

  .link-badge.spawn-editable {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  .link-badge.spawn-editable.pending-removal {
    text-decoration: line-through;
    opacity: 0.45;
  }

  .spawn-remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    padding: 0 1px;
    line-height: 1;
    border-radius: 2px;
    transition: color 0.12s;
    font-family: inherit;
  }

  .spawn-remove-btn:hover {
    color: var(--state-error);
  }

  .pending-removal .spawn-remove-btn {
    color: var(--accent);
  }

  .pending-removal .spawn-remove-btn:hover {
    color: var(--accent-hover);
  }

  .link-badge.spawn-pending-add {
    color: var(--state-running);
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.2);
  }

  .link-badge.spawn-pending-add .spawn-remove-btn {
    color: var(--text-muted);
  }

  .link-badge.spawn-pending-add .spawn-remove-btn:hover {
    color: var(--state-error);
  }

  /* ── Spawn save bar ───────────────────────────────────────────────────── */

  .spawn-save-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    background: var(--bg-surface);
    border-top: 1px solid var(--bg-border);
    z-index: 5;
  }

  .btn-save-spawn {
    background: var(--accent-subtle);
    border: 1px solid var(--accent-border);
    color: var(--accent);
    border-radius: 5px;
    padding: 5px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    font-family: inherit;
  }

  .btn-save-spawn:hover:not(:disabled) {
    background: rgba(79, 110, 247, 0.15);
  }

  .btn-save-spawn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-hint {
    font-size: 10px;
    color: var(--text-muted);
    flex: 1;
  }

  .save-hint.save-error {
    color: var(--state-error);
  }

  .btn-cancel-spawn {
    background: none;
    border: 1px solid var(--bg-border);
    color: var(--state-stopped);
    border-radius: 5px;
    padding: 5px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
    font-family: inherit;
  }

  .btn-cancel-spawn:hover {
    border-color: var(--state-error);
    color: var(--state-error);
  }

  /* ── Spawn add dropdown ───────────────────────────────────────────────── */

  .spawn-add-wrap {
    position: relative;
    display: inline-block;
  }

  .spawn-add-btn {
    background: none;
    border: 1px dashed var(--bg-border);
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 3px;
    line-height: 1.4;
    transition:
      border-color 0.12s,
      color 0.12s;
    font-family: inherit;
  }

  .spawn-add-btn:hover {
    border-color: var(--accent-border);
    color: var(--accent);
  }

  .spawn-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--bg-hover);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    min-width: 140px;
    z-index: 20;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.375);
    overflow: hidden;
  }

  .spawn-dropdown-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 7px 12px;
    cursor: pointer;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .spawn-dropdown-item:hover {
    background: var(--accent-subtle);
    color: var(--text-primary);
  }

  /* ── File tab — view mode ─────────────────────────────────────────────── */

  .file-content {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-base);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 12px;
    margin: 0;
    overflow-x: auto;
  }

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

  .loading-text {
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
  }

  .notes-text {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    font-style: italic;
  }

  /* ── File tab — edit mode ─────────────────────────────────────────────── */

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

  .file-editor {
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

  .file-editor:focus {
    outline: none;
    border-color: var(--accent-border);
  }

  .file-save-error {
    color: var(--state-error);
    font-size: 11px;
    margin-bottom: 6px;
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

  /* ── Field edit form (agent meta) ─────────────────────────────────────── */

  .field-edit-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-input);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
  }

  .field-edit-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .field-edit-textarea {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-input);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    box-sizing: border-box;
  }

  .field-edit-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .field-edit-actions {
    display: flex;
    gap: 8px;
    padding-top: 8px;
  }

  .info-hint {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 400;
    margin-left: 6px;
  }

  /* ── Skills badges (lecture) ──────────────────────────────────────────── */

  .skills-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 3px;
  }

  .skill-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--bg-border);
    color: var(--text-secondary);
    border: 1px solid transparent;
  }

  .skill-badge.muted {
    opacity: 0.55;
    font-style: italic;
  }

  /* ── Skills toggle (édition) ──────────────────────────────────────────── */

  .skills-toggle {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }

  .skills-toggle-btn {
    padding: 3px 10px;
    border-radius: 5px;
    font-size: 11px;
    font-family: inherit;
    border: 1px solid var(--bg-border);
    background: var(--bg-surface);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }

  .skills-toggle-btn:hover {
    border-color: var(--accent-border);
    color: var(--text-secondary);
  }

  .skills-toggle-btn.active {
    background: var(--accent-subtle);
    color: var(--accent);
    border-color: var(--accent-border);
  }

  /* ── Skills grid (checkboxes) ─────────────────────────────────────────── */

  .skills-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 4px;
    margin-top: 4px;
  }

  .skills-grid-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s;
    color: var(--text-secondary);
  }

  .skills-grid-label:hover {
    background: var(--bg-border);
  }

  .skills-grid-label.ineligible {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;
