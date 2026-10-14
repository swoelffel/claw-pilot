// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import "../request-list.js";

const request = {
  id: "request-1",
  trace_id: "trace-1",
  parent_request_id: null,
  session_id: "session-1",
  agent_id: "assistant",
  task_id: null,
  delivery_status: "delivery_failed",
  execution_status: "succeeded",
  result_message_id: "message-1",
  artifact_refs_json: "[]",
  error_message: "Channel unavailable",
  cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  created_at: "2026-01-01T00:00:00Z",
};
const result = {
  text: "Saved report",
  partial: false,
  message: {
    id: "message-1",
    sessionId: "session-1",
    role: "assistant",
    isCompaction: false,
    createdAt: "2026-01-01T00:00:00Z",
    finishReason: "stop",
    parts: [
      {
        id: "part-1",
        messageId: "message-1",
        type: "text",
        content: "Saved report",
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  },
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount() {
  const el = document.createElement("cp-request-list") as LitElement & { slug: string };
  el.slug = "demo";
  document.body.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("article")).not.toBeNull());
  return el;
}

function recoverButton(el: LitElement): HTMLButtonElement {
  return Array.from(el.shadowRoot!.querySelectorAll("button")).find((b) =>
    /Recover/.test(b.textContent!),
  )!;
}

describe("request recovery UI", () => {
  it("shows durable text and delivery status and retains the result after refresh", async () => {
    let delivered = false;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("recover-delivery")) {
        delivered = true;
        return Response.json({
          ...request,
          delivery_status: "delivered",
          error_message: null,
          result,
        });
      }
      return Response.json({
        requests: [{ ...request, delivery_status: delivered ? "delivered" : "delivery_failed" }],
      });
    });
    const el = await mount();
    recoverButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".recovered-result")?.textContent).toContain(
        "Saved report",
      ),
    );
    expect(el.shadowRoot!.querySelector("article")?.textContent).toContain("delivered");
    el.shadowRoot!.querySelector<HTMLButtonElement>("header button")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".recovered-result")?.textContent).toContain(
        "Saved report",
      ),
    );
  });

  it("prevents refresh from replacing the returned delivery status during recovery", async () => {
    let finishRecovery!: (response: Response) => void;
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("recover-delivery")
        ? new Promise<Response>((resolve) => {
            finishRecovery = resolve;
          })
        : Response.json({ requests: [request] }),
    );
    const el = await mount();
    recoverButton(el).click();
    await el.updateComplete;
    const refresh = el.shadowRoot!.querySelector<HTMLButtonElement>("header button")!;
    expect(refresh.disabled).toBe(true);
    refresh.click();
    finishRecovery(
      Response.json({ ...request, delivery_status: "delivered", error_message: null, result }),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("article")?.textContent).toContain("delivered"),
    );
    expect(el.shadowRoot!.querySelector("article")?.textContent).not.toContain("delivery_failed");
    expect(el.shadowRoot!.querySelector(".recovered-result")?.textContent).toContain(
      "Saved report",
    );
  });

  it("allows only one list refresh before recovery", async () => {
    let listReads = 0;
    let finishRefresh!: (response: Response) => void;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("recover-delivery"))
        return Response.json({ ...request, delivery_status: "delivered", result });
      listReads += 1;
      if (listReads === 1) return Response.json({ requests: [request] });
      return new Promise<Response>((resolve) => {
        finishRefresh = resolve;
      });
    });
    const el = await mount();
    const refresh = el.shadowRoot!.querySelector<HTMLButtonElement>("header button")!;
    refresh.click();
    refresh.click();
    expect(listReads).toBe(2);
    await el.updateComplete;
    finishRefresh(Response.json({ requests: [request] }));
    await vi.waitFor(() => expect(recoverButton(el)).toBeTruthy());
    recoverButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("article")?.textContent).toContain("delivered"),
    );
  });

  it("offers the saved file through the existing download card", async () => {
    const call = {
      ...result.message.parts[0],
      id: "file-call",
      type: "tool_call",
      state: "completed",
      content: "",
      metadata: JSON.stringify({ toolCallId: "file-1", toolName: "send_file" }),
    };
    const file = {
      ...result.message.parts[0],
      id: "file-result",
      type: "tool_result",
      metadata: JSON.stringify({ toolCallId: "file-1" }),
      content: JSON.stringify({
        path: "/workspace/report.pdf",
        filename: "report.pdf",
        title: "Saved report file",
        mimeType: "application/pdf",
        sizeBytes: 120,
      }),
    };
    const fileResult = { ...result, text: "", message: { ...result.message, parts: [call, file] } };
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json(
        url.endsWith("recover-delivery")
          ? { ...request, delivery_status: "delivered", result: fileResult }
          : { requests: [request] },
      ),
    );
    const el = await mount();
    recoverButton(el).click();
    let link: HTMLAnchorElement | null | undefined;
    await vi.waitFor(() => {
      link = el.shadowRoot
        ?.querySelector("cp-pilot-message")
        ?.shadowRoot?.querySelector("cp-pilot-part-file")
        ?.shadowRoot?.querySelector("a");
      expect(link?.textContent).toContain("Download");
    });
    expect(link!.getAttribute("download")).toBe("report.pdf");
    const url = new URL(link!.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/api/instances/demo/workspace/download");
    expect(url.searchParams.get("path")).toBe("/workspace/report.pdf");
  });

  it("keeps failed status while displaying an explicitly partial saved result", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json(
        url.endsWith("recover-delivery")
          ? { ...request, result: { ...result, partial: true } }
          : { requests: [request] },
      ),
    );
    const el = await mount();
    recoverButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".recovered-result")?.textContent).toContain(
        "Saved report",
      ),
    );
    expect(el.shadowRoot!.querySelector(".recovered-result")?.textContent).toMatch(/partial/i);
    expect(el.shadowRoot!.querySelector("article")?.textContent).toContain("delivery_failed");
  });

  it("keeps the recovery action and failure visible if the saved result is unavailable", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("recover-delivery")
        ? Response.json(
            { error: "No durable result is available", code: "RESULT_NOT_PERSISTED" },
            { status: 409 },
          )
        : Response.json({ requests: [request] }),
    );
    const el = await mount();
    recoverButton(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".error")?.textContent).toContain("No durable result"),
    );
    expect(recoverButton(el)).toBeTruthy();
    expect(el.shadowRoot!.querySelector("article")?.textContent).toContain("delivery_failed");
  });
});
