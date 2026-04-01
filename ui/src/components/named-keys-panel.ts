// ui/src/components/named-keys-panel.ts
//
// Admin panel for managing named API keys.
// Accessible via the settings/admin area of the dashboard.

import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles, errorBannerStyles } from "../styles/shared.js";
import { namedKeysPanelStyles } from "../styles/named-keys-panel.styles.js";
import {
  fetchNamedKeys,
  createNamedKey,
  updateNamedKey,
  deleteNamedKey,
  fetchProviders,
} from "../api.js";
import type { NamedApiKey, ProviderInfo } from "../types.js";

@customElement("cp-named-keys-panel")
export class NamedKeysPanel extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    errorBannerStyles,
    namedKeysPanelStyles,
  ];

  // --- State ---

  @state() private _keys: NamedApiKey[] = [];
  @state() private _providers: ProviderInfo[] = [];
  @state() private _cryptoAvailable = true;
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _toast: { message: string; type: "success" | "error" } | null = null;

  // Create form state
  @state() private _showCreateForm = false;
  @state() private _createName = "";
  @state() private _createProvider = "";
  @state() private _createApiKey = "";
  @state() private _createModel = "";
  @state() private _createBaseUrl = "";
  @state() private _creating = false;

  // Edit state
  @state() private _editingId: number | null = null;
  @state() private _editName = "";
  @state() private _editModel = "";
  @state() private _editBaseUrl = "";
  @state() private _editApiKey = "";
  @state() private _saving = false;

  // Delete confirmation
  @state() private _confirmDeleteId: number | null = null;
  @state() private _deleting = false;

  // --- Lifecycle ---

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadKeys();
  }

  private async _loadKeys(): Promise<void> {
    this._loading = true;
    this._error = "";
    try {
      const [keysRes, providersRes] = await Promise.all([fetchNamedKeys(), fetchProviders()]);
      this._keys = keysRes.keys;
      this._cryptoAvailable = keysRes.cryptoAvailable;
      this._providers = providersRes.providers;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  // --- Toast ---

  private _showToast(message: string, type: "success" | "error" = "success"): void {
    this._toast = { message, type };
    setTimeout(() => {
      this._toast = null;
    }, 4000);
  }

  // --- Create ---

  private _resetCreateForm(): void {
    this._createName = "";
    this._createProvider = "";
    this._createApiKey = "";
    this._createModel = "";
    this._createBaseUrl = "";
    this._showCreateForm = false;
  }

  private async _handleCreate(): Promise<void> {
    if (!this._createName || !this._createProvider || !this._createApiKey || !this._createModel) {
      return;
    }
    this._creating = true;
    try {
      await createNamedKey({
        name: this._createName,
        providerId: this._createProvider,
        apiKey: this._createApiKey,
        defaultModel: this._createModel,
        ...(this._createBaseUrl ? { baseUrl: this._createBaseUrl } : {}),
      });
      this._resetCreateForm();
      await this._loadKeys();
      this._showToast("Key created");
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._creating = false;
    }
  }

  // --- Edit ---

  private _startEdit(key: NamedApiKey): void {
    this._editingId = key.id;
    this._editName = key.name;
    this._editModel = key.defaultModel;
    this._editBaseUrl = key.baseUrl ?? "";
    this._editApiKey = "";
  }

  private _cancelEdit(): void {
    this._editingId = null;
    this._editApiKey = "";
  }

  private async _handleUpdate(): Promise<void> {
    if (this._editingId === null) return;
    this._saving = true;
    try {
      const data: {
        name?: string;
        defaultModel?: string;
        baseUrl?: string | null;
        apiKey?: string;
      } = {
        name: this._editName,
        defaultModel: this._editModel,
        baseUrl: this._editBaseUrl || null,
      };
      if (this._editApiKey) {
        data.apiKey = this._editApiKey;
      }
      await updateNamedKey(this._editingId, data);
      this._editingId = null;
      this._editApiKey = "";
      await this._loadKeys();
      this._showToast("Key updated");
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._saving = false;
    }
  }

  // --- Delete ---

  private async _handleDelete(): Promise<void> {
    if (this._confirmDeleteId === null) return;
    this._deleting = true;
    try {
      await deleteNamedKey(this._confirmDeleteId);
      this._confirmDeleteId = null;
      await this._loadKeys();
      this._showToast("Key deleted");
    } catch (err) {
      this._showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this._deleting = false;
    }
  }

  // --- Render ---

  override render() {
    if (this._loading) {
      return html`<div class="loading-container">
        <div class="spinner"></div>
        Loading named keys...
      </div>`;
    }

    if (this._error) {
      return html`<div class="error-banner">${this._error}</div>`;
    }

    return html`
      <div
        class="section-header"
        style="display: flex; align-items: center; justify-content: space-between;"
      >
        <span>API Keys</span>
        <button
          class="btn btn-primary"
          style="font-size: 12px; padding: 4px 10px;"
          @click=${() => {
            this._showCreateForm = !this._showCreateForm;
          }}
        >
          ${this._showCreateForm ? "Cancel" : "+ New Key"}
        </button>
      </div>

      <div class="content">
        ${!this._cryptoAvailable
          ? html`<div class="crypto-warning">
              Encryption is not available. Restart the dashboard to auto-generate the
              MASTER_ENCRYPTION_KEY, or set it manually in ~/.claw-pilot/.env.
            </div>`
          : nothing}
        ${this._showCreateForm ? this._renderCreateForm() : nothing}

        <div class="section">
          <div class="section-header">Keys (${this._keys.length})</div>
          ${this._keys.length === 0
            ? html`<div class="empty-state">No named API keys configured yet.</div>`
            : this._renderKeysTable()}
        </div>
      </div>

      ${this._confirmDeleteId !== null ? this._renderDeleteConfirm() : nothing}
      ${this._toast
        ? html`<div class="toast ${this._toast.type}">${this._toast.message}</div>`
        : nothing}
    `;
  }

  private _renderKeysTable() {
    return html`
      <table class="keys-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Default Model</th>
            <th>API Key</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._keys.map((key) =>
            this._editingId === key.id ? this._renderEditRow(key) : this._renderKeyRow(key),
          )}
        </tbody>
      </table>
    `;
  }

  private _renderKeyRow(key: NamedApiKey) {
    const created = new Date(key.createdAt).toLocaleDateString();
    return html`
      <tr>
        <td><strong>${key.name}</strong></td>
        <td>${key.providerId}</td>
        <td class="mono">${key.defaultModel}</td>
        <td class="mono">${key.apiKeyMasked}</td>
        <td>${created}</td>
        <td class="actions">
          <button class="btn-action btn-edit" @click=${() => this._startEdit(key)}>Edit</button>
          <button
            class="btn-action btn-delete"
            @click=${() => {
              this._confirmDeleteId = key.id;
            }}
          >
            Delete
          </button>
        </td>
      </tr>
    `;
  }

  private _renderEditRow(key: NamedApiKey) {
    return html`
      <tr>
        <td colspan="6">
          <div class="key-form">
            <div class="field-grid">
              <div class="field">
                <label class="field-label">Name</label>
                <input
                  class="field-input"
                  type="text"
                  .value=${this._editName}
                  @input=${(e: Event) => {
                    this._editName = (e.target as HTMLInputElement).value;
                  }}
                />
              </div>
              <div class="field">
                <label class="field-label">Provider</label>
                <input class="field-input" type="text" .value=${key.providerId} disabled />
              </div>
              <div class="field">
                <label class="field-label">Default Model</label>
                <select
                  class="field-input mono"
                  .value=${this._editModel}
                  @change=${(e: Event) => {
                    this._editModel = (e.target as HTMLSelectElement).value;
                  }}
                >
                  ${(this._providers.find((p) => p.id === key.providerId)?.models ?? []).map(
                    (m) =>
                      html`<option value=${m} ?selected=${m === this._editModel}>
                        ${m.split("/")[1] ?? m}
                      </option>`,
                  )}
                </select>
              </div>
              <div class="field">
                <label class="field-label">Base URL</label>
                <input
                  class="field-input mono"
                  type="text"
                  placeholder="https://..."
                  .value=${this._editBaseUrl}
                  @input=${(e: Event) => {
                    this._editBaseUrl = (e.target as HTMLInputElement).value;
                  }}
                />
              </div>
              <div class="field full-width">
                <label class="field-label">New API Key (leave blank to keep current)</label>
                <input
                  class="field-input mono"
                  type="password"
                  placeholder="sk-..."
                  .value=${this._editApiKey}
                  @input=${(e: Event) => {
                    this._editApiKey = (e.target as HTMLInputElement).value;
                  }}
                />
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-ghost" @click=${this._cancelEdit}>Cancel</button>
              <button
                class="btn btn-primary"
                ?disabled=${this._saving || !this._editName || !this._editModel}
                @click=${this._handleUpdate}
              >
                ${this._saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  private _renderCreateForm() {
    return html`
      <div class="key-form" style="margin-bottom: 20px">
        <div class="field-grid">
          <div class="field">
            <label class="field-label">Name</label>
            <input
              class="field-input"
              type="text"
              placeholder="e.g. Production Anthropic"
              .value=${this._createName}
              @input=${(e: Event) => {
                this._createName = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="field-label">Provider</label>
            <select
              class="field-input"
              .value=${this._createProvider}
              @change=${(e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                this._createProvider = id;
                const p = this._providers.find((pr) => pr.id === id);
                this._createModel = p?.defaultModel ?? "";
              }}
            >
              <option value="">-- Select --</option>
              ${this._providers.map((p) => html`<option value=${p.id}>${p.label}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="field-label">API Key</label>
            <input
              class="field-input mono"
              type="password"
              placeholder="sk-..."
              .value=${this._createApiKey}
              @input=${(e: Event) => {
                this._createApiKey = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="field">
            <label class="field-label">Default Model</label>
            <select
              class="field-input mono"
              .value=${this._createModel}
              @change=${(e: Event) => {
                this._createModel = (e.target as HTMLSelectElement).value;
              }}
            >
              <option value="">-- Select --</option>
              ${(this._providers.find((p) => p.id === this._createProvider)?.models ?? []).map(
                (m) =>
                  html`<option value=${m} ?selected=${m === this._createModel}>
                    ${m.split("/")[1] ?? m}
                  </option>`,
              )}
            </select>
          </div>
          <div class="field full-width">
            <label class="field-label">Base URL (optional)</label>
            <input
              class="field-input mono"
              type="text"
              placeholder="https://..."
              .value=${this._createBaseUrl}
              @input=${(e: Event) => {
                this._createBaseUrl = (e.target as HTMLInputElement).value;
              }}
            />
            <span class="field-hint">Only needed for custom endpoints (e.g. Ollama, proxies)</span>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" @click=${() => this._resetCreateForm()}>Cancel</button>
          <button
            class="btn btn-primary"
            ?disabled=${this._creating ||
            !this._createName ||
            !this._createProvider ||
            !this._createApiKey ||
            !this._createModel}
            @click=${this._handleCreate}
          >
            ${this._creating ? "Creating..." : "Create Key"}
          </button>
        </div>
      </div>
    `;
  }

  private _renderDeleteConfirm() {
    const key = this._keys.find((k) => k.id === this._confirmDeleteId);
    return html`
      <div
        class="confirm-overlay"
        @click=${() => {
          this._confirmDeleteId = null;
        }}
      >
        <div class="confirm-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="confirm-title">Delete named key</div>
          <div class="confirm-message">
            Are you sure you want to delete <strong>${key?.name ?? "this key"}</strong>? This action
            cannot be undone. If the key is assigned to any instance, deletion will fail.
          </div>
          <div class="confirm-actions">
            <button
              class="btn btn-ghost"
              @click=${() => {
                this._confirmDeleteId = null;
              }}
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              style="background: var(--state-error)"
              ?disabled=${this._deleting}
              @click=${this._handleDelete}
            >
              ${this._deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-named-keys-panel": NamedKeysPanel;
  }
}
