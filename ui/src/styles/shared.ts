import { css } from "lit";

export const badgeStyles = css`
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .badge.running {
    background: rgba(16, 185, 129, 0.08);
    color: var(--state-running);
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
  .badge.stopped {
    background: rgba(100, 116, 139, 0.08);
    color: var(--state-stopped);
    border: 1px solid rgba(100, 116, 139, 0.25);
  }
  .badge.error {
    background: rgba(239, 68, 68, 0.08);
    color: var(--state-error);
    border: 1px solid rgba(239, 68, 68, 0.25);
  }
  .badge.unknown, .badge.warning {
    background: rgba(245, 158, 11, 0.08);
    color: var(--state-warning);
    border: 1px solid rgba(245, 158, 11, 0.25);
  }
  .state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
`;

export const buttonStyles = css`
  .btn {
    flex: none;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: opacity 0.15s, background 0.15s;
    font-family: var(--font-ui);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border-color: var(--bg-border);
  }
  .btn-ghost:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .btn-start {
    background: rgba(16, 185, 129, 0.08);
    color: var(--state-running);
    border-color: rgba(16, 185, 129, 0.25);
    padding: 5px 10px;
    font-size: 11px;
  }
  .btn-start:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.15);
  }
  .btn-stop {
    background: rgba(239, 68, 68, 0.08);
    color: var(--state-error);
    border-color: rgba(239, 68, 68, 0.25);
    padding: 5px 10px;
    font-size: 11px;
  }
  .btn-stop:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.15);
  }
`;

export const sectionLabelStyles = css`
  .section-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
`;

export const spinnerStyles = css`
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--bg-border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

export const errorBannerStyles = css`
  .error-banner {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    color: var(--state-error);
    font-size: 13px;
  }
`;
