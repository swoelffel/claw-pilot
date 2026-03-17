// ui/src/components/pilot/parts/part-tool.ts
// Renders a tool_call part with its associated tool_result.
// Shows: tool name, state (pending/running/completed/error), args (collapsible), output (collapsible), duration.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { PilotPart } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

interface ToolCallMeta {
  toolName?: string;
  args?: unknown;
  durationMs?: number;
}

const TOOL_ICONS: Record<string, string> = {
  bash: "⬡",
  read: "◎",
  write: "✎",
  edit: "✐",
  multiedit: "✐✐",
  glob: "⊕",
  grep: "⊛",
  webfetch: "↗",
  task: "⬡⬡",
  question: "?",
  todowrite: "☑",
  todoread: "☐",
  skill: "★",
  memory_search: "◈",
};

function toolIcon(name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TOOL_ICONS)) {
    if (lower.startsWith(k)) return v;
  }
  return "⚙";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

@localized()
@customElement("cp-pilot-part-tool")
export class PilotPartTool extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .tool-block {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        font-size: 12px;
      }

      /* Header */
      .tool-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        background: var(--bg-hover);
        cursor: default;
      }

      .tool-icon {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        flex-shrink: 0;
      }

      .tool-name {
        font-weight: 600;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 12px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tool-state {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        flex-shrink: 0;
      }

      .tool-state.pending {
        color: var(--text-muted);
      }
      .tool-state.running {
        color: var(--state-warning);
      }
      .tool-state.completed {
        color: var(--state-running);
      }
      .tool-state.error {
        color: var(--state-error);
      }

      .state-spinner {
        width: 10px;
        height: 10px;
        border: 1.5px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .tool-duration {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        flex-shrink: 0;
      }

      /* Collapsible sections */
      .section {
        border-top: 1px solid var(--bg-border);
      }

      .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        background: none;
        border: none;
        width: 100%;
        text-align: left;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--text-muted);
        cursor: pointer;
        transition: color 0.12s;
      }

      .section-toggle:hover {
        color: var(--text-secondary);
      }

      .section-toggle-chevron {
        font-size: 9px;
        transition: transform 0.15s;
        flex-shrink: 0;
      }

      .section-toggle.expanded .section-toggle-chevron {
        transform: rotate(90deg);
      }

      .section-content {
        padding: 6px 10px 8px;
        background: var(--bg-surface);
      }

      pre {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--text-secondary);
      }

      pre.error-output {
        color: var(--state-error);
      }

      .show-more {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: var(--accent);
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        font-family: var(--font-ui);
      }

      .show-more:hover {
        text-decoration: underline;
      }
    `,
  ];

  @property({ type: Object }) call!: PilotPart;
  @property({ type: Object }) result?: PilotPart;

  @state() private _argsExpanded = false;
  @state() private _outputExpanded = false;
  @state() private _showFullOutput = false;

  private _meta(): ToolCallMeta {
    try {
      return (this.call.metadata ? JSON.parse(this.call.metadata) : {}) as ToolCallMeta;
    } catch {
      return {};
    }
  }

  private _renderState(state: string | undefined, durationMs?: number) {
    const s = state ?? "pending";
    const labels: Record<string, string> = {
      pending: "pending",
      running: "running",
      completed: "done",
      error: "error",
    };
    return html`
      <span class="tool-state ${s}">
        ${s === "running" ? html`<span class="state-spinner"></span>` : nothing}
        ${s === "completed" ? "✓" : nothing} ${s === "error" ? "✕" : nothing} ${labels[s] ?? s}
      </span>
      ${durationMs !== undefined && s !== "pending" && s !== "running"
        ? html`<span class="tool-duration">(${formatDuration(durationMs)})</span>`
        : nothing}
    `;
  }

  private _renderArgs(args: unknown) {
    const str = JSON.stringify(args, null, 2);
    const lines = str.split("\n");
    const compact = lines.length <= 4;
    if (compact && !this._argsExpanded) {
      // Show inline if short
      return html`<pre>${str}</pre>`;
    }
    return html`
      <button
        class="section-toggle ${this._argsExpanded ? "expanded" : ""}"
        @click=${() => {
          this._argsExpanded = !this._argsExpanded;
        }}
      >
        <span class="section-toggle-chevron">▶</span>
        ${msg("Arguments", { id: "part-tool-args" })}
        <span style="color:var(--text-muted);font-size:10px">(${lines.length} lines)</span>
      </button>
      ${this._argsExpanded ? html`<div class="section-content"><pre>${str}</pre></div>` : nothing}
    `;
  }

  private _renderOutput(content: string, isError: boolean) {
    const MAX_LINES = 20;
    const lines = content.split("\n");
    const truncated = lines.length > MAX_LINES && !this._showFullOutput;
    const displayed = truncated ? lines.slice(0, MAX_LINES).join("\n") : content;

    return html`
      <button
        class="section-toggle ${this._outputExpanded ? "expanded" : ""}"
        @click=${() => {
          this._outputExpanded = !this._outputExpanded;
        }}
      >
        <span class="section-toggle-chevron">▶</span>
        ${msg("Output", { id: "part-tool-output" })}
        <span style="color:var(--text-muted);font-size:10px">(${lines.length} lines)</span>
      </button>
      ${this._outputExpanded
        ? html`
            <div class="section-content">
              <pre class="${isError ? "error-output" : ""}">${displayed}</pre>
              ${truncated
                ? html`
                    <button
                      class="show-more"
                      @click=${() => {
                        this._showFullOutput = true;
                      }}
                    >
                      ${msg("Show all", { id: "part-tool-show-all" })} (${lines.length} lines)
                    </button>
                  `
                : nothing}
            </div>
          `
        : nothing}
    `;
  }

  override render() {
    if (!this.call) return nothing;

    const meta = this._meta();
    const toolName = meta.toolName ?? this.call.id;
    const state = this.result?.state ?? this.call.state;
    const durationMs = meta.durationMs;
    const outputContent = this.result?.content ?? "";
    const isError = state === "error";

    // Auto-expand args if short, and output if completed
    const argsStr = JSON.stringify(meta.args, null, 2);
    const argsLines = argsStr.split("\n").length;
    const showArgsInline = argsLines <= 4;

    return html`
      <div class="tool-block">
        <div class="tool-header">
          <span class="tool-icon">${toolIcon(toolName)}</span>
          <span class="tool-name">${toolName}</span>
          ${this._renderState(state, durationMs)}
        </div>

        ${meta.args !== undefined
          ? html`
              <div class="section">
                ${showArgsInline && !this._argsExpanded
                  ? html`
                      <button
                        class="section-toggle ${this._argsExpanded ? "expanded" : ""}"
                        @click=${() => {
                          this._argsExpanded = !this._argsExpanded;
                        }}
                      >
                        <span class="section-toggle-chevron">▶</span>
                        ${msg("Arguments", { id: "part-tool-args" })}
                      </button>
                      ${this._argsExpanded
                        ? html`<div class="section-content"><pre>${argsStr}</pre></div>`
                        : nothing}
                    `
                  : this._renderArgs(meta.args)}
              </div>
            `
          : nothing}
        ${outputContent
          ? html`<div class="section">${this._renderOutput(outputContent, isError)}</div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-part-tool": PilotPartTool;
  }
}
