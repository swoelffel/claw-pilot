// ui/src/components/import-team-dialog.ts
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PanelContext } from "../types.js";
import { importInstanceTeam, importBlueprintTeam } from "../api.js";
import type { TeamImportResult } from "../api.js";
import { userMessage } from "../lib/error-messages.js";
import { tokenStyles } from "../styles/tokens.js";
import { spinnerStyles, errorBannerStyles, buttonStyles } from "../styles/shared.js";

@localized()
@customElement("cp-import-team-dialog")
export class ImportTeamDialog extends LitElement {
  static styles = [tokenStyles, spinnerStyles, errorBannerStyles, buttonStyles, css`
    :host { display: block; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .dialog {
      background: var(--bg-surface);
      border: 1px solid var(--bg-border);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 500px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--bg-border);
    }

    .dialog-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .btn-close {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }

    .dialog-body {
      padding: 20px 24px;
    }

    .drop-zone {
      border: 2px dashed var(--bg-border);
      border-radius: var(--radius-md);
      padding: 32px 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }

    .drop-zone:hover,
    .drop-zone.dragover {
      border-color: var(--accent);
      background: rgba(79, 110, 247, 0.05);
    }

    .drop-zone input {
      display: none;
    }

    .summary {
      margin-top: 16px;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .summary-row .label {
      color: var(--text-muted);
    }

    .warning {
      margin-top: 16px;
      padding: 10px 14px;
      background: rgba(234, 179, 8, 0.08);
      border: 1px solid rgba(234, 179, 8, 0.2);
      border-radius: var(--radius-md);
      font-size: 12px;
      color: #eab308;
      line-height: 1.5;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 16px 24px 20px;
      border-top: 1px solid var(--bg-border);
    }

    .btn-cancel {
      background: none;
      border: 1px solid var(--bg-border);
      color: var(--text-secondary);
      border-radius: var(--radius-md);
      padding: 7px 18px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }

    .btn-import {
      background: var(--accent);
      border: none;
      color: white;
      border-radius: var(--radius-md);
      padding: 7px 18px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-import:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-msg {
      margin-top: 12px;
      padding: 8px 12px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: var(--radius-md);
      font-size: 12px;
      color: #ef4444;
    }
  `];

  @property({ type: Object }) context!: PanelContext;

  @state() private _file: File | null = null;
  @state() private _yamlContent = "";
  @state() private _dryRunResult: TeamImportResult | null = null;
  @state() private _loading = false;
  @state() private _importing = false;
  @state() private _error = "";
  @state() private _dragover = false;

  private _close(): void {
    this.dispatchEvent(new CustomEvent("close-dialog"));
  }

  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    this._dragover = true;
  }

  private _onDragLeave(): void {
    this._dragover = false;
  }

  private async _onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    this._dragover = false;
    const file = e.dataTransfer?.files[0];
    if (file) await this._processFile(file);
  }

  private async _onFileSelect(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this._processFile(file);
  }

  private async _processFile(file: File): Promise<void> {
    this._file = file;
    this._error = "";
    this._dryRunResult = null;

    try {
      this._yamlContent = await file.text();
    } catch {
      this._error = "Could not read file";
      return;
    }

    // Auto dry-run
    this._loading = true;
    try {
      if (this.context.kind === "instance") {
        this._dryRunResult = await importInstanceTeam(this.context.slug, this._yamlContent, true);
      } else {
        this._dryRunResult = await importBlueprintTeam(this.context.blueprintId, this._yamlContent, true);
      }
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._loading = false;
    }
  }

  private async _doImport(): Promise<void> {
    this._importing = true;
    this._error = "";
    try {
      if (this.context.kind === "instance") {
        await importInstanceTeam(this.context.slug, this._yamlContent);
      } else {
        await importBlueprintTeam(this.context.blueprintId, this._yamlContent);
      }
      this.dispatchEvent(new CustomEvent("team-imported"));
    } catch (err) {
      this._error = userMessage(err);
    } finally {
      this._importing = false;
    }
  }

  override render() {
    const summary = this._dryRunResult?.summary;

    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">${msg("Import Agent Team", { id: "tid-title" })}</span>
            <button class="btn-close" @click=${this._close}>&times;</button>
          </div>

          <div class="dialog-body">
            <div
              class="drop-zone ${this._dragover ? "dragover" : ""}"
              @dragover=${this._onDragOver}
              @dragleave=${this._onDragLeave}
              @drop=${(e: DragEvent) => void this._onDrop(e)}
              @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>("#file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".yaml,.yml"
                @change=${(e: Event) => void this._onFileSelect(e)}
              />
              ${this._file
                ? html`<strong>${this._file.name}</strong>`
                : msg("Drop .team.yaml file here or click to browse", { id: "tid-drop-hint" })}
            </div>

            ${this._loading ? html`
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;">
                <div class="spinner" style="width: 14px; height: 14px;"></div>
                <span style="font-size: 12px; color: var(--text-muted);">Validating...</span>
              </div>
            ` : ""}

            ${summary ? html`
              <div class="summary">
                <div class="summary-row">
                  <span class="label">${msg("File", { id: "tid-file" })}</span>
                  <span>${this._file?.name ?? ""}</span>
                </div>
                <div class="summary-row">
                  <span class="label">${msg("Agents", { id: "tid-agents" })}</span>
                  <span>${summary.agents_to_import} (current: ${summary.current_agent_count})</span>
                </div>
                <div class="summary-row">
                  <span class="label">${msg("Links", { id: "tid-links" })}</span>
                  <span>${summary.links_to_import}</span>
                </div>
                <div class="summary-row">
                  <span class="label">${msg("Files", { id: "tid-files" })}</span>
                  <span>${summary.files_to_write}</span>
                </div>
              </div>

              <div class="warning">
                ${msg("This will replace all existing agents, files, and links. This action cannot be undone.", { id: "tid-warning" })}
              </div>
            ` : ""}

            ${this._error ? html`
              <div class="error-msg">${this._error}</div>
            ` : ""}
          </div>

          <div class="dialog-actions">
            <button class="btn-cancel" @click=${this._close}>
              ${msg("Cancel", { id: "tid-btn-cancel" })}
            </button>
            <button
              class="btn-import"
              ?disabled=${!this._dryRunResult || this._importing || !!this._error}
              @click=${() => void this._doImport()}
            >
              ${this._importing ? html`<div class="spinner" style="width: 12px; height: 12px;"></div>` : ""}
              ${this._importing
                ? msg("Importing...", { id: "tid-btn-importing" })
                : msg("Import", { id: "tid-btn-import" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-import-team-dialog": ImportTeamDialog;
  }
}
