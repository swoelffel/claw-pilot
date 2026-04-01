// ui/src/styles/named-keys-panel.styles.ts
// Styles for the cp-named-keys-panel component.
import { css } from "lit";

export const namedKeysPanelStyles = css`
  :host {
    display: block;
    min-height: calc(100vh - 56px - 48px);
  }

  /* -- Header bar --------------------------------------------------------- */

  .panel-header {
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

  /* -- Content area ------------------------------------------------------- */

  .content {
    padding: 16px;
    max-width: 900px;
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

  /* -- Warning banner ----------------------------------------------------- */

  .crypto-warning {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: rgba(245, 158, 11, 0.08);
    color: var(--state-warning);
    border: 1px solid rgba(245, 158, 11, 0.25);
    font-size: 13px;
    margin-bottom: 20px;
  }

  /* -- Keys table --------------------------------------------------------- */

  .keys-table {
    width: 100%;
    border-collapse: collapse;
  }

  .keys-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border-bottom: 1px solid var(--bg-border);
  }

  .keys-table td {
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--bg-border);
    vertical-align: middle;
  }

  .keys-table td.mono {
    font-family: var(--font-mono);
  }

  .keys-table td.actions {
    text-align: right;
    white-space: nowrap;
  }

  .keys-table tr:hover td {
    background: var(--bg-hover);
  }

  /* -- Action buttons (inline table) -------------------------------------- */

  .btn-action {
    font-size: 11px;
    background: transparent;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-edit {
    color: var(--accent);
    border: 1px solid var(--accent-border);
  }

  .btn-edit:hover {
    background: var(--accent-subtle);
  }

  .btn-delete {
    color: var(--state-error);
    border: 1px solid rgba(239, 68, 68, 0.25);
    margin-left: 6px;
  }

  .btn-delete:hover {
    background: rgba(239, 68, 68, 0.08);
  }

  /* -- Empty state -------------------------------------------------------- */

  .empty-state {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    border: 1px dashed var(--bg-border);
    border-radius: var(--radius-md);
  }

  /* -- Add/Edit form ------------------------------------------------------ */

  .key-form {
    border: 1px solid var(--accent-border);
    border-radius: var(--radius-md);
    padding: 16px;
    margin-top: 12px;
    background: var(--accent-subtle);
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 12px;
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

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* -- Confirm dialog ----------------------------------------------------- */

  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .confirm-dialog {
    background: var(--bg-surface);
    border: 1px solid var(--bg-border);
    border-radius: var(--radius-md);
    padding: 20px;
    max-width: 400px;
    width: 100%;
  }

  .confirm-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 12px;
  }

  .confirm-message {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* -- Toast -------------------------------------------------------------- */

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

  /* -- Loading state ------------------------------------------------------ */

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--text-muted);
    font-size: 14px;
    gap: 12px;
  }

  /* -- Responsive --------------------------------------------------------- */

  @media (max-width: 640px) {
    .content {
      padding: 12px;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }
  }
`;
