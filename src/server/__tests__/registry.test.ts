import { afterEach, describe, expect, it } from "vitest";
import {
  registerServerRegistry,
  resetServerRegistry,
  getServerRegistry,
  serverRegistry,
  SingleServerRegistry,
  type ServerRegistry,
  type ServerNode,
} from "../registry.js";
import { ClawPilotError } from "../../lib/errors.js";
import type { ServerConnection } from "../connection.js";
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { LocalConnection } from "../local.js";

function makeBootstrappedDb() {
  const db = initDatabase(":memory:");
  new Registry(db).upsertLocalServer("testhost", "/tmp/home");
  return db;
}

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
    const impl = new SingleServerRegistry(makeBootstrappedDb(), new LocalConnection());
    registerServerRegistry(impl);
    expect(getServerRegistry().getLocal().hostname).toBe("testhost");
    let caught: unknown;
    try {
      registerServerRegistry(impl);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClawPilotError);
    expect((caught as ClawPilotError).code).toBe("SERVER_REGISTRY_LOCKED");
  });

  it("proxy delegates to registered impl", () => {
    const impl = new SingleServerRegistry(makeBootstrappedDb(), new LocalConnection());
    registerServerRegistry(impl);
    expect(serverRegistry.getLocal().kind).toBe("local");
    expect(serverRegistry.route({ kind: "instance", id: "foo" }).kind).toBe("local");
    expect(serverRegistry.list()).toHaveLength(1);
    expect(serverRegistry.get("1")).not.toBeNull();
    expect(serverRegistry.get("nope")).toBeNull();
  });
});

describe("SingleServerRegistry", () => {
  afterEach(() => resetServerRegistry());

  it("reads local server row from DB at construction", () => {
    const db = makeBootstrappedDb();
    const reg = new SingleServerRegistry(db, new LocalConnection());
    const local = reg.getLocal();
    expect(local.kind).toBe("local");
    expect(local.hostname).toBe("testhost");
    expect(local.id).toBe("1");
  });

  it("throws SERVER_REGISTRY_NOT_BOOTSTRAPPED when servers row absent", () => {
    const db = initDatabase(":memory:");
    let caught: unknown;
    try {
      new SingleServerRegistry(db, new LocalConnection());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClawPilotError);
    expect((caught as ClawPilotError).code).toBe("SERVER_REGISTRY_NOT_BOOTSTRAPPED");
  });

  it("list/get/route all resolve to the local node", () => {
    const db = makeBootstrappedDb();
    const reg = new SingleServerRegistry(db, new LocalConnection());
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("1")).not.toBeNull();
    expect(reg.get("999")).toBeNull();
    const routed = reg.route({ kind: "instance", id: "whatever" });
    expect(routed.kind).toBe("local");
  });
});

describe("capability gate on registerServerRegistry", () => {
  afterEach(() => resetServerRegistry());

  const fakeNode: ServerNode = {
    id: "1",
    kind: "local",
    hostname: "test-host",
    connection: {} as unknown as ServerConnection,
  };

  it("allows SingleServerRegistry without multi-server capability", () => {
    const db = makeBootstrappedDb();
    expect(() =>
      registerServerRegistry(new SingleServerRegistry(db, new LocalConnection())),
    ).not.toThrow();
  });

  it("rejects foreign impl when multi-server capability is disabled", () => {
    const foreign: ServerRegistry = {
      list: () => [fakeNode],
      get: () => fakeNode,
      getLocal: () => fakeNode,
      route: () => fakeNode,
    };
    let caught: unknown;
    try {
      registerServerRegistry(foreign);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ClawPilotError);
    expect((caught as ClawPilotError).code).toBe("MULTI_SERVER_CAPABILITY_REQUIRED");
  });
});
