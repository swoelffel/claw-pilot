// ui/src/styles/instance-settings.styles.ts
// Styles for the cp-instance-settings component, extracted for readability.
import { css } from "lit";

export const instanceSettingsStyles = css`
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

  .settings-layout.pilot-layout {
    max-width: none;
    height: calc(100vh - 56px - 56px - 48px);
    padding: 16px;
    box-sizing: border-box;
  }

  .content.pilot-content {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }

  /* Pilot section (cp-runtime-pilot) fills all available height without scrolling —
     the component manages its own internal scroll */
  .content.pilot-content .section.pilot-section {
    flex: 1;
    margin-bottom: 0;
    min-height: 0;
    overflow: hidden;
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

  .header-title span {
    color: var(--text-muted);
    font-weight: 400;
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

  .sidebar-mcp-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 20px;
    background: rgba(16, 185, 129, 0.12);
    color: var(--state-running);
    border: 1px solid rgba(16, 185, 129, 0.25);
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
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .restart-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(245, 158, 11, 0.1);
    color: var(--state-warning);
    border: 1px solid rgba(245, 158, 11, 0.2);
    font-weight: 700;
    letter-spacing: 0.04em;
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

  .field-input[readonly] {
    opacity: 0.6;
    cursor: not-allowed;
  }

  select.field-input {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }

  .field-readonly {
    padding: 8px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--bg-border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: 13px;
    font-family: var(--font-mono);
  }

  /* ── Secret field ─────────────────────────────────────────────────────── */

  .secret-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .secret-row .field-input {
    flex: 1;
  }

  .btn-reveal {
    flex: none;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--bg-border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
  }

  .btn-reveal:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  /* ── Agent list ───────────────────────────────────────────────────────── */

  .agent-table {
    width: 100%;
    border-collapse: collapse;
  }

  .agent-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border-bottom: 1px solid var(--bg-border);
  }

  .agent-table td {
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--bg-border);
  }

  .agent-table td.mono {
    font-family: var(--font-mono);
  }

  .agent-table td .field-input {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
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

  /* ── Stopped banner ───────────────────────────────────────────────────── */

  .stopped-banner {
    background: rgba(100, 116, 139, 0.08);
    border: 1px solid rgba(100, 116, 139, 0.2);
    border-radius: var(--radius-md);
    padding: 10px 16px;
    color: var(--text-secondary);
    font-size: 12px;
    margin-bottom: 24px;
  }

  /* ── Toggle ───────────────────────────────────────────────────────────── */

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
  }

  .toggle-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .toggle {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--bg-border);
    cursor: pointer;
    border: none;
    transition: background 0.2s;
  }

  .toggle.on {
    background: var(--state-running);
  }

  .toggle::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
  }

  .toggle.on::after {
    transform: translateX(18px);
  }

  /* ── Number input ─────────────────────────────────────────────────────── */

  input[type="number"].field-input {
    -moz-appearance: textfield;
  }

  input[type="number"].field-input::-webkit-outer-spin-button,
  input[type="number"].field-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* ── Field validation ─────────────────────────────────────────────────── */

  .field-error {
    font-size: 11px;
    color: var(--state-error);
    margin-top: 4px;
  }

  .field-input.invalid {
    border-color: var(--state-error);
  }

  /* ── Provider cards ───────────────────────────────────────────────────── */

  .providers-section {
    margin-top: 24px;
  }

  .providers-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-subheader {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

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

  .btn-remove-provider {
    font-size: 11px;
    color: var(--state-error);
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.25);
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-remove-provider:hover {
    background: rgba(239, 68, 68, 0.08);
  }

  .btn-remove-provider:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .badge-new {
    font-size: 10px;
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-weight: 600;
  }

  .provider-add-row {
    margin-top: 8px;
  }

  .provider-add-row select {
    width: 100%;
  }

  /* ── Nav badge (pending devices count) ───────────────────────────────── */

  .nav-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--state-error);
    color: white;
    font-size: 10px;
    font-weight: 700;
    margin-left: 6px;
  }

  /* ── Save warning banner ──────────────────────────────────────────────── */

  .save-warning {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: var(--radius-md);
    padding: 10px 16px;
    color: var(--state-warning);
    font-size: 12px;
    margin-bottom: 16px;
  }

  /* ── Agent edit button (in agents table) ──────────────────────────────── */

  .btn-agent-edit {
    background: none;
    border: 1px solid var(--bg-border);
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .btn-agent-edit:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .btn-agent-edit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Agent panel drawer ───────────────────────────────────────────────── */

  .agent-panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 100;
  }

  .agent-panel-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(420px, 100vw);
    height: 100vh;
    z-index: 101;
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .agent-panel-drawer.expanded {
    width: 100vw;
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

  .agent-panel-drawer cp-agent-detail-panel {
    position: relative;
    width: 100%;
    height: 100%;
  }
`;
