// src/core/devices.ts
//
// Types for OpenClaw device pairing (pending requests + paired devices).

export interface PendingDevice {
  requestId: string;
  deviceId: string;
  publicKey: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  ts: number;
}

export interface PairedDevice {
  deviceId: string;
  publicKey: string;
  platform: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  tokens: Record<string, { token: string; createdAtMs: number; lastUsedAtMs?: number }>;
  createdAtMs: number;
  approvedAtMs: number;
}

export interface DeviceList {
  pending: PendingDevice[];
  paired: PairedDevice[];
}
