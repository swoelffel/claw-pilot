import { afterEach, describe, expect, it } from "vitest";
import {
  registerServerRegistry,
  resetServerRegistry,
  getServerRegistry,
  serverRegistry,
  type ServerRegistry,
  type ServerNode,
} from "../registry.js";

const fakeNode: ServerNode = {
  id: "1",
  kind: "local",
  hostname: "test-host",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: {} as any,
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
    expect(() => getServerRegistry()).toThrow(/not.*registered/i);
  });

  it("locks after first registration", () => {
    registerServerRegistry(fakeImpl);
    expect(getServerRegistry().getLocal().hostname).toBe("test-host");
    expect(() => registerServerRegistry(fakeImpl)).toThrow(/locked/i);
  });

  it("proxy delegates to registered impl", () => {
    registerServerRegistry(fakeImpl);
    expect(serverRegistry.getLocal()).toBe(fakeNode);
    expect(serverRegistry.route({ kind: "instance", id: "foo" })).toBe(fakeNode);
  });
});
