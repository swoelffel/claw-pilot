// ui/src/components/pilot/parts/part-image.ts
// Part type "image" — renders base64-encoded image with thumbnail and click-to-zoom.
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tokenStyles } from "../../../styles/tokens.js";

@customElement("cp-pilot-part-image")
export class PilotPartImage extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .image-container {
        margin: 4px 0;
        max-width: 400px;
      }
      .image-container img {
        max-width: 100%;
        max-height: 300px;
        border-radius: 8px;
        cursor: pointer;
        transition: opacity 0.15s;
        object-fit: contain;
        background: var(--bg-tertiary);
      }
      .image-container img:hover {
        opacity: 0.9;
      }
      .image-meta {
        font-size: 11px;
        color: var(--text-tertiary);
        margin-top: 2px;
      }
      /* Fullscreen overlay */
      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        cursor: pointer;
      }
      .overlay img {
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
        border-radius: 4px;
      }
    `,
  ];

  /** Base64-encoded image data */
  @property() data = "";
  /** MIME type (e.g. "image/jpeg") */
  @property() mimeType = "image/jpeg";
  /** Optional filename */
  @property() filename = "";

  @state() private _zoomed = false;

  private get _src(): string {
    if (!this.data) return "";
    return `data:${this.mimeType};base64,${this.data}`;
  }

  override render() {
    if (!this.data) return html``;

    return html`
      <div class="image-container">
        <img
          src=${this._src}
          alt=${this.filename || "Image attachment"}
          @click=${() => {
            this._zoomed = true;
          }}
        />
        ${this.filename ? html`<div class="image-meta">${this.filename}</div>` : ""}
      </div>
      ${this._zoomed
        ? html`
            <div
              class="overlay"
              @click=${() => {
                this._zoomed = false;
              }}
            >
              <img src=${this._src} alt=${this.filename || "Image attachment"} />
            </div>
          `
        : ""}
    `;
  }
}
