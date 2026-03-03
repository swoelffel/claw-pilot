import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PendingDevice, PairedDevice, DeviceList } from "../types.js";
import { fetchInstanceDevices, approveDevice, revokeDevice } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles } from "../styles/shared.js";

/** Format a timestamp (ms) as a relative human-readable string */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Get the most recent lastUsedAtMs across all tokens of a paired device */
function lastUsed(d: PairedDevice): number {
  const values = Object.values(d.tokens);
  if (values.length === 0) return d.approvedAtMs;
  const maxUsed = Math.max(...values.map((t) => t.lastUsedAtMs ?? t.createdAtMs));
  return maxUsed > 0 ? maxUsed : d.approvedAtMs;
}

@customElement("cp-instance-devices")
export class InstanceDevices extends LitElement {
  static styles = [tokenStyles, buttonStyles, spinnerStyles, css`
    :host {
      display: block;
    }

    .devices-panel {
      padding: 0;
    }

    .section-header {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--bg-border);
      margin-bottom: 16px;
    }

    /* --- Pending section --- */
    .pending-section {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      margin-bottom: 20px;
    }

    .pending-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .pending-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--state-warning);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* --- Device rows --- */
    .device-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid var(--bg-border);
    }

    .device-row:last-child {
      border-bottom: none;
    }

    .device-platform {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      font-family: var(--font-mono);
      min-width: 80px;
    }

    .device-client {
      font-size: 12px;
      color: var(--text-secondary);
      flex: 1;
    }

    .device-role {
      font-size: 11px;
      color: var(--text-muted);
    }

    .device-time {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .device-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    /* --- Badges --- */
    .badge-cli {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      background: rgba(100, 116, 139, 0.12);
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 700;
      font-family: var(--font-mono);
      border: 1px solid rgba(100, 116, 139, 0.2);
    }

    /* --- Buttons --- */
    .btn-approve {
      padding: 4px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(16, 185, 129, 0.3);
      background: rgba(16, 185, 129, 0.08);
      color: var(--state-running);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      white-space: nowrap;
    }

    .btn-approve:hover {
      background: rgba(16, 185, 129, 0.15);
    }

    .btn-approve:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-approve-all {
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(16, 185, 129, 0.3);
      background: rgba(16, 185, 129, 0.08);
      color: var(--state-running);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-approve-all:hover {
      background: rgba(16, 185, 129, 0.15);
    }

    .btn-revoke {
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .btn-revoke:hover {
      color: var(--state-error);
      border-color: rgba(239, 68, 68, 0.3);
      background: rgba(239, 68, 68, 0.08);
    }

    /* --- Confirm inline --- */
    .confirm-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--state-error);
    }

    .btn-confirm {
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(239, 68, 68, 0.3);
      background: rgba(239, 68, 68, 0.08);
      color: var(--state-error);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-confirm:hover {
      background: rgba(239, 68, 68, 0.15);
    }

    .btn-cancel-confirm {
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--bg-border);
      background: transparent;
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-cancel-confirm:hover {
      background: var(--bg-hover);
    }

    /* --- Paired section --- */
    .paired-section {
      margin-bottom: 20px;
    }

    .paired-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
    }

    .paired-list {
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .paired-list .device-row {
      padding: 8px 12px;
    }

    /* --- Footer --- */
    .footer {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-refresh {
      padding: 5px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--bg-border);
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .btn-refresh:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .error-msg {
      font-size: 12px;
      color: var(--state-error);
    }

    .empty-msg {
      font-size: 13px;
      color: var(--text-muted);
      padding: 12px 0;
    }
  `];

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  @state() private _devices: DeviceList | null = null;
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _confirmRevoke: string | null = null;
  @state() private _pollTimer: ReturnType<typeof setInterval> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.active) {
      void this._load();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopPolling();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("active")) {
      if (this.active) {
        void this._load();
      } else {
        this._stopPolling();
      }
    }
  }

  private async _load(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      this._devices = await fetchInstanceDevices(this.slug);
      // Emit pending count for parent badge
      this.dispatchEvent(new CustomEvent("pending-count-changed", {
        detail: this._devices?.pending.length ?? 0,
        bubbles: true,
        composed: true,
      }));
      // Start polling if there are pending devices, stop otherwise
      if ((this._devices?.pending.length ?? 0) > 0) {
        this._startPolling();
      } else {
        this._stopPolling();
      }
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private _startPolling(): void {
    if (this._pollTimer !== null) return;
    this._pollTimer = setInterval(() => { void this._load(); }, 5000);
  }

  private _stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _approve(requestId: string): Promise<void> {
    try {
      await approveDevice(this.slug, requestId);
      await this._load();
    } catch (err) {
      this._error = userMessage(err);
    }
  }

  private async _approveAll(): Promise<void> {
    if (!this._devices) return;
    for (const d of this._devices.pending) {
      try {
        await approveDevice(this.slug, d.requestId);
      } catch {
        // Continue with remaining devices even if one fails
      }
    }
    await this._load();
  }

  private async _revoke(deviceId: string): Promise<void> {
    try {
      await revokeDevice(this.slug, deviceId);
      this._confirmRevoke = null;
      await this._load();
    } catch (err) {
      this._error = userMessage(err);
      this._confirmRevoke = null;
    }
  }

  private _renderPendingDevice(d: PendingDevice) {
    return html`
      <div class="device-row">
        <span class="device-platform">${d.platform}</span>
        <span class="device-client">${d.clientId}</span>
        <span class="device-time">${relativeTime(d.ts)}</span>
        <div class="device-actions">
          <button
            class="btn-approve"
            @click=${() => { void this._approve(d.requestId); }}
          >Approve</button>
        </div>
      </div>
    `;
  }

  private _renderPairedDevice(d: PairedDevice) {
    const isCli = d.clientId === "cli";
    const isConfirming = this._confirmRevoke === d.deviceId;

    return html`
      <div class="device-row">
        <span class="device-platform">${d.platform}</span>
        <span class="device-client">${d.clientId}</span>
        <span class="device-role">${d.role}</span>
        <span class="device-time">${relativeTime(lastUsed(d))}</span>
        <div class="device-actions">
          ${isCli
            ? html`<span class="badge-cli">cli</span>`
            : isConfirming
              ? html`
                  <div class="confirm-row">
                    <span>Revoke?</span>
                    <button class="btn-confirm" @click=${() => { void this._revoke(d.deviceId); }}>Confirm</button>
                    <button class="btn-cancel-confirm" @click=${() => { this._confirmRevoke = null; }}>Cancel</button>
                  </div>
                `
              : html`
                  <button
                    class="btn-revoke"
                    title="Revoke device"
                    @click=${() => { this._confirmRevoke = d.deviceId; }}
                  >✕</button>
                `}
        </div>
      </div>
    `;
  }

  override render() {
    const devices = this._devices;

    return html`
      <div class="devices-panel">
        <div class="section-header">Devices</div>

        ${this._loading && !devices
          ? html`<div class="spinner"></div>`
          : nothing}

        ${devices && devices.pending.length > 0
          ? html`
            <div class="pending-section">
              <div class="pending-header">
                <span class="pending-title">Pending (${devices.pending.length})</span>
                ${devices.pending.length > 1
                  ? html`<button class="btn-approve-all" @click=${() => { void this._approveAll(); }}>Approve all</button>`
                  : nothing}
              </div>
              ${devices.pending.map((d) => this._renderPendingDevice(d))}
            </div>
          `
          : nothing}

        ${devices
          ? html`
            <div class="paired-section">
              <div class="paired-title">Paired (${devices.paired.length})</div>
              ${devices.paired.length > 0
                ? html`
                  <div class="paired-list">
                    ${devices.paired.map((d) => this._renderPairedDevice(d))}
                  </div>
                `
                : html`<p class="empty-msg">No paired devices.</p>`}
            </div>
          `
          : nothing}

        <div class="footer">
          <button class="btn-refresh" @click=${() => { void this._load(); }}>↻ Refresh</button>
          ${this._error
            ? html`<span class="error-msg">${this._error}</span>`
            : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-devices": InstanceDevices;
  }
}
