# Server Registry

> Part of [claw-pilot Functional Architecture](README.md)

---

## Purpose

The `ServerRegistry` is the **single entry point** for answering "which server
node serves which resource?" in claw-pilot.

In Community edition the answer is always "the local machine" — there is one
server, and every resource lives on it. The abstraction exists solely to remain
forward-compatible with an Enterprise `FederatedServerRegistry` that routes
resources across a cluster of claw-pilot nodes. Keeping the indirection in
Community means the Enterprise fork can inject its implementation **without
touching any frozen-path source file**.

## Module

`src/server/registry.ts` — single file.

## Contract

### Types

```typescript
export type ServerKind = "local" | "remote";

export interface ServerNode {
  id: string;          // UUID — matches `servers.id` in registry.db
  kind: ServerKind;
  host: string;        // hostname or IP
  port: number;        // dashboard HTTP port
}

export interface ResourceRef {
  kind: string;        // e.g. "agent", "workspace", "session"
  id:   string;        // resource UUID
}

export interface ServerRegistry {
  list(): Promise<ServerNode[]>;
  get(id: string): Promise<ServerNode | undefined>;
  route(ref: ResourceRef): Promise<ServerNode>;
}
```

### Exports

| Symbol | Description |
|---|---|
| `ServerKind` | Discriminated union `"local" \| "remote"` |
| `ServerNode` | Descriptor for one claw-pilot node |
| `ResourceRef` | Lightweight pointer to a typed resource |
| `ServerRegistry` | Interface all implementations must satisfy |
| `registerServerRegistry(impl)` | Bootstrap setter — replaces the default singleton |
| `bootstrapServerRegistry()` | Reads `servers` row id=1 and wires `SingleServerRegistry` |
| `getServerRegistry()` | Returns the live singleton (throws if not yet bootstrapped) |
| `serverRegistry` | Proxy singleton — import this in consumer code |
| `SingleServerRegistry` | Default Community implementation (always local) |
| `SINGLE_SERVER_BRAND` | Symbol used to brand-check `SingleServerRegistry` instances |
| `resetServerRegistry` | **Test-only** — resets the singleton to uninitialized state |

## Default implementation

`SingleServerRegistry` covers the entire Community lifecycle:

1. `bootstrapServerRegistry()` calls `Registry.upsertLocalServer()`, which
   inserts or updates the `servers` row with `id = 1` representing the local
   machine.
2. `SingleServerRegistry` is instantiated with that row's data.
3. `list()` returns `[localNode]`.
4. `get(id)` returns `localNode` when `id === localNode.id`, otherwise
   `undefined`.
5. `route(ref)` always returns `localNode`, regardless of `ref.kind` or
   `ref.id`.

There is no network call, no discovery, no hashing.

## Capability gate

`registerServerRegistry(impl)` enforces the following rule:

- If `impl` carries `SINGLE_SERVER_BRAND` (i.e. it is a `SingleServerRegistry`)
  → accepted unconditionally.
- Otherwise → `capabilities.require("multi-server")` is called first. Community
  returns `false` for `"multi-server"`, so any non-default impl raises
  `CapabilityNotAvailableError` at registration time rather than silently
  falling through.

This ensures discipline rule R1: no `if (isEnterprise)` anywhere; the gate is
purely capability-driven.

## Bootstrap sites

`bootstrapServerRegistry()` is called at three entry points:

| Call site | Notes |
|---|---|
| `src/commands/_context.ts` via `withContext(fn)` | Wraps every CLI command that needs a DB context; this is the primary path. |
| `src/commands/dashboard.ts` | Explicit call before starting the HTTP server. |
| `src/commands/init.ts` | Called after `Registry.upsertLocalServer()` so that the local server row exists before bootstrap reads it. |

**Pre-bootstrap exception**: `src/commands/update.ts` does not call
`bootstrapServerRegistry()` because the update command intentionally runs
outside a DB context (it may be replacing the binary). Any code path invoked
from `update.ts` must not call `getServerRegistry()`.

## Enterprise consumption (informative)

To plug a `FederatedServerRegistry` into a future Enterprise distribution:

1. Enable the `"multi-server"` capability via `setCapabilityRegistry(...)` (H5)
   **before** any command dispatches.
2. Instantiate `FederatedServerRegistry` with the cluster topology (e.g. loaded
   from `secretProvider.get("CP_CLUSTER_CONFIG")` — H4).
3. Call `registerServerRegistry(new FederatedServerRegistry(...))` at the top
   of the Enterprise `src/index.ts`, before `withContext` runs.

Possible route strategies (out of scope for Community):

- **Consistent hash ring** — shard by `ref.id` across nodes.
- **Explicit mapping table** — `resource_kind + id` → `server_id` stored in a
  dedicated table.
- **Geographic affinity** — route to the nearest node based on latency probes.

`FederatedServerRegistry` must not carry `SINGLE_SERVER_BRAND`; the capability
gate will enforce `"multi-server"` is active before accepting it.

## Discipline

- **R1** — The capability gate (`capabilities.require("multi-server")`) is the
  only differentiator. No `if (isEnterprise)` pattern anywhere in
  `src/server/registry.ts`.
- **R3** — `src/server/*` is a frozen path. Any commit that modifies it must
  carry the trailer:
  ```
  Extension-Point: server-registry
  ```
  This allows upstream merges into the Enterprise fork to remain byte-identical
  on this path.

## See also

- [Capability Registry](capability-registry.md) — H5, `capabilities.has(...)` contract
- Enterprise roadmap: `ai-docs/plan-enterprise-edition.md` (local)
