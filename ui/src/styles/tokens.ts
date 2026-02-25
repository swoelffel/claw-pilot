import { css } from "lit";

export const tokenStyles = css`
  :host {
    --bg-base:        #0f1117;
    --bg-surface:     #1a1d27;
    --bg-hover:       #1e2130;
    --bg-border:      #2a2d3a;

    --accent:         #4f6ef7;
    --accent-hover:   #6b85f8;
    --accent-subtle:  rgba(79, 110, 247, 0.08);
    --accent-border:  rgba(79, 110, 247, 0.25);

    --text-primary:   #e2e8f0;
    --text-secondary: #94a3b8;
    --text-muted:     #4a5568;

    --state-running:  #10b981;
    --state-stopped:  #64748b;
    --state-error:    #ef4444;
    --state-warning:  #f59e0b;
    --state-info:     #0ea5e9;

    --font-ui:   'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'Geist Mono', monospace;

    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;

    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-6: 24px;
    --space-8: 32px;

    --focus-ring: 0 0 0 2px rgba(79, 110, 247, 0.5);
  }

  :host *:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
`;
