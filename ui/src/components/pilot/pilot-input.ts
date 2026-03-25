// ui/src/components/pilot/pilot-input.ts
// Message input: auto-resizing textarea + Send button + file attach button.
// Enter sends, Shift+Enter inserts newline. Drag & drop for images.
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles } from "../../styles/shared.js";

export interface AttachedFile {
  name: string;
  mimeType: string;
  /** Base64-encoded file content */
  data: string;
  /** Data URL for thumbnail preview */
  preview: string;
}

@localized()
@customElement("cp-pilot-input")
export class PilotInput extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
      }

      .input-wrapper {
        border-top: 1px solid var(--bg-border);
        background: var(--bg-surface);
      }

      /* Preview strip above the input row */
      .preview-strip {
        display: flex;
        gap: 6px;
        padding: 8px 12px 0;
        flex-wrap: wrap;
      }
      .preview-item {
        position: relative;
        width: 56px;
        height: 56px;
        border-radius: var(--radius-md);
        overflow: hidden;
        border: 1px solid var(--bg-border);
        background: var(--bg-tertiary);
      }
      .preview-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .preview-remove {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        color: var(--text-secondary);
        font-size: 11px;
        line-height: 16px;
        text-align: center;
        cursor: pointer;
        padding: 0;
      }
      .preview-remove:hover {
        background: var(--danger);
        color: white;
        border-color: var(--danger);
      }

      .input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 10px 12px;
      }

      .btn-attach {
        flex-shrink: 0;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 8px;
        border-radius: var(--radius-md);
        font-size: 18px;
        line-height: 1;
        transition:
          color 0.15s,
          background 0.15s;
      }
      .btn-attach:hover {
        color: var(--accent);
        background: var(--bg-hover);
      }
      .btn-attach:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      textarea {
        flex: 1;
        resize: none;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        padding: 8px 12px;
        outline: none;
        line-height: 1.5;
        min-height: 38px;
        max-height: 140px;
        overflow-y: auto;
        transition: border-color 0.15s;
      }

      textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      textarea::placeholder {
        color: var(--text-muted);
      }

      textarea.drag-over {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 8%, var(--bg-hover));
      }

      .btn {
        align-self: flex-end;
        padding: 7px 14px;
        flex-shrink: 0;
      }

      /* Hidden file input */
      input[type="file"] {
        display: none;
      }
    `,
  ];

  @property({ type: Boolean }) disabled = false;
  @property() placeholder = "";

  @state() private _text = "";
  @state() private _files: AttachedFile[] = [];
  @state() private _dragOver = false;

  private _handleInput(e: Event): void {
    const ta = e.target as HTMLTextAreaElement;
    this._text = ta.value;
    // Auto-resize
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  private _send(): void {
    const text = this._text.trim();
    const hasContent = text || this._files.length > 0;
    if (!hasContent || this.disabled) return;

    const files =
      this._files.length > 0
        ? this._files.map((f) => ({ name: f.name, mimeType: f.mimeType, data: f.data }))
        : undefined;

    this._text = "";
    this._files = [];
    // Reset textarea height
    const ta = this.shadowRoot?.querySelector("textarea");
    if (ta) ta.style.height = "auto";
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { text, ...(files !== undefined ? { files } : {}) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- File handling ---

  private _openFilePicker(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input[type="file"]');
    input?.click();
  }

  private _handleFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      void this._processFiles(Array.from(input.files));
    }
    // Reset input so the same file can be re-selected
    input.value = "";
  }

  private async _processFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 20 * 1024 * 1024) continue; // 20 MB limit

      const base64 = await fileToBase64(file);
      const preview = URL.createObjectURL(file);
      this._files = [
        ...this._files,
        { name: file.name, mimeType: file.type, data: base64, preview },
      ];
    }
  }

  private _removeFile(index: number): void {
    const file = this._files[index];
    if (file) URL.revokeObjectURL(file.preview);
    this._files = this._files.filter((_, i) => i !== index);
  }

  // --- Drag & drop ---

  private _handleDragOver(e: DragEvent): void {
    e.preventDefault();
    this._dragOver = true;
  }

  private _handleDragLeave(): void {
    this._dragOver = false;
  }

  private _handleDrop(e: DragEvent): void {
    e.preventDefault();
    this._dragOver = false;
    if (e.dataTransfer?.files) {
      void this._processFiles(Array.from(e.dataTransfer.files));
    }
  }

  override render() {
    const placeholder =
      this.placeholder ||
      msg("Message… (Enter to send, Shift+Enter for newline)", {
        id: "pilot-input-placeholder",
      });

    const canSend = (this._text.trim() || this._files.length > 0) && !this.disabled;

    return html`
      <div class="input-wrapper">
        ${this._files.length > 0
          ? html`
              <div class="preview-strip">
                ${this._files.map(
                  (f, i) => html`
                    <div class="preview-item">
                      <img src=${f.preview} alt=${f.name} />
                      <button
                        class="preview-remove"
                        @click=${() => this._removeFile(i)}
                        title=${msg("Remove", { id: "pilot-remove-file" })}
                      >
                        &times;
                      </button>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}

        <div class="input-row">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            @change=${this._handleFileSelect}
          />
          <button
            class="btn-attach"
            ?disabled=${this.disabled}
            @click=${this._openFilePicker}
            title=${msg("Attach image", { id: "pilot-btn-attach" })}
          >
            &#x1F4CE;
          </button>

          <textarea
            class=${this._dragOver ? "drag-over" : ""}
            .value=${this._text}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
            @dragover=${this._handleDragOver}
            @dragleave=${this._handleDragLeave}
            @drop=${this._handleDrop}
            placeholder=${placeholder}
            ?disabled=${this.disabled}
            rows="1"
          ></textarea>
          <button class="btn btn-primary" ?disabled=${!canSend} @click=${this._send}>
            ${msg("Send", { id: "pilot-btn-send" })}
          </button>
        </div>
      </div>
    `;
  }
}

// --- Helpers ---

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data:mime;base64, prefix
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-input": PilotInput;
  }
}
