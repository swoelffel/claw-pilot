// ui/src/components/permission-request-overlay.ts
// Overlay coin bas-droite pour les demandes de permission runtime (permission.asked)
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles } from "../styles/shared.js";
import { getToken } from "../services/auth-state.js";

interface PermissionRequest {
  id: string;
  sessionId: string;
  permission: string;
  pattern: string;
  description: string | undefined;
}

@localized()
@customElement("cp-permission-request-overlay")
export class PermissionRequestOverlay extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .overlay {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        width: 480px;
        background: var(--bg-surface);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
        overflow: hidden;
      }

      /* ── Header ─────────────────────────────────────────── */

      .overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px 10px;
        border-bottom: 1px solid var(--bg-border);
        background: rgba(239, 68, 68, 0.06);
      }

      .overlay-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
        color: var(--state-error);
        letter-spacing: 0.02em;
      }

      .overlay-title-icon {
        font-size: 16px;
      }

      .badge-pending {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: 20px;
        background: rgba(239, 68, 68, 0.12);
        color: var(--state-error);
        border: 1px solid rgba(239, 68, 68, 0.25);
        font-size: 10px;
        font-weight: 700;
        font-family: var(--font-mono);
      }

      .btn-dismiss-header {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        transition:
          color 0.15s,
          background 0.15s;
        line-height: 1;
      }

      .btn-dismiss-header:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
      }

      /* ── Body ───────────────────────────────────────────── */

      .overlay-body {
        padding: 14px 16px;
      }

      .perm-description {
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 10px;
        line-height: 1.5;
      }

      .perm-detail {
        display: flex;
        flex-direction: column;
        gap: 4px;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        margin-bottom: 12px;
      }

      .perm-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }

      .perm-label {
        color: var(--text-muted);
        min-width: 72px;
        flex-shrink: 0;
      }

      .perm-value {
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 11px;
        word-break: break-all;
      }

      /* ── Countdown ──────────────────────────────────────── */

      .countdown-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .countdown-label {
        font-size: 11px;
        color: var(--text-muted);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .countdown-bar-track {
        flex: 1;
        height: 4px;
        background: var(--bg-border);
        border-radius: 2px;
        overflow: hidden;
      }

      .countdown-bar-fill {
        height: 100%;
        background: var(--state-error);
        border-radius: 2px;
        transition: width 1s linear;
      }

      /* ── Persist toggle ─────────────────────────────────── */

      .persist-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .persist-label {
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        user-select: none;
      }

      .toggle-track {
        position: relative;
        width: 32px;
        height: 18px;
        background: var(--bg-border);
        border-radius: 9px;
        cursor: pointer;
        transition: background 0.2s;
        flex-shrink: 0;
      }

      .toggle-track.on {
        background: var(--state-error);
      }

      .toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        background: var(--text-primary);
        border-radius: 50%;
        transition: transform 0.2s;
      }

      .toggle-track.on .toggle-thumb {
        transform: translateX(14px);
      }

      /* ── Comment textarea ───────────────────────────────── */

      .comment-area {
        margin-bottom: 12px;
      }

      .comment-area textarea {
        width: 100%;
        resize: none;
        background: var(--bg-hover);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 12px;
        font-family: inherit;
        padding: 8px 10px;
        outline: none;
        line-height: 1.5;
        box-sizing: border-box;
      }

      .comment-area textarea:focus {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
      }

      .comment-area textarea::placeholder {
        color: var(--text-muted);
      }

      /* ── Action buttons ─────────────────────────────────── */

      .action-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .btn-deny {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.1);
        color: var(--state-error);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-deny:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.18);
      }

      .btn-deny:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-deny-feedback {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(239, 68, 68, 0.4);
        background: transparent;
        color: var(--state-error);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-deny-feedback:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.08);
      }

      .btn-deny-feedback:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-approve {
        padding: 6px 14px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(16, 185, 129, 0.4);
        background: rgba(16, 185, 129, 0.1);
        color: var(--state-running);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        font-family: var(--font-ui);
      }

      .btn-approve:hover:not(:disabled) {
        background: rgba(16, 185, 129, 0.18);
      }

      .btn-approve:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-dismiss {
        margin-left: auto;
        padding: 6px 10px;
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
        font-family: var(--font-ui);
      }

      .btn-dismiss:hover {
        background: var(--bg-hover);
        color: var(--text-secondary);
      }

      /* ── Submitting spinner ─────────────────────────────── */

      .spinner-inline {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        vertical-align: middle;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ];

  /** Slug de l'instance à surveiller — doit être défini pour activer le SSE */
  @property({ type: String }) instanceSlug = "";

  @state() private _queue: PermissionRequest[] = [];
  @state() private _persist = false;
  @state() private _showComment = false;
  @state() private _comment = "";
  @state() private _submitting = false;
  @state() private _countdown = 60;

  private _eventSource: EventSource | null = null;
  private _countdownTimer: ReturnType<typeof setInterval> | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.instanceSlug) {
      this._openStream();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeStream();
    this._stopCountdown();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("instanceSlug")) {
      this._closeStream();
      this._stopCountdown();
      this._queue = [];
      if (this.instanceSlug) {
        this._openStream();
      }
    }
  }

  // ── SSE stream ─────────────────────────────────────────────────────────────

  private _openStream(): void {
    if (!this.instanceSlug) return;
    this._closeStream();

    // On écoute le stream de chat pour les événements permission.asked
    // EventSource utilise le cookie de session pour l'auth (envoyé automatiquement)
    const url = `/api/instances/${this.instanceSlug}/runtime/chat/stream`;
    const es = new EventSource(url);
    this._eventSource = es;

    es.onmessage = (e: MessageEvent) => {
      let event: { type: string; payload: Record<string, unknown> };
      try {
        event = JSON.parse(e.data as string) as typeof event;
      } catch {
        return;
      }

      if (event.type === "permission.asked") {
        const p = event.payload;
        const req: PermissionRequest = {
          id: p.id as string,
          sessionId: p.sessionId as string,
          permission: p.permission as string,
          pattern: p.pattern as string,
          description: p.description as string | undefined,
        };
        // Ajouter à la file FIFO si pas déjà présent
        if (!this._queue.find((r) => r.id === req.id)) {
          this._queue = [...this._queue, req];
          // Démarrer le countdown si c'est la première demande
          if (this._queue.length === 1) {
            this._startCountdown();
          }
        }
      }
    };

    es.addEventListener("ping", () => {
      // Keep-alive — ignorer
    });

    es.onerror = () => {
      // Reconnexion automatique par EventSource — pas d'action nécessaire
    };
  }

  private _closeStream(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  // ── Countdown ──────────────────────────────────────────────────────────────

  private _startCountdown(): void {
    this._stopCountdown();
    this._countdown = 60;
    this._countdownTimer = setInterval(() => {
      this._countdown -= 1;
      if (this._countdown <= 0) {
        this._stopCountdown();
        // Auto-dismiss quand le countdown expire
        this._dismiss();
      }
    }, 1000);
  }

  private _stopCountdown(): void {
    if (this._countdownTimer !== null) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async _reply(decision: "allow" | "deny"): Promise<void> {
    const current = this._queue[0];
    if (!current || this._submitting) return;

    this._submitting = true;
    try {
      const token = getToken();
      const body: Record<string, unknown> = {
        permissionId: current.id,
        decision,
        persist: this._persist,
      };
      if (this._comment.trim()) {
        body.comment = this._comment.trim();
      }

      const res = await fetch(`/api/instances/${this.instanceSlug}/runtime/permission/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // Silencieux — on retire quand même de la file
      }
    } catch {
      // Silencieux
    } finally {
      this._submitting = false;
      this._nextRequest();
    }
  }

  private _dismiss(): void {
    this._nextRequest();
  }

  private _nextRequest(): void {
    this._queue = this._queue.slice(1);
    this._comment = "";
    this._showComment = false;
    this._persist = false;
    this._stopCountdown();
    if (this._queue.length > 0) {
      this._startCountdown();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  override render() {
    const current = this._queue[0];
    if (!current) return nothing;

    const pending = this._queue.length;
    const countdownPct = (this._countdown / 60) * 100;

    return html`
      <div class="overlay">
        <!-- Header -->
        <div class="overlay-header">
          <div class="overlay-title">
            <span class="overlay-title-icon">🔐</span>
            ${msg("Permission Request", { id: "perm-overlay-title" })}
            ${pending > 1
              ? html`<span class="badge-pending">${pending} of ${pending}</span>`
              : nothing}
          </div>
          <button
            class="btn-dismiss-header"
            title=${msg("Dismiss", { id: "perm-overlay-dismiss" })}
            @click=${this._dismiss}
          >
            ✕
          </button>
        </div>

        <!-- Body -->
        <div class="overlay-body">
          <!-- Description -->
          ${current.description
            ? html`<div class="perm-description">${current.description}</div>`
            : nothing}

          <!-- Détails permission -->
          <div class="perm-detail">
            <div class="perm-row">
              <span class="perm-label">Permission</span>
              <span class="perm-value">${current.permission}</span>
            </div>
            <div class="perm-row">
              <span class="perm-label">Pattern</span>
              <span class="perm-value">${current.pattern}</span>
            </div>
          </div>

          <!-- Countdown -->
          <div class="countdown-row">
            <span class="countdown-label">${this._countdown}s</span>
            <div class="countdown-bar-track">
              <div class="countdown-bar-fill" style="width: ${countdownPct}%"></div>
            </div>
          </div>

          <!-- Persist toggle -->
          <div class="persist-row">
            <div
              class="toggle-track ${this._persist ? "on" : ""}"
              @click=${() => {
                this._persist = !this._persist;
              }}
            >
              <div class="toggle-thumb"></div>
            </div>
            <span
              class="persist-label"
              @click=${() => {
                this._persist = !this._persist;
              }}
            >
              ${this._persist
                ? msg("Always (for this agent)", { id: "perm-overlay-persist-always" })
                : msg("This time only", { id: "perm-overlay-persist-once" })}
            </span>
          </div>

          <!-- Textarea commentaire (visible si "Deny with feedback") -->
          ${this._showComment
            ? html`
                <div class="comment-area">
                  <textarea
                    rows="3"
                    placeholder=${msg("Comment (optional)", {
                      id: "perm-overlay-comment-placeholder",
                    })}
                    .value=${this._comment}
                    @input=${(e: Event) => {
                      this._comment = (e.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                </div>
              `
            : nothing}

          <!-- Boutons d'action -->
          <div class="action-row">
            <button
              class="btn-deny"
              ?disabled=${this._submitting}
              @click=${() => void this._reply("deny")}
            >
              ${this._submitting
                ? html`<span class="spinner-inline"></span>`
                : msg("Deny", { id: "perm-overlay-deny" })}
            </button>

            <button
              class="btn-deny-feedback"
              ?disabled=${this._submitting}
              @click=${() => {
                if (!this._showComment) {
                  this._showComment = true;
                } else {
                  void this._reply("deny");
                }
              }}
            >
              ${msg("Deny with feedback", { id: "perm-overlay-deny-feedback" })}
            </button>

            <button
              class="btn-approve"
              ?disabled=${this._submitting}
              @click=${() => void this._reply("allow")}
            >
              ${this._submitting
                ? html`<span class="spinner-inline"></span>`
                : msg("Approve", { id: "perm-overlay-approve" })}
            </button>

            <button class="btn-dismiss" @click=${this._dismiss}>
              ${msg("Dismiss", { id: "perm-overlay-dismiss-btn" })}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-permission-request-overlay": PermissionRequestOverlay;
  }
}
