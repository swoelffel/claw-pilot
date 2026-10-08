import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchRuntimeRequests, recoverRequestDelivery } from "../api.js";
import type { RuntimeRequest } from "../types.js";

@customElement("cp-request-list")
class RequestList extends LitElement {
  @property() slug = "";
  @state() private requests: RuntimeRequest[] = [];
  @state() private loading = true;
  @state() private error = "";

  static override styles = css`
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
    button {
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 7px 11px;
      cursor: pointer;
      background: var(--surface-raised);
      color: inherit;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    article {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      background: var(--surface);
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
      background: var(--surface-raised);
    }
    .error {
      color: var(--danger);
    }
    .muted {
      color: var(--text-secondary);
      font-size: 13px;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
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
    try {
      await recoverRequestDelivery(this.slug, request.id);
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  override render() {
    return html`
      <header>
        <h1>My Requests — ${this.slug}</h1>
        <button @click=${() => void this.load()}>Refresh</button>
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
                  ${request.delivery_status === "delivery_failed" && request.result_message_id
                    ? html`<button @click=${() => void this.recover(request)}>
                        Recover result
                      </button>`
                    : ""}
                </article>`,
            )}
            ${this.requests.length === 0 ? html`<p class="muted">No requests yet.</p>` : ""}
          </div>`}
    `;
  }
}

// The decorator registers the class; retain a value reference for static analyzers.
void RequestList;
