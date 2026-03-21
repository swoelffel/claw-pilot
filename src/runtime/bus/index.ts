/**
 * runtime/bus/index.ts
 *
 * Instance-scoped pub/sub event bus for claw-runtime.
 *
 * Design:
 * - Each runtime instance gets its own Bus (scoped by InstanceSlug)
 * - Type-safe publish/subscribe via EventDef
 * - Wildcard subscription for all events (used by plugins, dashboard WS)
 * - Synchronous delivery (no async queuing) — handlers must not throw
 * - Disposal cleans up all subscriptions
 */

import type { InstanceSlug } from "../types.js";
import type { EventDef, AnyEvent } from "./events.js";
import { logger } from "../../lib/logger.js";

export type { EventDef, AnyEvent };
export * from "./events.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Unsubscribe = () => void;

type Handler<P> = (payload: P) => void;

type WildcardHandler = (event: AnyEvent) => void;

// ---------------------------------------------------------------------------
// Bus class
// ---------------------------------------------------------------------------

export class Bus {
  private readonly _slug: InstanceSlug;
  private readonly _subs = new Map<string, Set<Handler<unknown>>>();
  private readonly _wildcards = new Set<WildcardHandler>();
  private _disposed = false;

  constructor(slug: InstanceSlug) {
    this._slug = slug;
  }

  get slug(): InstanceSlug {
    return this._slug;
  }

  /**
   * Publish a typed event to all subscribers.
   * Silently ignored after disposal.
   */
  publish<T extends string, P>(def: EventDef<T, P>, payload: P): void {
    if (this._disposed) return;

    const handlers = this._subs.get(def.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          // Handlers must not throw — log and continue
          logger.error(`[Bus:${this._slug}] Handler error for "${def.type}": ${err}`);
        }
      }
    }

    // Wildcard subscribers receive all events
    if (this._wildcards.size > 0) {
      const event = { type: def.type, payload } as AnyEvent;
      for (const handler of this._wildcards) {
        try {
          handler(event);
        } catch (err) {
          logger.error(`[Bus:${this._slug}] Wildcard handler error: ${err}`);
        }
      }
    }
  }

  /**
   * Subscribe to a specific typed event.
   * Returns an unsubscribe function.
   */
  subscribe<T extends string, P>(def: EventDef<T, P>, handler: Handler<P>): Unsubscribe {
    if (this._disposed) return () => {};

    let set = this._subs.get(def.type);
    if (!set) {
      set = new Set();
      this._subs.set(def.type, set);
    }
    set.add(handler as Handler<unknown>);

    return () => {
      set?.delete(handler as Handler<unknown>);
    };
  }

  /**
   * Subscribe to all events (wildcard).
   * Returns an unsubscribe function.
   */
  subscribeAll(handler: WildcardHandler): Unsubscribe {
    if (this._disposed) return () => {};
    this._wildcards.add(handler);
    return () => {
      this._wildcards.delete(handler);
    };
  }

  /**
   * Subscribe until the handler returns "done".
   * Automatically unsubscribes after the first matching call that returns "done".
   */
  once<T extends string, P>(
    def: EventDef<T, P>,
    handler: (payload: P) => "done" | void,
  ): Unsubscribe {
    const unsub = this.subscribe(def, (payload) => {
      const result = handler(payload);
      if (result === "done") unsub();
    });
    return unsub;
  }

  /**
   * Dispose the bus — clears all subscriptions.
   * After disposal, publish() is a no-op and subscribe() returns a no-op.
   */
  dispose(): void {
    this._disposed = true;
    this._subs.clear();
    this._wildcards.clear();
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

// ---------------------------------------------------------------------------
// Bus registry — one Bus per instance slug
// ---------------------------------------------------------------------------

const _registry = new Map<InstanceSlug, Bus>();

/**
 * Get or create the Bus for a given instance slug.
 */
export function getBus(slug: InstanceSlug): Bus {
  let bus = _registry.get(slug);
  if (!bus) {
    bus = new Bus(slug);
    _registry.set(slug, bus);
  }
  return bus;
}

/**
 * Dispose and remove the Bus for a given instance slug.
 * Called when the runtime instance is stopped.
 */
export function disposeBus(slug: InstanceSlug): void {
  const bus = _registry.get(slug);
  if (bus) {
    bus.dispose();
    _registry.delete(slug);
  }
}

/**
 * Check if a Bus exists for a given slug.
 */
export function hasBus(slug: InstanceSlug): boolean {
  return _registry.has(slug);
}
