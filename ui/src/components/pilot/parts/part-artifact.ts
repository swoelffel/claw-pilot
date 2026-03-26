// ui/src/components/pilot/parts/part-artifact.ts
// Part renderer for create_artifact tool calls — rich card with header, content, and copy button.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

// ---------------------------------------------------------------------------
// Artifact type icons (simple text fallbacks)
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, string> = {
  code: "{ }",
  markdown: "MD",
  json: "{ }",
  csv: "CSV",
  svg: "SVG",
  html: "</>",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ArtifactArgs {
  title?: string;
  artifactType?: string;
  content?: string;
  language?: string;
}

@localized()
@customElement("cp-pilot-part-artifact")
export class PilotPartArtifact extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      .artifact-card {
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-surface);
      }
      .artifact-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--accent-subtle);
        border-bottom: 1px solid var(--accent-border);
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
      .artifact-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .copy-btn {
        flex-shrink: 0;
        padding: 3px 8px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        font-size: 11px;
        font-family: var(--font-ui);
        cursor: pointer;
        transition:
          color 0.12s,
          border-color 0.12s;
      }
      .copy-btn:hover {
        color: var(--text-primary);
        border-color: var(--accent);
      }
      .copy-btn.copied {
        color: var(--state-running);
        border-color: var(--state-running);
      }
      .artifact-content {
        padding: 10px 12px;
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.5;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-word;
        overflow: auto;
        max-height: 400px;
      }
      .artifact-content.collapsed {
        max-height: 200px;
        position: relative;
      }
      .artifact-content.collapsed::after {
        content: "";
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 40px;
        background: linear-gradient(transparent, var(--bg-surface));
        pointer-events: none;
      }
      .expand-btn {
        display: block;
        width: 100%;
        padding: 6px;
        border: none;
        border-top: 1px solid var(--bg-border);
        background: transparent;
        color: var(--accent);
        font-size: 11px;
        font-family: var(--font-ui);
        cursor: pointer;
        transition: background 0.12s;
      }
      .expand-btn:hover {
        background: var(--accent-subtle);
      }
      .lang-badge {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }
    `,
  ];

  /** The tool_call part */
  @property({ type: Object }) call!: PilotPart;
  /** The tool_result part (if available) */
  @property({ type: Object }) result: PilotPart | undefined;

  @state() private _expanded = false;
  @state() private _copied = false;

  private get _args(): ArtifactArgs {
    try {
      const meta = JSON.parse(this.call.metadata ?? "{}") as { args?: ArtifactArgs };
      return meta.args ?? {};
    } catch {
      return {};
    }
  }

  private get _content(): string {
    // Content is in the tool result (output of the execute function)
    return this.result?.content ?? this._args.content ?? "";
  }

  private get _isLong(): boolean {
    return (
      (this._content.split("\n").length > 30 || this._content.length > 2000) && !this._expanded
    );
  }

  private async _copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this._content);
      this._copied = true;
      setTimeout(() => {
        this._copied = false;
      }, 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }

  override render() {
    const args = this._args;
    const type = args.artifactType ?? "code";
    const icon = TYPE_ICONS[type] ?? "?";
    const title = args.title ?? msg("Artifact", { id: "artifact-default-title" });
    const language = args.language;
    const content = this._content;

    if (!content) return nothing;

    return html`
      <div class="artifact-card">
        <div class="artifact-header">
          <span class="type-icon">${icon}</span>
          <span class="artifact-title">${title}</span>
          ${language ? html`<span class="lang-badge">${language}</span>` : nothing}
          <button class="copy-btn ${this._copied ? "copied" : ""}" @click=${this._copy}>
            ${this._copied
              ? msg("Copied", { id: "artifact-copied" })
              : msg("Copy", { id: "artifact-copy" })}
          </button>
        </div>
        <div class="artifact-content ${this._isLong ? "collapsed" : ""}">${content}</div>
        ${this._isLong
          ? html`<button
              class="expand-btn"
              @click=${() => {
                this._expanded = true;
              }}
            >
              ${msg("Show all", { id: "artifact-show-all" })}
            </button>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-artifact": PilotPartArtifact;
  }
}
