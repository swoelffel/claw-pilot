import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchRuntimeRequests, recoverRequestDelivery } from "../api.js";
import { localized, msg } from "@lit/localize";
import { tokenStyles } from "../styles/tokens.js";
import { buttonStyles } from "../styles/shared.js";
import { buildTimeline } from "./pilot/timeline-utils.js";
import "./pilot/pilot-message.js";
import type { RequestRecoveryResponse, RuntimeRequest } from "../types.js";

@localized()
@customElement("cp-request-list")
class RequestList extends LitElement {
  @property() slug = "";
  @state() private requests: RuntimeRequest[] = [];
  @state() private loading = false;
  @state() private error = "";

  @state() private results: Record<string, RequestRecoveryResponse["result"]> = {};
  @state() private recovering = new Set<string>();

  // Primitive: shared buttonStyles.btn-ghost and existing Pilot message/artifact renderers.
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 24px;
        color: var(--text-primary);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 18px;
      }
      h1 {
        font-size: 22px;
        margin: 0;
      }
      .btn {
        min-height: 44px;
      }
      .btn:focus-visible,
      summary:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
      }
      .recovered-result {
        min-width: 0;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      summary {
        cursor: pointer;
        min-height: 44px;
      }
      .list {
        display: grid;
        gap: 10px;
      }
      article {
        border: 1px solid var(--bg-border);
        border-radius: 10px;
        padding: 14px;
        background: var(--bg-surface);
        display: grid;
        gap: 8px;
      }
      .top,
      .meta {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      code {
        font-size: 12px;
      }
      .status {
        border-radius: 999px;
        padding: 3px 8px;
        background: var(--bg-hover);
      }
      .error {
        color: var(--state-error);
      }
      .muted {
        color: var(--text-secondary);
        font-size: 13px;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    if (this.loading || this.recovering.size > 0) return;
    this.loading = true;
    this.error = "";
    try {
      this.requests = await fetchRuntimeRequests(this.slug, { limit: 100 });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  private async recover(request: RuntimeRequest): Promise<void> {
    if (this.loading || this.recovering.has(request.id)) return;
    this.error = "";
    this.recovering = new Set([...this.recovering, request.id]);
    try {
      const response = await recoverRequestDelivery(this.slug, request.id);
      this.results = { ...this.results, [request.id]: response.result };
      this.requests = this.requests.map((row) =>
        row.id === request.id ? { ...row, ...response } : row,
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.recovering = new Set([...this.recovering].filter((id) => id !== request.id));
    }
  }

  private renderResult(requestId: string) {
    const result = this.results[requestId];
    if (!result) return "";
    const artifacts = buildTimeline([result.message]).filter(
      (entry) => entry.kind === "artifact" || entry.kind === "tool_call" || entry.kind === "image",
    );
    return html`<section class="recovered-result" aria-live="polite">
      <h2>${msg("Saved result", { id: "request-list-result-title" })}</h2>
      <p class="muted">
        ${msg("Retrieved here from saved output. The original channel has not been retried.", {
          id: "request-list-result-channel",
        })}
      </p>
      ${result.partial
        ? html`<p class="error">
            ${msg("Partial saved result. Delivery status is unchanged.", {
              id: "request-list-result-partial",
            })}
          </p>`
        : ""}
      <pre>${result.text}</pre>
      ${artifacts.map(
        (entry) => html`<cp-pilot-message .entry=${entry} .slug=${this.slug}></cp-pilot-message>`,
      )}
      <details>
        <summary>${msg("View saved message", { id: "request-list-result-message" })}</summary>
        <code>${result.message.id}</code>
        ${result.message.parts
          .filter((part) => part.content)
          .map((part) => html`<pre>${part.content}</pre>`)}
      </details>
    </section>`;
  }

  override render() {
    return html`
      <header>
        <h1>My Requests — ${this.slug}</h1>
        <button
          class="btn btn-ghost"
          ?disabled=${this.loading || this.recovering.size > 0}
          @click=${() => void this.load()}
        >
          Refresh
        </button>
      </header>
      ${this.error ? html`<p class="error">${this.error}</p>` : ""}
      ${this.loading
        ? html`<p class="muted">Loading requests…</p>`
        : html` <div class="list">
            ${this.requests.map(
              (request) =>
                html` <article>
                  <div class="top">
                    <code>${request.id}</code
                    ><span class="status">${request.execution_status ?? "not started"}</span>
                    <span class="status">${request.delivery_status}</span>
                  </div>
                  <div class="meta">
                    <span>${request.agent_id ?? "Unassigned"}</span>
                    <span>$${request.cost_usd.toFixed(4)}</span
                    ><span>${request.input_tokens + request.output_tokens} tokens</span>
                    <span>${JSON.parse(request.artifact_refs_json ?? "[]").length} artifacts</span>
                  </div>
                  <div class="muted">
                    Trace ${request.trace_id}${request.task_id ? ` · Task ${request.task_id}` : ""}
                  </div>
                  ${request.error_message
                    ? html`<div class="error">${request.error_message}</div>`
                    : ""}
                  ${request.delivery_status !== "pending" && request.result_message_id
                    ? html`<button
                        class="btn btn-ghost"
                        ?disabled=${this.recovering.has(request.id)}
                        @click=${() => void this.recover(request)}
                      >
                        ${msg("Recover result", { id: "request-list-result-recover" })}
                      </button>`
                    : ""}
                  ${this.renderResult(request.id)}
                </article>`,
            )}
            ${this.requests.length === 0 ? html`<p class="muted">No requests yet.</p>` : ""}
          </div>`}
    `;
  }
}

// The decorator registers the class; retain a value reference for static analyzers.
void RequestList;
