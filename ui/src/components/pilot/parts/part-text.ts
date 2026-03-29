// ui/src/components/pilot/parts/part-text.ts
// Part type "text" — renders markdown content via marked + DOMPurify.
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { tokenStyles } from "../../../styles/tokens.js";

@customElement("cp-pilot-part-text")
export class PilotPartText extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .md-render {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary);
        word-break: break-word;
      }

      .md-render h1,
      .md-render h2,
      .md-render h3 {
        color: var(--text-primary);
        margin-top: 14px;
        margin-bottom: 6px;
        font-size: 14px;
        font-weight: 700;
      }

      .md-render h1 {
        font-size: 16px;
      }

      .md-render h2 {
        font-size: 15px;
      }

      .md-render p {
        margin: 6px 0;
      }

      .md-render p:first-child {
        margin-top: 0;
      }

      .md-render p:last-child {
        margin-bottom: 0;
      }

      .md-render ul,
      .md-render ol {
        padding-left: 18px;
        margin: 6px 0;
      }

      .md-render li {
        margin: 2px 0;
      }

      .md-render code {
        background: var(--bg-border);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--font-mono);
        font-size: 11px;
      }

      .md-render pre {
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        overflow-x: auto;
        margin: 8px 0;
      }

      .md-render pre code {
        background: none;
        padding: 0;
      }

      .md-render blockquote {
        border-left: 3px solid var(--accent-border);
        margin: 8px 0;
        padding: 4px 12px;
        color: var(--text-muted);
      }

      .md-render hr {
        border: none;
        border-top: 1px solid var(--bg-border);
        margin: 12px 0;
      }

      .md-render strong {
        font-weight: 700;
        color: var(--text-primary);
      }

      .md-render a {
        color: var(--accent);
        text-decoration: none;
      }

      .md-render a:hover {
        text-decoration: underline;
      }

      .md-render table {
        border-collapse: collapse;
        margin: 8px 0;
        font-size: 12px;
        width: 100%;
      }

      .md-render th,
      .md-render td {
        border: 1px solid var(--bg-border);
        padding: 4px 8px;
        text-align: left;
      }

      .md-render th {
        background: var(--bg-hover);
        font-weight: 600;
      }
    `,
  ];

  @property() content = "";

  override render() {
    const rawHtml = marked.parse(this.content) as string;
    const clean = DOMPurify.sanitize(rawHtml);
    return html`<div class="md-render" .innerHTML=${clean}></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-text": PilotPartText;
  }
}
