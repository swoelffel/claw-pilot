/**
 * ui/src/services/update-poller.ts
 *
 * Self-update polling service for the claw-pilot dashboard.
 * Extracted from app.ts to keep the root component focused on rendering.
 */

import type { SelfUpdateStatus } from "../types.js";
import { getToken } from "./auth-state.js";

const POLL_INTERVAL_MS = 60_000;
const FAST_POLL_MS = 3_000;
const RELOAD_DELAY_MS = 2_000;

export class UpdatePoller {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _status: SelfUpdateStatus | null = null;

  constructor(private readonly _onChange: (status: SelfUpdateStatus | null) => void) {}

  get status(): SelfUpdateStatus | null {
    return this._status;
  }

  start(): void {
    void this._poll();
    this._timer = setInterval(() => {
      void this._poll();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async triggerUpdate(): Promise<void> {
    const token = getToken();
    try {
      const res = await fetch("/api/self/update", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      // Refresh immediately to show "running" state
      void this._poll();
    } catch {
      // Silent — server may be restarting
    }
  }

  private async _poll(): Promise<void> {
    const token = getToken();
    try {
      const res = await fetch("/api/self/update-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as SelfUpdateStatus;
      const wasRunning = this._status?.status === "running";
      this._status = data;
      this._onChange(data);

      // If a job is running, accelerate polling
      if (data.status === "running") {
        setTimeout(() => {
          void this._poll();
        }, FAST_POLL_MS);
      }

      // If job just finished, reload to pick up the new bundle
      if (wasRunning && data.status === "done") {
        setTimeout(() => {
          location.reload();
        }, RELOAD_DELAY_MS);
      }
    } catch {
      // Silent — server may be restarting
    }
  }
}
