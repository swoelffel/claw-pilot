// src/core/repositories/event-repository.ts
import type Database from "better-sqlite3";
import { now } from "../../lib/date.js";

export interface EventRecord {
  id: number;
  instance_slug: string | null;
  event_type: string;
  detail: string | null;
  created_at: string;
}

export class EventRepository {
  constructor(private db: Database.Database) {}

  logEvent(instanceSlug: string | null, eventType: string, detail?: string): void {
    this.db
      .prepare(
        "INSERT INTO events (instance_slug, event_type, detail, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(instanceSlug, eventType, detail ?? null, now());
  }

  listEvents(instanceSlug?: string, limit = 50): EventRecord[] {
    if (instanceSlug) {
      return this.db
        .prepare("SELECT * FROM events WHERE instance_slug = ? ORDER BY created_at DESC LIMIT ?")
        .all(instanceSlug, limit) as EventRecord[];
    }
    return this.db
      .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?")
      .all(limit) as EventRecord[];
  }
}
