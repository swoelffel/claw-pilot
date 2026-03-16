// ui/src/components/instance-permissions.ts
// Panneau Permissions — règles persistées, demandes en attente, historique 24h
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles, spinnerStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";

interface PermissionRule {
  id: string;
  scope: string;
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
  created_at: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

@localized()
@customElement("cp-instance-permissions")
export class InstancePermissions extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    spinnerStyles,
    css`
      :host {
        display: block;
      }

      .perm-panel {
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
        margin-bottom: 16px;
      }

      /* ── Groups ─────────────────────────────────────────── */

      .group {
        margin-bottom: 20px;
      }

      .group-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        margin-bottom: 8px;
      }

      .group-subtitle {
        font-size: 11px;
        color: var(--text-muted);
        margin-bottom: 8px;
        font-style: italic;
      }

      /* ── Rules list ─────────────────────────────────────── */

      .rules-list {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .rule-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--bg-border);
        font-size: 12px;
      }

      .rule-row:last-child {
        border-bottom: none;
      }

      .rule-action {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }

      .rule-action.allow {
        background: rgba(16, 185, 129, 0.1);
        color: var(--state-running);
        border: 1px solid rgba(16, 185, 129, 0.25);
      }

      .rule-action.deny {
        background: rgba(239, 68, 68, 0.1);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.25);
      }

      .rule-action.ask {
        background: rgba(245, 158, 11, 0.1);
        color: var(--state-warning);
        border: 1px solid rgba(245, 158, 11, 0.25);
      }

      .rule-permission {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-primary);
        flex-shrink: 0;
      }

      .rule-pattern {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-secondary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rule-scope {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .rule-time {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
        white-space: nowrap;
      }

      .btn-revoke {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        line-height: 1;
        transition: color 0.15s;
        flex-shrink: 0;
      }

      .btn-revoke:hover {
        color: var(--state-error);
      }

      /* ── Pending section ────────────────────────────────── */

      .pending-group {
        background: rgba(245, 158, 11, 0.06);
        border: 1px solid rgba(245, 158, 11, 0.25);
        border-radius: var(--radius-md);
        padding: 12px;
        margin-bottom: 20px;
      }

      .pending-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--state-warning);
        margin-bottom: 8px;
      }

      .pending-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        padding: 6px 0;
        border-bottom: 1px solid rgba(245, 158, 11, 0.15);
      }

      .pending-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .btn-handle {
        padding: 3px 10px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.08);
        color: var(--state-warning);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        flex-shrink: 0;
        font-family: var(--font-ui);
      }

      .btn-handle:hover {
        background: rgba(245, 158, 11, 0.15);
      }

      /* ── Empty state ────────────────────────────────────── */

      .empty-msg {
        font-size: 13px;
        color: var(--text-muted);
        padding: 10px 0;
        font-style: italic;
      }

      /* ── Footer ─────────────────────────────────────────── */

      .footer {
        margin-top: 8px;
        display: flex;
        align-items: center;
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

      .error-msg {
        font-size: 12px;
        color: var(--state-error);
      }
    `,
  ];

  @property({ type: String }) slug = "";
  @property({ type: Boolean }) active = false;

  @state() private _rules: PermissionRule[] = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _revoking: Set<string> = new Set();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("active") && this.active) {
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
      const res = await fetch(`/api/instances/${this.slug}/runtime/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rules: PermissionRule[] };
      this._rules = data.rules ?? [];
    } catch (err) {
      this._error = err instanceof Error ? err.message : "Failed to load permissions";
    } finally {
      this._loading = false;
    }
  }

  private async _revoke(id: string): Promise<void> {
    const next = new Set(this._revoking);
    next.add(id);
    this._revoking = next;
    try {
      const token = getToken();
      await fetch(`/api/instances/${this.slug}/runtime/permissions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      this._rules = this._rules.filter((r) => r.id !== id);
    } catch {
      // Silently ignore — user can refresh
    } finally {
      const next2 = new Set(this._revoking);
      next2.delete(id);
      this._revoking = next2;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private _renderRule(rule: PermissionRule) {
    const isRevoking = this._revoking.has(rule.id);
    return html`
      <div class="rule-row">
        <span class="rule-action ${rule.action}">${rule.action}</span>
        <span class="rule-permission">${rule.permission}</span>
        <span class="rule-pattern" title=${rule.pattern}>${rule.pattern}</span>
        <span class="rule-scope">${rule.scope}</span>
        <span class="rule-time">${relativeTime(rule.created_at)}</span>
        <button
          class="btn-revoke"
          title=${msg("Revoke", { id: "perm-btn-revoke" })}
          ?disabled=${isRevoking}
          @click=${() => void this._revoke(rule.id)}
        >
          ${isRevoking ? html`<span class="spinner" style="width:10px;height:10px"></span>` : "✕"}
        </button>
      </div>
    `;
  }

  override render() {
    // Sépare les règles persistées (allow/deny) des demandes en attente (ask)
    const persistedRules = this._rules.filter((r) => r.action !== "ask");
    const pendingRules = this._rules.filter((r) => r.action === "ask");

    return html`
      <div class="perm-panel">
        <div class="section-header">${msg("Permissions", { id: "perm-panel-title" })}</div>

        ${this._loading ? html`<div class="spinner"></div>` : nothing}

        <!-- Demandes en attente -->
        ${pendingRules.length > 0
          ? html`
              <div class="pending-group">
                <div class="pending-title">
                  ${msg("Pending requests", { id: "perm-pending-title" })} (${pendingRules.length})
                </div>
                ${pendingRules.map(
                  (r) => html`
                    <div class="pending-row">
                      <span class="rule-permission">${r.permission}</span>
                      <span class="rule-pattern" title=${r.pattern}>${r.pattern}</span>
                      <span class="rule-time">${relativeTime(r.created_at)}</span>
                      <button
                        class="btn-handle"
                        @click=${() => {
                          // Émet un événement pour que cp-app ouvre l'overlay
                          this.dispatchEvent(
                            new CustomEvent("open-permission-overlay", {
                              detail: { permissionId: r.id, slug: this.slug },
                              bubbles: true,
                              composed: true,
                            }),
                          );
                        }}
                      >
                        ${msg("Handle", { id: "perm-btn-handle" })}
                      </button>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}

        <!-- Règles persistées -->
        <div class="group">
          <div class="group-title">
            ${msg("Persistent rules", { id: "perm-persistent-title" })} (${persistedRules.length})
          </div>
          <div class="group-subtitle">
            ${msg("Approved by user — survive restarts", { id: "perm-persistent-subtitle" })}
          </div>
          ${persistedRules.length > 0
            ? html`
                <div class="rules-list">${persistedRules.map((r) => this._renderRule(r))}</div>
              `
            : html`<p class="empty-msg">
                ${msg("No persistent rules.", { id: "perm-no-rules" })}
              </p>`}
        </div>

        <!-- Footer -->
        <div class="footer">
          <button class="btn-refresh" @click=${() => void this._load()}>
            ↻ ${msg("Refresh", { id: "perm-btn-refresh" })}
          </button>
          ${this._error ? html`<span class="error-msg">${this._error}</span>` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-instance-permissions": InstancePermissions;
  }
}
