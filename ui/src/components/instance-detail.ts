import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { InstanceInfo, AgentInfo, ConversationEntry } from "../types.js";
import {
  fetchInstance,
  fetchAgents,
  fetchConversations,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
} from "../api.js";
import { userMessage } from "../lib/error-messages.js";


@localized()
@customElement("cp-instance-detail")
export class InstanceDetail extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 24px;
      max-width: 1100px;
      margin: 0 auto;
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: 1px solid #2a2d3a;
      color: #94a3b8;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      margin-bottom: 24px;
      transition: border-color 0.15s, color 0.15s;
    }

    .back-btn:hover {
      border-color: #6c63ff;
      color: #e2e8f0;
    }

    .detail-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 28px;
    }

    .detail-title {
      font-size: 28px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: -0.02em;
    }

    .detail-subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-top: 4px;
    }

    .state-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .state-badge.running {
      background: #10b98120;
      color: #10b981;
      border: 1px solid #10b98140;
    }

    .state-badge.stopped {
      background: #64748b20;
      color: #64748b;
      border: 1px solid #64748b40;
    }

    .state-badge.error {
      background: #ef444420;
      color: #ef4444;
      border: 1px solid #ef444440;
    }

    .state-badge.unknown {
      background: #f59e0b20;
      color: #f59e0b;
      border: 1px solid #f59e0b40;
    }

    .state-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 28px;
      align-items: center;
      flex-wrap: wrap;
    }

    .btn {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: opacity 0.15s, background 0.15s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-start {
      background: #10b98120;
      color: #10b981;
      border-color: #10b98140;
    }

    .btn-start:hover:not(:disabled) {
      background: #10b98130;
    }

    .btn-stop {
      background: #ef444420;
      color: #ef4444;
      border-color: #ef444440;
    }

    .btn-stop:hover:not(:disabled) {
      background: #ef444430;
    }

    .btn-restart {
      background: #6c63ff20;
      color: #6c63ff;
      border-color: #6c63ff40;
    }

    .btn-restart:hover:not(:disabled) {
      background: #6c63ff30;
    }

    .btn-ui {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid #f59e0b40;
      background: #f59e0b20;
      color: #f59e0b;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-ui:hover {
      background: #f59e0b30;
    }

    .section {
      background: #1a1d27;
      border: 1px solid #2a2d3a;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 16px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-label {
      font-size: 11px;
      color: #4a5568;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .info-value {
      font-size: 14px;
      color: #e2e8f0;
      font-family: "Fira Mono", monospace;
      word-break: break-all;
    }

    .info-link {
      color: #6c63ff;
      text-decoration: none;
      font-size: 14px;
      font-family: "Fira Mono", monospace;
    }

    .info-link:hover {
      text-decoration: underline;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead th {
      text-align: left;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      color: #4a5568;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #2a2d3a;
    }

    tbody td {
      padding: 10px 12px;
      color: #94a3b8;
      border-bottom: 1px solid #1e2130;
      font-family: "Fira Mono", monospace;
      font-size: 12px;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    tbody tr:hover td {
      background: #1e2130;
    }

    .default-badge {
      display: inline-block;
      background: #6c63ff20;
      color: #6c63ff;
      border: 1px solid #6c63ff40;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-left: 6px;
    }

    .empty-agents {
      text-align: center;
      padding: 24px;
      color: #4a5568;
      font-size: 13px;
    }

    .error-banner {
      background: #ef444420;
      border: 1px solid #ef444440;
      border-radius: 8px;
      padding: 12px 16px;
      color: #ef4444;
      font-size: 13px;
      margin-bottom: 20px;
    }

    .loading {
      text-align: center;
      padding: 60px 20px;
      color: #4a5568;
      font-size: 14px;
    }

    .action-error {
      font-size: 12px;
      color: #ef4444;
      margin-top: 8px;
    }

    .btn-delete {
      background: #ef444415;
      color: #ef4444;
      border-color: #ef444440;
      margin-left: auto;
    }

    .btn-delete:hover:not(:disabled) {
      background: #ef444425;
    }

    /* Inline delete confirmation */
    .delete-confirm {
      background: #ef444410;
      border: 1px solid #ef444440;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .delete-confirm-title {
      font-size: 13px;
      font-weight: 600;
      color: #ef4444;
    }

    .delete-confirm-hint {
      font-size: 12px;
      color: #94a3b8;
    }

    .delete-confirm-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .delete-confirm-row input {
      flex: 1;
      background: #0f1117;
      border: 1px solid #ef444440;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 13px;
      padding: 7px 10px;
      outline: none;
      font-family: "Fira Mono", monospace;
    }

    .delete-confirm-row input:focus {
      border-color: #ef4444;
    }

    .btn-confirm-delete {
      background: #ef4444;
      color: #fff;
      border: none;
      padding: 7px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }

    .btn-confirm-delete:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-confirm-delete:hover:not(:disabled) {
      background: #dc2626;
    }

    .btn-cancel-delete {
      background: #2a2d3a;
      color: #94a3b8;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-cancel-delete:hover {
      background: #363a4a;
    }

    /* Conversation log */
    .conv-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .conv-entry {
      display: grid;
      grid-template-columns: 76px 1fr 2fr;
      gap: 12px;
      align-items: baseline;
      padding: 8px 4px;
      border-bottom: 1px solid #1e2130;
      font-size: 12px;
    }

    .conv-entry:last-child {
      border-bottom: none;
    }

    .conv-time {
      font-family: "Fira Mono", monospace;
      color: #4a5568;
      font-size: 11px;
      white-space: nowrap;
    }

    .conv-route {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }

    .conv-from {
      color: #6c63ff;
      font-family: "Fira Mono", monospace;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100px;
    }

    .conv-arrow {
      color: #4a5568;
      flex-shrink: 0;
    }

    .conv-to {
      color: #10b981;
      font-family: "Fira Mono", monospace;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100px;
    }

    .conv-msg {
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .conv-status-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-right: 4px;
      flex-shrink: 0;
    }

    .conv-status-dot.running {
      background: #f59e0b;
    }

    .conv-status-dot.done {
      background: #10b981;
    }

    .conv-status-dot.failed {
      background: #ef4444;
    }
  `;

  @property({ type: String }) slug = "";

  @state() private _instance: InstanceInfo | null = null;
  @state() private _agents: AgentInfo[] = [];
  @state() private _gatewayToken: string | null = null;
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _actionLoading = false;
  @state() private _showDeleteConfirm = false;
  @state() private _deleteSlugInput = "";
  @state() private _deleting = false;
  @state() private _conversations: ConversationEntry[] = [];
  @state() private _convLoading = true;

  private _boundWsHandler = this._handleWsMessage.bind(this);

  override connectedCallback(): void {
    super.connectedCallback();
    this._load();
    window.addEventListener("cp-ws-message", this._boundWsHandler as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("cp-ws-message", this._boundWsHandler as EventListener);
  }

  private _handleWsMessage(e: Event): void {
    const msg = (e as CustomEvent).detail as {
      type: string;
      payload: { instances?: Array<{ slug: string; gateway: string; systemd: string }> };
    };
    if (msg.type !== "health_update" || !this._instance) return;

    const updates = msg.payload.instances ?? [];
    const update = updates.find((u) => u.slug === this._instance!.slug);
    if (!update) return;

    const newGateway = update.gateway as InstanceInfo["gateway"];
    const newSystemd = update.systemd as InstanceInfo["systemd"];
    const newState: InstanceInfo["state"] =
      newGateway === "healthy"
        ? "running"
        : newSystemd === "inactive"
          ? "stopped"
          : newSystemd === "failed"
            ? "error"
            : "unknown";

    // Only trigger re-render if something actually changed
    if (
      this._instance.gateway !== newGateway ||
      this._instance.systemd !== newSystemd ||
      this._instance.state !== newState
    ) {
      this._instance = { ...this._instance, gateway: newGateway, systemd: newSystemd, state: newState };
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") && this.slug) {
      this._load();
    }
  }

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._convLoading = true;
    this._error = "";
    try {
      const [{ instance, gatewayToken }, agents] = await Promise.all([
        fetchInstance(this.slug),
        fetchAgents(this.slug),
      ]);
      this._instance = instance;
      this._gatewayToken = gatewayToken;
      this._agents = agents;
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
    // Load conversations separately (non-blocking for main content)
    try {
      this._conversations = await fetchConversations(this.slug, 10);
    } catch {
      this._conversations = [];
    } finally {
      this._convLoading = false;
    }
  }

  private _back(): void {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { slug: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _action(fn: (slug: string) => Promise<void>): Promise<void> {
    this._actionLoading = true;
    this._error = "";
    try {
      await fn(this.slug);
      await this._load();
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._actionLoading = false;
    }
  }

  private async _confirmDelete(): Promise<void> {
    if (this._deleteSlugInput !== this.slug || this._deleting) return;
    this._deleting = true;
    this._error = "";
    try {
      await deleteInstance(this.slug);
      this.dispatchEvent(
        new CustomEvent("instance-deleted", {
          detail: { slug: this.slug },
          bubbles: true,
          composed: true,
        }),
      );
      this._back();
    } catch (err) {
      this._error = userMessage(err);
      this._deleting = false;
    }
  }

  private _controlUrl(): string {
    if (!this._instance) return "#";
    const base = `http://localhost:${this._instance.port}`;
    return this._gatewayToken ? `${base}/#token=${this._gatewayToken}` : base;
  }

  private _formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private _renderActions(inst: InstanceInfo) {
    const state = inst.state ?? "unknown";
    const dis = this._actionLoading || this._deleting;

    const showStart = state === "stopped" || state === "error" || state === "unknown";
    const showStop = state === "running";
    const showRestart = state === "running" || state === "error" || state === "unknown";
    const showUI = state === "running";

    return html`
      <div class="actions">
        ${showStart
          ? html`<button
              class="btn btn-start"
              ?disabled=${dis}
              @click=${() => this._action(startInstance)}
            >${msg("Start", { id: "btn-start-detail" })}</button>`
          : ""}
        ${showStop
          ? html`<button
              class="btn btn-stop"
              ?disabled=${dis}
              @click=${() => this._action(stopInstance)}
            >${msg("Stop", { id: "btn-stop-detail" })}</button>`
          : ""}
        ${showRestart
          ? html`<button
              class="btn btn-restart"
              ?disabled=${dis}
              @click=${() => this._action(restartInstance)}
            >${msg("Restart", { id: "btn-restart-detail" })}</button>`
          : ""}
        ${showUI
          ? html`<a
              class="btn-ui"
              href=${this._controlUrl()}
              target="_blank"
              rel="noopener"
            >${msg("⎋ Open UI", { id: "btn-open-ui-detail" })}</a>`
          : ""}
        <button
          class="btn btn-delete"
          ?disabled=${dis}
          @click=${() => {
            this._showDeleteConfirm = true;
            this._deleteSlugInput = "";
            this._error = "";
          }}
        >${msg("Delete", { id: "btn-delete" })}</button>
      </div>
      ${this._error
        ? html`<div class="action-error">${this._error}</div>`
        : ""}
    `;
  }

  private _renderConversations() {
    return html`
      <div class="section">
        <div class="section-title">${msg("Recent Conversations", { id: "section-conversations" })}</div>
        ${this._convLoading
          ? html`<div class="empty-agents">${msg("Loading…", { id: "loading-ellipsis" })}</div>`
          : this._conversations.length === 0
            ? html`<div class="empty-agents">${msg("No conversations yet", { id: "no-conversations" })}</div>`
            : html`
                <ul class="conv-list">
                  ${this._conversations.map(
                    (entry) => html`
                      <li class="conv-entry">
                        <span class="conv-time">${this._formatTime(entry.timestamp)}</span>
                        <span class="conv-route">
                          <span
                            class="conv-status-dot ${entry.status ?? "done"}"
                          ></span>
                          <span class="conv-from" title=${entry.from}>${entry.from}</span>
                          <span class="conv-arrow">→</span>
                          <span class="conv-to" title=${entry.to}>${entry.to}</span>
                        </span>
                        <span class="conv-msg" title=${entry.message}>${entry.message}</span>
                      </li>
                    `,
                  )}
                </ul>
              `}
      </div>
    `;
  }

  override render() {
    if (this._loading) {
      return html`
        <button class="back-btn" @click=${this._back}>${msg("← Back", { id: "btn-back" })}</button>
        <div class="loading">${msg("Loading instance...", { id: "loading-instance" })}</div>
      `;
    }

    if (this._error || !this._instance) {
      return html`
        <button class="back-btn" @click=${this._back}>${msg("← Back", { id: "btn-back" })}</button>
        <div class="error-banner">${this._error || msg("Instance not found", { id: "instance-not-found" })}</div>
      `;
    }

    const inst = this._instance;
    const stateClass = inst.state ?? "unknown";

    return html`
      <button class="back-btn" @click=${this._back}>${msg("← Back", { id: "btn-back" })}</button>

      <div class="detail-header">
        <div>
          <div class="detail-title">${inst.slug}</div>
          ${inst.display_name
            ? html`<div class="detail-subtitle">${inst.display_name}</div>`
            : ""}
        </div>
        <span class="state-badge ${stateClass}">
          <span class="state-dot"></span>
          ${stateClass}
        </span>
      </div>

      ${this._renderActions(inst)}

      ${this._showDeleteConfirm
        ? html`
            <div class="delete-confirm">
              <div class="delete-confirm-title">${msg("Permanently destroy", { id: "delete-confirm-title" })} "${inst.slug}"?</div>
              <div class="delete-confirm-hint">
                ${msg("This will stop the service, remove all files and the registry entry. Type the instance slug to confirm.", { id: "delete-confirm-hint" })}
              </div>
              <div class="delete-confirm-row">
                <input
                  type="text"
                  placeholder=${inst.slug}
                  .value=${this._deleteSlugInput}
                  @input=${(e: Event) => {
                    this._deleteSlugInput = (e.target as HTMLInputElement).value;
                  }}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter") this._confirmDelete();
                    if (e.key === "Escape") this._showDeleteConfirm = false;
                  }}
                />
                <button
                  class="btn-confirm-delete"
                  ?disabled=${this._deleteSlugInput !== inst.slug || this._deleting}
                  @click=${this._confirmDelete}
                >
                  ${this._deleting
                    ? msg("Deleting…", { id: "btn-deleting" })
                    : msg("Destroy", { id: "btn-destroy" })}
                </button>
                <button
                  class="btn-cancel-delete"
                  ?disabled=${this._deleting}
                  @click=${() => { this._showDeleteConfirm = false; }}
                >
                  ${msg("Cancel", { id: "btn-cancel" })}
                </button>
              </div>
              ${this._error
                ? html`<div class="action-error">${this._error}</div>`
                : ""}
            </div>
          `
        : ""}

      <div class="section">
        <div class="section-title">${msg("Instance Info", { id: "section-instance-info" })}</div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">${msg("Port", { id: "label-port" })}</span>
            <span class="info-value">:${inst.port}</span>
          </div>
          <div class="info-item">
            <span class="info-label">${msg("Systemd Unit", { id: "label-systemd-unit" })}</span>
            <span class="info-value">${inst.systemd_unit}</span>
          </div>
          ${inst.telegram_bot
            ? html`
                <div class="info-item">
                  <span class="info-label">${msg("Telegram Bot", { id: "label-telegram-bot" })}</span>
                  <span class="info-value">${inst.telegram_bot}</span>
                </div>
              `
            : ""}
          ${inst.default_model
            ? html`
                <div class="info-item">
                  <span class="info-label">${msg("Default Model", { id: "label-default-model" })}</span>
                  <span class="info-value">${inst.default_model}</span>
                </div>
              `
            : ""}
          <div class="info-item">
            <span class="info-label">${msg("Config Path", { id: "label-config-path" })}</span>
            <span class="info-value">${inst.config_path}</span>
          </div>
          <div class="info-item">
            <span class="info-label">${msg("State Dir", { id: "label-state-dir" })}</span>
            <span class="info-value">${inst.state_dir}</span>
          </div>
          <div class="info-item">
            <span class="info-label">${msg("Created", { id: "label-created" })}</span>
            <span class="info-value">${inst.created_at}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${msg("Agents", { id: "section-agents" })} (${this._agents.length})</div>
        ${this._agents.length === 0
          ? html`<div class="empty-agents">${msg("No agents registered", { id: "no-agents" })}</div>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>${msg("ID", { id: "table-id" })}</th>
                    <th>${msg("Name", { id: "table-name" })}</th>
                    <th>${msg("Model", { id: "table-model" })}</th>
                    <th>${msg("Workspace", { id: "table-workspace" })}</th>
                  </tr>
                </thead>
                <tbody>
                  ${this._agents.map(
                    (agent) => html`
                      <tr>
                        <td>
                          ${agent.agent_id}
                          ${agent.is_default
                            ? html`<span class="default-badge">${msg("default", { id: "agent-default-badge" })}</span>`
                            : ""}
                        </td>
                        <td>${agent.name}</td>
                        <td>${agent.model ?? "—"}</td>
                        <td>${agent.workspace_path}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `}
      </div>

      ${this._renderConversations()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-detail": InstanceDetail;
  }
}
