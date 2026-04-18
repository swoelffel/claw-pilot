// src/dashboard/routes/__tests__/_internal-api-client.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../lib/platform.js", () => ({
  resolveActualInternalApiPort: vi.fn(() => 19100),
  resolveInternalApiToken: vi.fn(() => "test-token"),
}));

import { callRuntimeApi, publishRuntimeEvent } from "../_internal-api-client.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// callRuntimeApi — success + error paths
// ---------------------------------------------------------------------------

describe("callRuntimeApi", () => {
  it("returns parsed JSON on 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: 42 }),
      }),
    );
    const result = await callRuntimeApi<{ answer: number }>("my-slug", "/test", { q: 1 });
    expect(result.answer).toBe(42);
  });

  it("calls the internal port and sends Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await callRuntimeApi("my-slug", "/test", { foo: "bar" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("127.0.0.1:19100/test");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.body).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("throws with server error code when response has parseable error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom", code: "INTERNAL" }),
      }),
    );
    await expect(callRuntimeApi("slug", "/x", {})).rejects.toMatchObject({
      message: "boom",
      code: "INTERNAL",
      status: 500,
    });
  });

  it("throws with default code when error body parsing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    await expect(callRuntimeApi("slug", "/x", {})).rejects.toMatchObject({
      message: "Runtime API returned 503",
      code: "RUNTIME_ERROR",
      status: 503,
    });
  });

  it("propagates fetch-level failure (e.g. network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(callRuntimeApi("slug", "/x", {})).rejects.toThrow("ECONNREFUSED");
  });

  it("honors custom timeoutMs option", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await callRuntimeApi("slug", "/x", {}, { timeoutMs: 1000 });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// publishRuntimeEvent — best-effort (never throws)
// ---------------------------------------------------------------------------

describe("publishRuntimeEvent", () => {
  it("resolves without throwing when daemon returns ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(publishRuntimeEvent("slug", "evt", { k: "v" })).resolves.toBeUndefined();
  });

  it("resolves without throwing when daemon rejects (non-ok)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(publishRuntimeEvent("slug", "evt", { k: "v" })).resolves.toBeUndefined();
  });

  it("resolves without throwing when fetch throws (daemon down)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(publishRuntimeEvent("slug", "evt", { k: "v" })).resolves.toBeUndefined();
  });

  it("sends type + payload in request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await publishRuntimeEvent("slug", "my-event", { foo: 1, bar: "baz" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ type: "my-event", payload: { foo: 1, bar: "baz" } }));
  });
});
