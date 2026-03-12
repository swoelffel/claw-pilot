// src/e2e/helpers/test-client.ts
// Simple fetch wrapper with cookie jar and auth helpers

export class TestClient {
  private cookies: Map<string, string> = new Map();
  private bearerToken?: string;

  constructor(
    private baseUrl: string,
    private dashboardToken: string,
  ) {}

  /** Login with username/password. Stores the session cookie automatically. */
  async login(username = "admin", password = "E2eTestPassword1"): Promise<void> {
    const res = await this.post("/api/auth/login", { username, password });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    // Parse Set-Cookie header and store cookies
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.parseCookies(setCookie);
    }
  }

  /** Returns a new TestClient that uses Bearer token auth instead of cookies. */
  withBearer(token?: string): TestClient {
    const c = new TestClient(this.baseUrl, this.dashboardToken);
    c.bearerToken = token ?? this.dashboardToken;
    return c;
  }

  async get(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      method: "GET",
      headers: this.buildHeaders(init?.headers),
    });
  }

  async post(path: string, body?: unknown, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      method: "POST",
      headers: this.buildHeaders(init?.headers, body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async patch(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.buildHeaders(undefined, body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async delete(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
  }

  /** SSE helper — collects all events until the stream closes. */
  async collectSse(path: string, maxEvents = 50): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.buildHeaders(),
    });
    if (!res.ok || !res.body) throw new Error(`SSE request failed: ${res.status}`);

    const events: string[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (events.length < maxEvents) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            events.push(line.slice(6));
          }
        }
      }
    } finally {
      reader.cancel();
    }
    return events;
  }

  private buildHeaders(extra?: RequestInit["headers"], hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasBody) headers["Content-Type"] = "application/json";

    // Auth: Bearer token takes priority if set, otherwise use cookies
    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    } else if (this.cookies.size > 0) {
      headers["Cookie"] = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    // Merge extra headers
    if (extra) {
      const extraObj =
        extra instanceof Headers
          ? Object.fromEntries(extra.entries())
          : Array.isArray(extra)
            ? Object.fromEntries(extra)
            : (extra as Record<string, string>);
      Object.assign(headers, extraObj);
    }

    return headers;
  }

  private parseCookies(setCookieHeader: string): void {
    // Handle multiple cookies (comma-separated or multiple Set-Cookie headers)
    // Simple parser: extract name=value pairs
    const parts = setCookieHeader.split(/,(?=[^;]+=[^;]+)/);
    for (const part of parts) {
      const [nameValue] = part.trim().split(";");
      if (nameValue) {
        const eqIdx = nameValue.indexOf("=");
        if (eqIdx > 0) {
          const name = nameValue.slice(0, eqIdx).trim();
          const value = nameValue.slice(eqIdx + 1).trim();
          if (value) {
            this.cookies.set(name, value);
          } else {
            this.cookies.delete(name); // empty value = cookie cleared
          }
        }
      }
    }
  }
}
