// ui/src/styles/profile-settings.styles.ts
// Styles for the cp-profile-settings component.
// Follows the same patterns as instance-settings.styles.ts.
import { css } from "lit";

export const profileSettingsStyles = css`
  :host {
    display: block;
    min-height: calc(100vh - 56px - 48px);
  }

  /* ── Layout ───────────────────────────────────────────────────────────── */

  .settings-layout {
    display: flex;
    padding: 16px;
    gap: 32px;
  }

  /* ── Header bar ───────────────────────────────────────────────────────── */

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--bg-border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid var(--bg-border);
    color: var(--text-secondary);
    padding: 7px 14px;
    border-radius: var(--radius-md);
    font-size: 13px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
  }

  .back-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .header-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* ── Sidebar ──────────────────────────────────────────────────────────── */

  .sidebar {
    flex: 0 0 180px;
    position: sticky;
    top: 80px;
    align-self: flex-start;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    border: none;
    background: none;
    text-align: left;
    transition:
      background 0.1s,
      color 0.1s;
    width: 100%;
  }

  .sidebar-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sidebar-item.active {
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 600;
  }

  .sidebar-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 20px;
    background: rgba(79, 110, 247, 0.12);
    color: var(--accent);
    border: 1px solid var(--accent-border);
    font-size: 10px;
    font-weight: 700;
    font-family: var(--font-mono);
    margin-left: auto;
  }

  /* ── Content area ─────────────────────────────────────────────────────── */

  .content {
    flex: 1;
    min-width: 0;
  }

  .section {
    margin-bottom: 32px;
  }

  .section-header {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--bg-border);
    margin-bottom: 20px;
  }

  /* ── Form fields ──────────────────────────────────────────────────────── */

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .field-grid.single {
    grid-template-columns: 1fr;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field.full-width {
    grid-column: 1 / -1;
  }

  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .field-input {
    padding: 8px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--bg-border);
    background: var(--bg-base);
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-ui);
    transition: border-color 0.15s;
  }

  .field-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .field-input.changed {
    border-color: var(--accent);
  }

  .field-input.mono {
    font-family: var(--font-mono);
  }

  select.field-input {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }

  /* ── Instructions textarea ─────────────────────────────────────────────── */

  .instructions-textarea {
    width: 100%;
    min-height: 240px;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--bg-border);
    background: var(--bg-base);
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-mono);
    line-height: 1.6;
    resize: vertical;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .instructions-textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .char-counter {
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
    margin-top: 4px;
  }

  .char-counter.warning {
    color: var(--state-warning);
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* ── Provider cards ───────────────────────────────────────────────────── */

  .provider-card {
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    margin-bottom: 8px;
    background: var(--bg-surface);
  }

  .provider-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .provider-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .provider-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .provider-id {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .provider-key-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .provider-env-var {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    min-width: 160px;
  }

  .key-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }

  .key-status.set {
    background: rgba(16, 185, 129, 0.12);
    color: var(--state-running);
    border: 1px solid rgba(16, 185, 129, 0.25);
  }

  .key-status.missing {
    background: rgba(245, 158, 11, 0.12);
    color: var(--state-warning);
    border: 1px solid rgba(245, 158, 11, 0.25);
  }

  .masked-key {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  .btn-change-key,
  .btn-remove-provider {
    font-size: 11px;
    background: transparent;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-change-key {
    color: var(--accent);
    border: 1px solid var(--accent-border);
  }

  .btn-change-key:hover {
    background: var(--accent-subtle);
  }

  .btn-remove-provider {
    color: var(--state-error);
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .btn-remove-provider:hover {
    background: rgba(239, 68, 68, 0.08);
  }

  .key-edit-row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .key-edit-row .field-input {
    flex: 1;
  }

  .provider-actions {
    display: flex;
    gap: 6px;
  }

  .empty-state {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    border: 1px dashed var(--bg-border);
    border-radius: var(--radius-md);
  }

  /* ── Add form (provider / model alias) ─────────────────────────────────── */

  .add-form {
    border: 1px solid var(--accent-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin-top: 12px;
    background: var(--accent-subtle);
  }

  .add-form .field-grid {
    margin-bottom: 12px;
  }

  .add-form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* ── Model alias table ─────────────────────────────────────────────────── */

  .model-table {
    width: 100%;
    border-collapse: collapse;
  }

  .model-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border-bottom: 1px solid var(--bg-border);
  }

  .model-table td {
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--bg-border);
    font-family: var(--font-mono);
  }

  .model-table td:last-child {
    text-align: right;
  }

  /* ── Import section ───────────────────────────────────────────────────── */

  .import-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .import-row select {
    flex: 1;
  }

  .import-result {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.2);
    color: var(--state-running);
    font-size: 13px;
  }

  /* ── Avatar preview ───────────────────────────────────────────────────── */

  .avatar-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .avatar-preview {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ── Toast ────────────────────────────────────────────────────────────── */

  .toast {
    position: fixed;
    bottom: 80px;
    right: 24px;
    padding: 12px 20px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 500;
    z-index: 1000;
    animation: toast-in 0.3s ease-out;
    max-width: 400px;
  }

  .toast.success {
    background: rgba(16, 185, 129, 0.12);
    color: var(--state-running);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .toast.warning {
    background: rgba(245, 158, 11, 0.12);
    color: var(--state-warning);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .toast.error {
    background: rgba(239, 68, 68, 0.12);
    color: var(--state-error);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Loading state ────────────────────────────────────────────────────── */

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--text-muted);
    font-size: 14px;
    gap: 12px;
  }

  /* ── Responsive ─────────────────────────────────────────────────────────── */

  @media (max-width: 640px) {
    .settings-layout {
      flex-direction: column;
      padding: 12px;
      gap: 0;
    }

    .sidebar {
      flex: none;
      position: static;
      width: 100%;
      margin-bottom: 16px;
    }

    .sidebar-nav {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px;
    }

    .sidebar-item {
      width: auto;
      padding: 6px 12px;
      font-size: 12px;
      border: 1px solid var(--bg-border);
      border-radius: 20px;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }

    .settings-header {
      padding: 10px 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
  }
`;
