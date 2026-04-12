// ui/src/components/home-screen.ts
//
// cp-home-screen — Dashboard home screen.
// Three states: wizard (no API keys), provisioning, chat (system instance ready).

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { msg } from "@lit/localize";
import {
  fetchNamedKeys,
  fetchSystemStatus,
  ensureSystemInstance,
  fetchSystemReady,
} from "../api.js";
import type { NamedApiKey } from "../types.js";
import "./home-wizard.js";

type HomeState = "loading" | "wizard" | "provisioning" | "starting" | "ready" | "error";

@customElement("cp-home-screen")
export class HomeScreen extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .state-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 16px;
      color: var(--text-secondary, #888);
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border, #333);
      border-top-color: var(--accent, #7c5cfc);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .status-text {
      font-size: 14px;
      text-align: center;
      max-width: 400px;
    }

    .error-text {
      color: var(--danger, #ef4444);
      font-size: 13px;
    }

    .retry-btn {
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid var(--border, #333);
      background: var(--surface, #1a1a2e);
      color: var(--text-primary, #e0e0e0);
      cursor: pointer;
      font-size: 13px;
    }
    .retry-btn:hover {
      background: var(--surface-hover, #252540);
    }

    /* Full-height pilot container */
    .pilot-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    .pilot-header {
      display: flex;
      align-items: center;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border, #333);
      gap: 10px;
    }

    .pilot-header h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #e0e0e0);
    }

    .pilot-header .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--accent, #7c5cfc);
      color: #fff;
      font-weight: 500;
    }
  `;

  @state() private _state: HomeState = "loading";
  @state() private _systemSlug: string | null = null;
  @state() private _error: string | null = null;
  @state() private _keys: NamedApiKey[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    void this._init();
  }

  private async _init(): Promise<void> {
    this._state = "loading";
    this._error = null;

    try {
      // 1. Check if any API keys exist
      const { keys } = await fetchNamedKeys();
      this._keys = keys;

      if (keys.length === 0) {
        this._state = "wizard";
        return;
      }

      // 2. Check system instance status
      const status = await fetchSystemStatus();

      if (!status.provisioned) {
        // Auto-provision with the first available key
        this._state = "provisioning";
        await this._provisionAndStart(keys[0]!.id);
        return;
      }

      if (!status.running) {
        // Provisioned but stopped — start it
        this._state = "starting";
        await this._startAndWait();
        return;
      }

      // Ready!
      this._systemSlug = status.slug;
      this._state = "ready";
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._state = "error";
    }
  }

  private async _provisionAndStart(namedKeyId: number): Promise<void> {
    try {
      const result = await ensureSystemInstance(namedKeyId);
      this._systemSlug = result.slug;

      if (result.status === "running") {
        this._state = "ready";
        return;
      }

      // Poll until ready
      await this._pollUntilReady();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._state = "error";
    }
  }

  private async _startAndWait(): Promise<void> {
    try {
      const result = await ensureSystemInstance(this._keys[0]!.id);
      this._systemSlug = result.slug;
      await this._pollUntilReady();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._state = "error";
    }
  }

  private async _pollUntilReady(): Promise<void> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { ready, slug } = await fetchSystemReady();
      if (ready) {
        this._systemSlug = slug ?? null;
        this._state = "ready";
        return;
      }
    }
    this._error = "System instance did not become ready in time";
    this._state = "error";
  }

  private _handleWizardComplete(): void {
    // Re-init after wizard completes (keys now exist)
    void this._init();
  }

  override render() {
    switch (this._state) {
      case "loading":
        return html`
          <div class="state-container">
            <div class="spinner"></div>
            <div class="status-text">${msg("Loading...", { id: "home-loading" })}</div>
          </div>
        `;

      case "wizard":
        return html`
          <cp-home-wizard @wizard-complete=${this._handleWizardComplete}></cp-home-wizard>
        `;

      case "provisioning":
        return html`
          <div class="state-container">
            <div class="spinner"></div>
            <div class="status-text">
              ${msg("Setting up system instance...", { id: "home-provisioning" })}
            </div>
          </div>
        `;

      case "starting":
        return html`
          <div class="state-container">
            <div class="spinner"></div>
            <div class="status-text">
              ${msg("Starting system instance...", { id: "home-starting" })}
            </div>
          </div>
        `;

      case "error":
        return html`
          <div class="state-container">
            <div class="error-text">${this._error}</div>
            <button class="retry-btn" @click=${() => void this._init()}>
              ${msg("Retry", { id: "home-retry" })}
            </button>
          </div>
        `;

      case "ready":
        return html`
          <div class="pilot-container">
            <div class="pilot-header">
              <h2>${msg("ClawPilot Assistant", { id: "home-assistant-title" })}</h2>
              <span class="badge">System</span>
            </div>
            <cp-runtime-pilot .slug=${this._systemSlug}></cp-runtime-pilot>
          </div>
        `;
    }
  }
}
