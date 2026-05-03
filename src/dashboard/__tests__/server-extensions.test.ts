// src/dashboard/__tests__/server-extensions.test.ts
import { Hono } from "hono";
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearServerExtensions,
  getRegisteredServerExtensions,
  registerServerExtension,
  type ServerExtension,
} from "../server-extensions.js";
import type { RouteDeps } from "../route-deps.js";

const stubDeps = {} as unknown as RouteDeps;

describe("server-extensions registry", () => {
  beforeEach(() => {
    clearServerExtensions();
  });

  it("starts empty in a fresh state", () => {
    expect(getRegisteredServerExtensions()).toEqual([]);
  });

  it("preserves registration order", () => {
    const a: ServerExtension = () => {};
    const b: ServerExtension = () => {};
    const c: ServerExtension = () => {};
    registerServerExtension(a);
    registerServerExtension(b);
    registerServerExtension(c);
    expect(getRegisteredServerExtensions()).toEqual([a, b, c]);
  });

  it("deduplicates identical callbacks (idempotent registration)", () => {
    const ext: ServerExtension = () => {};
    registerServerExtension(ext);
    registerServerExtension(ext);
    registerServerExtension(ext);
    expect(getRegisteredServerExtensions()).toEqual([ext]);
  });

  it("returns a snapshot — mutating the result does not corrupt the registry", () => {
    const ext: ServerExtension = () => {};
    registerServerExtension(ext);
    const snapshot = getRegisteredServerExtensions() as ServerExtension[];
    snapshot.push(() => {});
    expect(getRegisteredServerExtensions()).toEqual([ext]);
  });

  it("clearServerExtensions resets the registry", () => {
    registerServerExtension(() => {});
    registerServerExtension(() => {});
    expect(getRegisteredServerExtensions()).toHaveLength(2);
    clearServerExtensions();
    expect(getRegisteredServerExtensions()).toEqual([]);
  });

  it("invocation contract: each extension receives the same deps + app instances", async () => {
    const app = new Hono();
    const seenDeps: RouteDeps[] = [];
    const seenApps: Hono[] = [];

    registerServerExtension((deps, hostApp) => {
      seenDeps.push(deps);
      seenApps.push(hostApp);
    });
    registerServerExtension(async (deps, hostApp) => {
      // Async extension is awaited.
      await Promise.resolve();
      seenDeps.push(deps);
      seenApps.push(hostApp);
    });

    for (const ext of getRegisteredServerExtensions()) {
      await ext(stubDeps, app);
    }

    expect(seenDeps).toEqual([stubDeps, stubDeps]);
    expect(seenApps).toEqual([app, app]);
  });
});
