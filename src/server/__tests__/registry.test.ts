import { afterEach, describe, expect, it } from "vitest";
import {
  registerServerRegistry,
  resetServerRegistry,
  getServerRegistry,
  serverRegistry,
  type ServerRegistry,
  type ServerNode,
} from "../registry.js";
import { ClawPilotError } from "../../lib/errors.js";
import type { ServerConnection } from "../connection.js";

const fakeNode: ServerNode = {
  id: "1",
  kind: "local",
  hostname: "test-host",
  connection: {} as unknown as ServerConnection,
};

const fakeImpl: ServerRegistry = {
  list: () => [fakeNode],
  get: (id) => (id === "1" ? fakeNode : null),
  getLocal: () => fakeNode,
  route: () => fakeNode,
};

describe("serverRegistry singleton", () => {
  afterEach(() => resetServerRegistry());

  it("throws before bootstrap", () => {
    let caught: unknown;
    try {
      getServerRegistry();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClawPilotError);
    expect((caught as ClawPilotError).code).toBe("SERVER_REGISTRY_NOT_REGISTERED");
  });

  it("locks after first registration", () => {
    registerServerRegistry(fakeImpl);
    expect(getServerRegistry().getLocal().hostname).toBe("test-host");
    let caught: unknown;
    try {
      registerServerRegistry(fakeImpl);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClawPilotError);
    expect((caught as ClawPilotError).code).toBe("SERVER_REGISTRY_LOCKED");
  });

  it("proxy delegates to registered impl", () => {
    registerServerRegistry(fakeImpl);
    expect(serverRegistry.getLocal()).toBe(fakeNode);
    expect(serverRegistry.route({ kind: "instance", id: "foo" })).toBe(fakeNode);
    expect(serverRegistry.list()).toEqual([fakeNode]);
    expect(serverRegistry.get("1")).toBe(fakeNode);
    expect(serverRegistry.get("nope")).toBeNull();
  });
});
