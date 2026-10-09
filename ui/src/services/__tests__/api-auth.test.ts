import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testing } from "../../api.js";
import { clearToken, getToken, setToken } from "../auth-state.js";

describe("API authentication", () => {
  beforeEach(() => {
    clearToken();
    vi.restoreAllMocks();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEventStub {
        constructor(public type: string) {}
      },
    );
  });

  it("does not emit a malformed literal Bearer identity without a token", () => {
    expect(__testing.authHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("refreshes a rejected token once and retries with the normalized token", async () => {
    setToken("expired");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ authenticated: true, token: " refreshed-token " }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(__testing.apiFetch<{ ok: boolean }>("/instances")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getToken()).toBe("refreshed-token");
    const retriedHeaders = fetchMock.mock.calls[2]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(retriedHeaders?.Authorization).toBe("Bearer refreshed-token");
  });

  it("bounds a failed refresh and never retries a permanent 403", async () => {
    setToken("expired");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401, statusText: "Unauthorized" }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(__testing.apiFetch("/instances")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({ code: "PERMISSION_DENIED", error: "forbidden" }, { status: 403 }),
      );
    await expect(__testing.apiFetch("/instances")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
