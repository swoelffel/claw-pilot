// ui/src/components/session-tree.ts
// Vue arborescente des sessions claw-runtime (parent/enfant via parent_id + spawn_depth)
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { getToken } from "../services/auth-state.js";

interface SessionNode {
  id: string;
  agentId: string;
  channel: string;
  state: "active" | "archived";
  label?: string;
  parentId?: string;
  spawnDepth: number;
  createdAt: string;
  totalCostUsd?: number;
  messageCount?: number;
  children: SessionNode[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatCost(usd: number): string {
  if (usd <= 0) return "";
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function buildTree(sessions: SessionNode[]): SessionNode[] {
  const map = new Map<string, SessionNode>();
  for (const s of sessions) {
    map.set(s.id, { ...s, children: [] });
  }
  const roots: SessionNode[] = [];
  for (const s of map.values()) {
    if (s.parentId && map.has(s.parentId)) {
      map.get(s.parentId)!.children.push(s);
    } else {
      roots.push(s);
    }
  }
  return roots;
}

@localized()
@customElement("cp-session-tree")
export class SessionTree extends LitElement {
  static override styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }

      .tree-panel {
        padding: 0;
      }

      .section-header {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--bg-border);
        margin-bottom: 12px;
      }

      /* ── Session rows ────────────────────────────────────── */

      .session-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 0;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
        min-width: 0;
      }

      .session-row:last-child {
        border-bottom: none;
      }

      .session-indent {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        color: var(--text-muted);
        font-size: 11px;
        font-family: var(--font-mono);
      }

      .session-status {
        font-size: 11px;
        flex-shrink: 0;
      }

      .session-status.active {
        color: var(--state-running);
      }

      .session-status.archived {
        color: var(--text-muted);
      }

      .session-status.error {
        color: var(--state-error);
      }

      .session-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-primary);
        font-weight: 500;
      }

      .session-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .session-agent {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--accent);
        background: var(--accent-subtle);
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-sm);
        padding: 1px 5px;
      }

      .session-channel {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-muted);
      }

      .session-time {
        font-size: 10px;
        color: var(--text-muted);
        white-space: nowrap;
      }

      .session-cost {
        font-size: 10px;
        font-family: var(--font-mono);
        color: var(--text-secondary);
        white-space: nowrap;
      }

      .btn-goto {
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        transition:
          color 0.15s,
          border-color 0.15s;
        flex-shrink: 0;
      }

      .btn-goto:hover {
        color: var(--accent);
        border-color: var(--accent-border);
      }

      /* ── Empty / loading ────────────────────────────────── */

      .empty-msg {
        font-size: 13px;
        color: var(--text-muted);
        padding: 12px 0;
        font-style: italic;
      }

      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid var(--bg-border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        margin: 8px 0;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .footer {
        margin-top: 8px;
        display: flex;
        gap: 10px;
      }

      .btn-refresh {
        padding: 5px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
      }

      .btn-refresh:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .btn-purge {
        padding: 5px 12px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--state-error);
        background: transparent;
        color: var(--state-error);
        font-size: 12px;
        cursor: pointer;
        opacity: 0.7;
        transition:
          background 0.15s,
          opacity 0.15s;
      }

      .btn-purge:hover {
        background: color-mix(in srgb, var(--state-error) 12%, transparent);
        opacity: 1;
      }

      .btn-purge:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    `,
  ];

  @property({ type: String }) slug = "";

  @state() private _roots: SessionNode[] = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _purging = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("slug") && this.slug) {
      void this._load();
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    if (!this.slug) return;
    this._loading = true;
    this._error = "";
    try {
      const token = getToken();
      // Charge les sessions actives et archivées
      const [activeRes, archivedRes] = await Promise.all([
        fetch(`/api/instances/${this.slug}/runtime/sessions?state=active&limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/instances/${this.slug}/runtime/sessions?state=archived&limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const activeData = (await activeRes.json()) as { sessions: SessionNode[] };
      const archivedData = (await archivedRes.json()) as { sessions: SessionNode[] };

      const all = [...(activeData.sessions ?? []), ...(archivedData.sessions ?? [])];
      this._roots = buildTree(all);
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load sessions";
    } finally {
      this._loading = false;
    }
  }

  private async _purgeArchived(): Promise<void> {
    if (this._purging) return;
    this._purging = true;
    try {
      const token = getToken();
      await fetch(`/api/instances/${this.slug}/runtime/sessions?state=archived`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await this._load();
    } finally {
      this._purging = false;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private _renderNode(node: SessionNode, depth = 0): unknown {
    const statusIcon = node.state === "active" ? "●" : "✓";
    const statusClass = node.state;
    const label = node.label ?? node.agentId;
    const cost = formatCost(node.totalCostUsd ?? 0);

    return html`
      <div class="session-row">
        ${depth > 0 ? html`<span class="session-indent">${"  ".repeat(depth)}└─</span>` : nothing}
        <span class="session-status ${statusClass}">${statusIcon}</span>
        <span class="session-label" title=${label}>${label}</span>
        <div class="session-meta">
          <span class="session-agent">${node.agentId}</span>
          <span class="session-channel">${node.channel}</span>
          <span class="session-time">${relativeTime(node.createdAt)}</span>
          ${cost ? html`<span class="session-cost">${cost}</span>` : nothing}
          <button
            class="btn-goto"
            title=${msg("Open session", { id: "session-tree-open" })}
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent("session-selected", {
                  detail: { sessionId: node.id, slug: this.slug },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            →
          </button>
        </div>
      </div>
      ${node.children.map((child) => this._renderNode(child, depth + 1))}
    `;
  }

  override render() {
    return html`
      <div class="tree-panel">
        <div class="section-header">${msg("Sessions", { id: "session-tree-title" })}</div>

        ${this._loading ? html`<div class="spinner"></div>` : nothing}
        ${!this._loading && this._roots.length === 0
          ? html`<p class="empty-msg">${msg("No sessions yet.", { id: "session-tree-empty" })}</p>`
          : nothing}
        ${this._roots.map((root) => this._renderNode(root))}

        <div class="footer">
          <button class="btn-refresh" @click=${() => void this._load()}>
            ↻ ${msg("Refresh", { id: "session-tree-refresh" })}
          </button>
          <button
            class="btn-purge"
            ?disabled=${this._purging}
            @click=${() => void this._purgeArchived()}
          >
            ${this._purging
              ? msg("Purging…", { id: "session-tree-purging" })
              : msg("Purge archived", { id: "session-tree-purge" })}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-session-tree": SessionTree;
  }
}
