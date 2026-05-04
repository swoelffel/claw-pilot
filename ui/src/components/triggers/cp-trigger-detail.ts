// ui/src/components/triggers/cp-trigger-detail.ts
//
// Trigger history drawer with two tabs: Runs (default) and Test. The previous
// Settings tab has been promoted to the trigger wizard's edit mode — clicking
// Edit on a trigger row reopens the wizard pre-filled instead.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles, errorBannerStyles } from "../../styles/shared.js";
import {
  fireTrigger,
  getTrigger,
  listTriggerRuns,
  revealTriggerSecret,
  rotateTriggerSecret,
  type FlowTriggerDetail,
  type FlowTriggerRun,
} from "../../api.js";
import { userMessage } from "../../lib/error-messages.js";

type Tab = "runs" | "test";

@localized()
@customElement("cp-trigger-detail")
export class CpTriggerDetail extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    errorBannerStyles,
    css`
      :host {
        display: block;
        position: fixed;
        top: 56px;
        right: 0;
        width: min(560px, 100vw);
        height: calc(100vh - 56px);
        background: var(--bg-surface);
        color: var(--text-primary);
        border-left: 1px solid var(--bg-border);
        border-top: 1px solid var(--bg-border);
        z-index: 90;
        font-family: var(--font-ui);
        overflow: auto;
        transition: width 160ms ease-out;
      }
      :host([data-fullscreen]) {
        width: 100vw;
      }
      header {
        padding: 16px;
        border-bottom: 1px solid var(--bg-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      header h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .icon-btn {
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        min-width: 32px;
        min-height: 28px;
      }
      .icon-btn:hover {
        background: var(--accent-subtle);
        border-color: var(--accent-border);
        color: var(--accent);
      }
      .close-btn {
        font-size: 18px;
      }
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--bg-border);
      }
      .tab {
        padding: 8px 14px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
      }
      .tab:hover {
        color: var(--text-secondary);
      }
      .tab.active {
        border-bottom-color: var(--accent);
        color: var(--accent);
      }
      .body {
        padding: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      th,
      td {
        text-align: left;
        padding: 6px;
        border-bottom: 1px solid var(--bg-border);
      }
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
        background: rgba(100, 116, 139, 0.08);
        color: var(--text-secondary);
        border: 1px solid rgba(100, 116, 139, 0.25);
      }
      .badge.succeeded,
      .badge.completed,
      .badge.running {
        background: rgba(16, 185, 129, 0.08);
        color: var(--state-running);
        border-color: rgba(16, 185, 129, 0.25);
      }
      .badge.failed,
      .badge.error {
        background: rgba(239, 68, 68, 0.08);
        color: var(--state-error);
        border-color: rgba(239, 68, 68, 0.25);
      }
      .badge.pending,
      .badge.starting {
        background: rgba(245, 158, 11, 0.08);
        color: var(--state-warning);
        border-color: rgba(245, 158, 11, 0.25);
      }
      pre {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        padding: 10px;
        border-radius: var(--radius-md);
        overflow: auto;
        font-size: 12px;
        font-family: var(--font-mono);
      }
      .row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--bg-border);
      }
      .label {
        color: var(--text-secondary);
        font-size: 12px;
      }
      .value {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-primary);
      }
      .test-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .test-message {
        margin-top: 12px;
        font-size: 13px;
        color: var(--text-secondary);
      }
      h3 {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin: 16px 0 8px;
      }
    `,
  ];

  @property({ type: String }) instanceSlug = "";
  @property({ type: Number }) triggerId = 0;

  @state() private _detail: FlowTriggerDetail | null = null;
  @state() private _tab: Tab = "runs";
  @state() private _error = "";
  @state() private _runs: FlowTriggerRun[] = [];
  @state() private _revealedSecret = "";
  @state() private _rotateMessage = "";
  @state() private _busy = false;
  @state() private _fullscreen = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    try {
      this._detail = await getTrigger(this.instanceSlug, this.triggerId);
      this._runs = this._detail.runs;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private async _onFire(): Promise<void> {
    this._busy = true;
    try {
      await fireTrigger(this.instanceSlug, this.triggerId);
      this._rotateMessage = msg("Fire requested", { id: "trigger-detail-fire-ok" });
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._busy = false;
    }
  }

  private async _onRotate(): Promise<void> {
    this._busy = true;
    try {
      const result = await rotateTriggerSecret(this.instanceSlug, this.triggerId);
      this._revealedSecret = result.secret;
      this._rotateMessage = msg("Secret rotated. Copy it now — it will not be shown again.", {
        id: "trigger-detail-rotate-ok",
      });
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._busy = false;
    }
  }

  private async _onReveal(): Promise<void> {
    this._busy = true;
    try {
      const result = await revealTriggerSecret(this.instanceSlug, this.triggerId);
      this._revealedSecret = result.secret;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._busy = false;
    }
  }

  private async _refreshRuns(): Promise<void> {
    try {
      const r = await listTriggerRuns(this.instanceSlug, this.triggerId, { limit: 50 });
      this._runs = r.runs;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _renderRuns() {
    if (this._runs.length === 0) {
      return html`<p>${msg("No runs yet", { id: "trigger-detail-no-runs" })}</p>`;
    }
    return html`
      <button class="btn btn-ghost" type="button" @click=${this._refreshRuns}>
        ${msg("Refresh", { id: "trigger-detail-refresh" })}
      </button>
      <table>
        <thead>
          <tr>
            <th>${msg("Fired at", { id: "trigger-detail-runs-fired" })}</th>
            <th>${msg("Status", { id: "trigger-detail-runs-status" })}</th>
            <th>${msg("Flow run", { id: "trigger-detail-runs-flow-run" })}</th>
            <th>${msg("Error", { id: "trigger-detail-runs-error" })}</th>
          </tr>
        </thead>
        <tbody>
          ${this._runs.map(
            (r) => html`
              <tr>
                <td>${r.fired_at}</td>
                <td><span class="badge ${r.status}">${r.status}</span></td>
                <td>${r.flow_run_id ?? "—"}</td>
                <td>${r.error ?? ""}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }

  private _renderTest() {
    if (!this._detail) return html`<p>${msg("Loading...", { id: "trigger-detail-loading" })}</p>`;
    const d = this._detail;
    const baseUrl = `${window.location.protocol}//${window.location.host}`;
    const curl =
      d.kind === "webhook"
        ? `curl -X POST -H 'X-ClawPilot-Signature: sha256=<hex>' -H 'Content-Type: application/json' --data-raw '{}' ${baseUrl}/webhooks/triggers/${d.instanceSlug}/${d.webhookSlug ?? ""}`
        : "";
    return html`
      <div class="test-actions">
        <button
          class="btn btn-primary"
          type="button"
          ?disabled=${this._busy}
          @click=${this._onFire}
        >
          ${msg("Fire now", { id: "trigger-detail-fire" })}
        </button>
      </div>
      ${this._rotateMessage ? html`<p class="test-message">${this._rotateMessage}</p>` : ""}
      ${d.kind === "webhook"
        ? html`
            <h3>${msg("Webhook secret", { id: "trigger-detail-webhook-secret" })}</h3>
            <div class="test-actions">
              <button
                class="btn btn-ghost"
                type="button"
                ?disabled=${this._busy}
                @click=${this._onReveal}
              >
                ${msg("Reveal once", { id: "trigger-detail-reveal" })}
              </button>
              <button
                class="btn btn-danger"
                type="button"
                ?disabled=${this._busy}
                @click=${this._onRotate}
              >
                ${msg("Rotate", { id: "trigger-detail-rotate" })}
              </button>
            </div>
            ${this._revealedSecret
              ? html`<pre>${this._revealedSecret}</pre>`
              : html`<pre>${"*".repeat(32)}</pre>`}
            <h3>${msg("curl example", { id: "trigger-detail-curl" })}</h3>
            <pre>${curl}</pre>
          `
        : ""}
    `;
  }

  private _toggleFullscreen(): void {
    this._fullscreen = !this._fullscreen;
    if (this._fullscreen) {
      this.setAttribute("data-fullscreen", "");
    } else {
      this.removeAttribute("data-fullscreen");
    }
  }

  override render() {
    return html`
      <header>
        <h2>${this._detail?.name ?? msg("Trigger", { id: "trigger-detail-title" })}</h2>
        <div class="header-actions">
          <button
            class="icon-btn"
            type="button"
            aria-label=${this._fullscreen
              ? msg("Collapse", { id: "trigger-detail-collapse" })
              : msg("Expand", { id: "trigger-detail-expand" })}
            title=${this._fullscreen
              ? msg("Collapse", { id: "trigger-detail-collapse" })
              : msg("Expand", { id: "trigger-detail-expand" })}
            @click=${this._toggleFullscreen}
          >
            ${this._fullscreen ? ">" : "<"}
          </button>
          <button
            class="icon-btn close-btn"
            type="button"
            aria-label=${msg("Close", { id: "trigger-detail-close" })}
            @click=${this._close}
          >
            ✕
          </button>
        </div>
      </header>
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
      <div class="tabs">
        <div
          class="tab ${this._tab === "runs" ? "active" : ""}"
          @click=${() => (this._tab = "runs")}
        >
          ${msg("Runs", { id: "trigger-detail-tab-runs" })}
        </div>
        <div
          class="tab ${this._tab === "test" ? "active" : ""}"
          @click=${() => (this._tab = "test")}
        >
          ${msg("Test", { id: "trigger-detail-tab-test" })}
        </div>
      </div>
      <div class="body">
        ${this._tab === "runs" ? this._renderRuns() : ""}
        ${this._tab === "test" ? this._renderTest() : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-trigger-detail": CpTriggerDetail;
  }
}
