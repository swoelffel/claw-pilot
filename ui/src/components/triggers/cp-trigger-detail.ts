// ui/src/components/triggers/cp-trigger-detail.ts
//
// Trigger detail drawer with three tabs: Settings, Runs, Test.

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

type Tab = "settings" | "runs" | "test";

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
        top: 0;
        right: 0;
        width: min(560px, 100vw);
        height: 100vh;
        background: var(--surface);
        color: var(--text-primary);
        border-left: 1px solid var(--border);
        z-index: 90;
        font-family: var(--font-ui);
        overflow: auto;
      }
      header {
        padding: 16px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .tabs {
        display: flex;
        gap: 4px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border);
      }
      .tab {
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        font-size: 13px;
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
        border-bottom: 1px solid var(--border);
      }
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: var(--surface-alt);
        color: var(--text-secondary);
      }
      .badge.succeeded {
        color: var(--state-success);
      }
      .badge.failed {
        color: var(--state-error);
      }
      .badge.running {
        color: var(--accent);
      }
      pre {
        background: var(--surface-alt);
        padding: 10px;
        border-radius: 4px;
        overflow: auto;
        font-size: 12px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--border);
      }
      .label {
        color: var(--text-secondary);
        font-size: 12px;
      }
      .value {
        font-family: var(--font-mono);
        font-size: 12px;
      }
    `,
  ];

  @property({ type: Number }) triggerId = 0;

  @state() private _detail: FlowTriggerDetail | null = null;
  @state() private _tab: Tab = "settings";
  @state() private _error = "";
  @state() private _runs: FlowTriggerRun[] = [];
  @state() private _revealedSecret = "";
  @state() private _rotateMessage = "";
  @state() private _busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  private async _load(): Promise<void> {
    try {
      this._detail = await getTrigger(this.triggerId);
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
      await fireTrigger(this.triggerId);
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
      const result = await rotateTriggerSecret(this.triggerId);
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
      const result = await revealTriggerSecret(this.triggerId);
      this._revealedSecret = result.secret;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._busy = false;
    }
  }

  private async _refreshRuns(): Promise<void> {
    try {
      const r = await listTriggerRuns(this.triggerId, { limit: 50 });
      this._runs = r.runs;
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private _renderSettings() {
    if (!this._detail) return html`<p>${msg("Loading...", { id: "trigger-detail-loading" })}</p>`;
    const d = this._detail;
    return html`
      <div class="row">
        <span class="label">${msg("Name", { id: "trigger-detail-name" })}</span>
        <span class="value">${d.name}</span>
      </div>
      <div class="row">
        <span class="label">${msg("Kind", { id: "trigger-detail-kind" })}</span>
        <span class="value">${d.kind}</span>
      </div>
      <div class="row">
        <span class="label">${msg("Instance", { id: "trigger-detail-instance" })}</span>
        <span class="value">${d.instanceSlug}</span>
      </div>
      <div class="row">
        <span class="label">${msg("Flow", { id: "trigger-detail-flow" })}</span>
        <span class="value">#${d.flowId}</span>
      </div>
      <div class="row">
        <span class="label">${msg("Enabled", { id: "trigger-detail-enabled" })}</span>
        <span class="value">${d.enabled ? "yes" : "no"}</span>
      </div>
      ${d.kind === "cron"
        ? html`
            <div class="row">
              <span class="label">${msg("Cron", { id: "trigger-detail-cron" })}</span>
              <span class="value">${d.cronExpr ?? ""} ${d.cronTz ?? ""}</span>
            </div>
          `
        : html`
            <div class="row">
              <span class="label">${msg("Webhook slug", { id: "trigger-detail-slug" })}</span>
              <span class="value">${d.webhookSlug ?? ""}</span>
            </div>
          `}
      <div class="row">
        <span class="label">${msg("Last fired", { id: "trigger-detail-last-fired" })}</span>
        <span class="value">${d.lastFiredAt ?? "—"}</span>
      </div>
    `;
  }

  private _renderRuns() {
    if (this._runs.length === 0) {
      return html`<p>${msg("No runs yet", { id: "trigger-detail-no-runs" })}</p>`;
    }
    return html`
      <button class="btn" type="button" @click=${this._refreshRuns}>
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
        ? `curl -X POST -H 'X-ClawPilot-Signature: sha256=<hex>' -H 'Content-Type: application/json' --data-raw '{}' ${baseUrl}/webhooks/triggers/${d.webhookSlug ?? ""}`
        : "";
    return html`
      <button class="btn primary" type="button" ?disabled=${this._busy} @click=${this._onFire}>
        ${msg("Fire now", { id: "trigger-detail-fire" })}
      </button>
      ${this._rotateMessage ? html`<p>${this._rotateMessage}</p>` : ""}
      ${d.kind === "webhook"
        ? html`
            <h3>${msg("Webhook secret", { id: "trigger-detail-webhook-secret" })}</h3>
            <button class="btn" type="button" ?disabled=${this._busy} @click=${this._onReveal}>
              ${msg("Reveal once", { id: "trigger-detail-reveal" })}
            </button>
            <button class="btn" type="button" ?disabled=${this._busy} @click=${this._onRotate}>
              ${msg("Rotate", { id: "trigger-detail-rotate" })}
            </button>
            ${this._revealedSecret
              ? html`<pre>${this._revealedSecret}</pre>`
              : html`<pre>${"*".repeat(32)}</pre>`}
            <h3>${msg("curl example", { id: "trigger-detail-curl" })}</h3>
            <pre>${curl}</pre>
          `
        : ""}
    `;
  }

  override render() {
    return html`
      <header>
        <h2>${this._detail?.name ?? msg("Trigger", { id: "trigger-detail-title" })}</h2>
        <button class="btn" type="button" @click=${this._close}>
          ${msg("Close", { id: "trigger-detail-close" })}
        </button>
      </header>
      ${this._error ? html`<div class="error-banner">${this._error}</div>` : ""}
      <div class="tabs">
        <div
          class="tab ${this._tab === "settings" ? "active" : ""}"
          @click=${() => (this._tab = "settings")}
        >
          ${msg("Settings", { id: "trigger-detail-tab-settings" })}
        </div>
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
        ${this._tab === "settings" ? this._renderSettings() : ""}
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
