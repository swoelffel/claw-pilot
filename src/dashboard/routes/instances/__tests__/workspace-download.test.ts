// src/dashboard/routes/instances/__tests__/workspace-download.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { registerWorkspaceDownloadRoutes } from "../workspace-download.js";
import type { RouteDeps } from "../../../route-deps.js";

// Minimal deps — the route only uses getInstanceContext, never the deps object.
const fakeDeps = {} as RouteDeps;

let app: Hono;
let stateDir: string;

async function request(url: string) {
  return app.request(url);
}

beforeEach(async () => {
  // macOS resolves /var/folders through /private/var/folders — the route uses fs.realpath
  // on the target file, so stateDir must be the realpath form too for the startsWith check.
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), "cp-wsd-"));
  stateDir = await fs.realpath(raw);
  app = new Hono();
  app.use("/api/instances/:slug/*", async (c, next) => {
    // `instance` / `slug` context keys are set by instanceMiddleware in production;
    // cast to the loose Context shape to bypass the strict Hono Variables inference.
    (c as unknown as { set: (k: string, v: unknown) => void }).set("instance", {
      state_dir: stateDir,
      slug: "test",
    });
    (c as unknown as { set: (k: string, v: unknown) => void }).set("slug", "test");
    await next();
  });
  registerWorkspaceDownloadRoutes(app, fakeDeps);
});

afterEach(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("GET /api/instances/:slug/workspace/download", () => {
  it("returns 400 when path query param is missing", async () => {
    const res = await request("/api/instances/test/workspace/download");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("MISSING_PATH");
  });

  it("returns 404 when the file does not exist", async () => {
    const target = path.join(stateDir, "ghost.txt");
    const res = await request(
      `/api/instances/test/workspace/download?path=${encodeURIComponent(target)}`,
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("FILE_NOT_FOUND");
  });

  it("returns 403 when the path resolves outside the instance state_dir", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cp-outside-"));
    const target = path.join(outside, "secret.txt");
    await fs.writeFile(target, "nope");
    try {
      const res = await request(
        `/api/instances/test/workspace/download?path=${encodeURIComponent(target)}`,
      );
      expect(res.status).toBe(403);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("FORBIDDEN");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 400 when the path is a directory, not a file", async () => {
    const subdir = path.join(stateDir, "subdir");
    await fs.mkdir(subdir);
    const res = await request(
      `/api/instances/test/workspace/download?path=${encodeURIComponent(subdir)}`,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("NOT_A_FILE");
  });

  it("serves file content with correct headers on success", async () => {
    const file = path.join(stateDir, "hello.txt");
    await fs.writeFile(file, "hello world");
    const res = await request(
      `/api/instances/test/workspace/download?path=${encodeURIComponent(file)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="hello.txt"');
    expect(res.headers.get("content-length")).toBe("11");
    const body = await res.text();
    expect(body).toBe("hello world");
  });

  it("escapes double quotes in content-disposition filename", async () => {
    const file = path.join(stateDir, 'a"b.txt');
    await fs.writeFile(file, "x");
    const res = await request(
      `/api/instances/test/workspace/download?path=${encodeURIComponent(file)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="a\\"b.txt"');
  });

  it("resolves symlinks before traversal check (blocks symlink escape)", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cp-escape-"));
    const secret = path.join(outside, "secret.txt");
    await fs.writeFile(secret, "classified");
    const link = path.join(stateDir, "escape.txt");
    await fs.symlink(secret, link);
    try {
      const res = await request(
        `/api/instances/test/workspace/download?path=${encodeURIComponent(link)}`,
      );
      expect(res.status).toBe(403);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
