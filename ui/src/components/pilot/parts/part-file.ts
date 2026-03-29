// ui/src/components/pilot/parts/part-file.ts
// Part renderer for send_file tool calls — file download card with title, size, and download button.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";
import { getToken } from "../../../services/auth-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_ICONS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/zip": "ZIP",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/svg+xml": "SVG",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "text/csv": "CSV",
};

interface FileMetadata {
  path: string;
  filename: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@localized()
@customElement("cp-pilot-part-file")
export class PilotPartFile extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .file-card {
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-surface);
      }
      .file-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--accent-subtle);
      }
      .type-icon {
        font-size: 11px;
        font-weight: 700;
        font-family: var(--font-mono);
        color: var(--accent);
        background: rgba(79, 110, 247, 0.12);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }
      .file-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-size {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        flex-shrink: 0;
      }
      .download-btn {
        flex-shrink: 0;
        padding: 4px 10px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--accent);
        font-size: 11px;
        font-family: var(--font-ui);
        cursor: pointer;
        text-decoration: none;
        transition:
          color 0.12s,
          background 0.12s;
      }
      .download-btn:hover {
        background: var(--accent);
        color: var(--bg-base);
      }
    `,
  ];

  /** The tool_call part */
  @property({ type: Object }) call!: PilotPart;
  /** The tool_result part (if available) */
  @property({ type: Object }) result: PilotPart | undefined;
  /** Instance slug (for download URL) */
  @property() slug = "";

  private get _meta(): FileMetadata | undefined {
    try {
      const content = this.result?.content;
      if (!content) return undefined;
      return JSON.parse(content) as FileMetadata;
    } catch {
      return undefined;
    }
  }

  private _downloadUrl(filePath: string): string {
    const token = getToken();
    const params = new URLSearchParams({ path: filePath });
    if (token) params.set("token", token);
    return `/api/instances/${this.slug}/workspace/download?${params.toString()}`;
  }

  override render() {
    const meta = this._meta;
    if (!meta) return nothing;

    const icon = TYPE_ICONS[meta.mimeType] ?? "FILE";
    const size = humanSize(meta.sizeBytes);

    return html`
      <div class="file-card">
        <div class="file-header">
          <span class="type-icon">${icon}</span>
          <span class="file-title">${meta.title}</span>
          <span class="file-size">${size}</span>
          <a
            class="download-btn"
            href=${this._downloadUrl(meta.path)}
            download=${meta.filename}
            target="_blank"
            rel="noopener"
          >
            ${msg("Download", { id: "file-download" })}
          </a>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-file": PilotPartFile;
  }
}
