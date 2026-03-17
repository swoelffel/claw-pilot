// ui/src/components/pilot/parts/part-text.ts
// Part type "text" — renders plain text with pre-wrap.
// Markdown rendering is a Phase 4 enhancement.
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tokenStyles } from "../../../styles/tokens.js";

@customElement("cp-pilot-part-text")
export class PilotPartText extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .text-content {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
      }
    `,
  ];

  @property() content = "";

  override render() {
    return html`<div class="text-content">${this.content}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-text": PilotPartText;
  }
}
