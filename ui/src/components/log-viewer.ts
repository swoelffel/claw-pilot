import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("cp-log-viewer")
export class LogViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .log-title {
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .btn-clear {
      background: transparent;
      border: 1px solid #2a2d3a;
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }

    .btn-clear:hover {
      border-color: #6c63ff;
      color: #e2e8f0;
    }

    .log-container {
      background: #0a0c12;
      border: 1px solid #2a2d3a;
      border-radius: 6px;
      padding: 12px;
      height: 280px;
      overflow-y: auto;
      font-family: "Fira Mono", "Cascadia Code", "Consolas", monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #10b981;
    }

    .log-empty {
      color: #4a5568;
      font-style: italic;
    }

    .log-line {
      white-space: pre-wrap;
      word-break: break-all;
    }
  `;

  @property({ type: String }) slug = "";

  @state() private lines: string[] = [];

  private _onWsMessage = (e: Event) => {
    const detail = (e as CustomEvent<{ type: string; payload: unknown }>).detail;
    if (detail.type === "log_line") {
      const payload = detail.payload as { slug?: string; line?: string };
      if (payload.slug === this.slug && typeof payload.line === "string") {
        this.lines = [...this.lines.slice(-199), payload.line];
        this._scrollToBottom();
      }
    }
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("cp-ws-message", this._onWsMessage);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("cp-ws-message", this._onWsMessage);
  }

  private _scrollToBottom(): void {
    this.updateComplete.then(() => {
      const container = this.shadowRoot?.querySelector(".log-container");
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  private _clear(): void {
    this.lines = [];
  }

  override render() {
    return html`
      <div class="log-header">
        <span class="log-title">Logs</span>
        <button class="btn-clear" @click=${this._clear}>Clear</button>
      </div>
      <div class="log-container">
        ${this.lines.length === 0
          ? html`<span class="log-empty">Waiting for logs...</span>`
          : this.lines.map(
              (line) => html`<div class="log-line">${line}</div>`,
            )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-log-viewer": LogViewer;
  }
}
