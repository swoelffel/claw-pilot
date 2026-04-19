// ui/src/components/cp-start-cta.ts
//
// cp-start-cta — Centered animated "Start" button. Shown when the current
// agent's permanent session is empty. Calls the kickoff endpoint on click
// and dispatches `cp-kickoff-done` once the runtime accepts the greeting.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import { postAgentKickoff } from "../api.js";

@customElement("cp-start-cta")
export class StartCta extends LitElement {
  @property({ type: String }) slug = "";
  @property({ type: String }) agentId = "";

  @state() private _loading = false;
  @state() private _error: string | null = null;

  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 32px;
    }
    button {
      width: 160px;
      height: 160px;
      border-radius: 50%;
      border: none;
      background: radial-gradient(circle, var(--accent, #7c5cfc) 0%, #4a3fb5 100%);
      color: white;
      font-size: 20px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 0 0 0 rgba(124, 92, 252, 0.6);
      animation: pulse 2s infinite;
      transition: transform 0.15s ease;
    }
    button:hover:not(:disabled) {
      transform: scale(1.05);
    }
    button:disabled {
      cursor: wait;
      animation: none;
      opacity: 0.85;
    }
    .subtitle {
      font-size: 14px;
      color: var(--text-secondary, #888);
    }
    .error {
      font-size: 13px;
      color: var(--danger, #ef4444);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(124, 92, 252, 0.6);
      }
      70% {
        box-shadow: 0 0 0 24px rgba(124, 92, 252, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(124, 92, 252, 0);
      }
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      button {
        animation: none;
        box-shadow: 0 0 12px rgba(124, 92, 252, 0.6);
      }
      .spinner {
        animation-duration: 1.6s;
      }
    }
  `;

  private async _onClick(): Promise<void> {
    if (this._loading || !this.slug || !this.agentId) return;
    this._loading = true;
    this._error = null;
    this.dispatchEvent(new CustomEvent("cp-kickoff-start", { bubbles: true, composed: true }));
    try {
      const res = await postAgentKickoff(this.slug, this.agentId);
      this.dispatchEvent(
        new CustomEvent("cp-kickoff-done", {
          detail: { sessionId: res.sessionId, greeting: res.greeting },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = String((err as Error).message ?? err);
      this._loading = false;
    }
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${msg("Start", { id: "startCta.label" })}
        ?disabled=${this._loading}
        @click=${() => void this._onClick()}
      >
        ${this._loading
          ? html`<div class="spinner" role="status"></div>`
          : msg("Start", { id: "startCta.label" })}
      </button>
      <div class="subtitle">${msg("Say hello to your Pilot", { id: "startCta.subtitle" })}</div>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-start-cta": StartCta;
  }
}
