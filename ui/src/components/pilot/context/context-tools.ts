// ui/src/components/pilot/context/context-tools.ts
// Shows available tools: built-in grouped and MCP per server with status.
import { LitElement, html, nothing, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { SessionContext } from "../../../types.js";
import { tokenStyles } from "../../../styles/tokens.js";

type ToolEntry = SessionContext["tools"][number];
type McpServer = SessionContext["mcpServers"][number];

@localized()
@customElement("cp-pilot-context-tools")
export class PilotContextTools extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .tools-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      .group-count {
        font-size: 10px;
        color: var(--text-muted);
        font-family: var(--font-mono);
        background: var(--bg-hover);
        padding: 1px 6px;
        border-radius: 3px;
      }

      .tool-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 2px;
      }

      .tool-chip {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: 3px;
        padding: 2px 6px;
        white-space: nowrap;
      }

      /* MCP server */
      .mcp-server {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-hover);
      }

      .mcp-server-header {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .mcp-server-name {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mcp-status {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        flex-shrink: 0;
        font-weight: 600;
      }

      .mcp-status.connected {
        background: rgba(16, 185, 129, 0.1);
        color: var(--state-running);
        border: 1px solid rgba(16, 185, 129, 0.2);
      }

      .mcp-status.disabled {
        background: rgba(100, 116, 139, 0.1);
        color: var(--text-muted);
        border: 1px solid rgba(100, 116, 139, 0.15);
      }

      .mcp-status.failed,
      .mcp-status.unknown {
        background: rgba(239, 68, 68, 0.08);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.2);
      }

      .mcp-error {
        font-size: 10px;
        color: var(--state-error);
        white-space: pre-wrap;
        word-break: break-all;
      }

      .toggle-btn {
        font-size: 10px;
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 0;
        font-family: var(--font-ui);
        transition: color 0.12s;
      }

      .toggle-btn:hover {
        color: var(--text-secondary);
      }
    `,
  ];

  @property({ type: Array }) tools: ToolEntry[] = [];
  @property({ type: Array }) mcpServers: McpServer[] = [];

  @state() private _builtinExpanded = true;

  override render() {
    const builtin = this.tools.filter((t) => t.source === "builtin");
    const mcp = this.tools.filter((t) => t.source === "mcp");
    const total = this.tools.length;

    return html`
      <div class="tools-wrap">
        <!-- Section header -->
        <div class="group-header">
          <span class="group-label">${msg("Tools", { id: "context-tools-title" })}</span>
          <span class="group-count">${total}</span>
        </div>

        <!-- Built-in tools -->
        ${builtin.length > 0
          ? html`
              <div>
                <div class="group-header">
                  <span class="group-label" style="font-size:10px;letter-spacing:0.04em">
                    ${msg("Built-in", { id: "context-tools-builtin" })} (${builtin.length})
                  </span>
                  <button
                    class="toggle-btn"
                    @click=${() => {
                      this._builtinExpanded = !this._builtinExpanded;
                    }}
                  >
                    ${this._builtinExpanded ? "▴" : "▾"}
                  </button>
                </div>
                ${this._builtinExpanded
                  ? html`
                      <div class="tool-list">
                        ${builtin.map((t) => html`<span class="tool-chip">${t.name}</span>`)}
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}

        <!-- MCP servers -->
        ${this.mcpServers.map((srv) => {
          const srvTools = mcp.filter((t) => t.serverId === srv.id);
          return html`
            <div class="mcp-server">
              <div class="mcp-server-header">
                <span class="mcp-server-name">MCP: ${srv.id}</span>
                <span class="mcp-status ${srv.status}">
                  ${srv.status === "connected" ? "●" : srv.status === "disabled" ? "○" : "✕"}
                  ${srv.status}
                </span>
                ${srvTools.length > 0
                  ? html`<span class="group-count">${srvTools.length}</span>`
                  : nothing}
              </div>
              ${srv.lastError ? html`<div class="mcp-error">${srv.lastError}</div>` : nothing}
              ${srvTools.length > 0
                ? html`
                    <div class="tool-list">
                      ${srvTools.map(
                        (t) =>
                          html`<span class="tool-chip"
                            >${t.name.split("_").slice(1).join("_") || t.name}</span
                          >`,
                      )}
                    </div>
                  `
                : nothing}
            </div>
          `;
        })}
        ${this.mcpServers.length === 0 && mcp.length === 0
          ? html`<span style="font-size:11px;color:var(--text-muted)"
              >${msg("No MCP servers configured", { id: "context-tools-no-mcp" })}</span
            >`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-pilot-context-tools": PilotContextTools;
  }
}
