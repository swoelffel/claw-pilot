// src/lib/notification-bridge.ts
//
// Lightweight bridge between runtime engines and the dashboard WS broadcaster.
// Avoids circular dependency: engine.ts → dashboard/monitor.ts → runtime/index.ts.

/** Global callback set by dashboard server, invoked by each engine's notification emitter. */
let _onNewNotification: ((row: unknown) => void) | null = null;

/** Set the global notification broadcaster. Called once during dashboard server setup. */
export function setNotificationBroadcaster(fn: (row: unknown) => void): void {
  _onNewNotification = fn;
}

/** Forward a notification from any engine to the WS broadcaster. */
export function notifyNewNotification(row: unknown): void {
  _onNewNotification?.(row);
}
