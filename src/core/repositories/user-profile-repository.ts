// src/core/repositories/user-profile-repository.ts
//
// CRUD operations for user_profiles and user_providers tables.

import type Database from "better-sqlite3";
import type { UserProfileRecord, UserProviderRecord } from "../registry-types.js";

// ---------------------------------------------------------------------------
// Input types for upsert operations
// ---------------------------------------------------------------------------

export interface UserProfileUpsertData {
  display_name?: string | null;
  language?: string;
  timezone?: string | null;
  communication_style?: "concise" | "detailed" | "technical";
  custom_instructions?: string | null;
  default_model?: string | null;
  avatar_url?: string | null;
  /** Raw JSON string for ui_preferences */
  ui_preferences?: string | null;
}

export interface UserProviderUpsertData {
  provider_id: string;
  api_key_env_var: string;
  base_url?: string | null;
  priority?: number;
  /** Raw JSON string for headers */
  headers?: string | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class UserProfileRepository {
  constructor(private db: Database.Database) {}

  // --- Profile ---

  getProfile(userId: number): UserProfileRecord | undefined {
    return this.db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
      | UserProfileRecord
      | undefined;
  }

  /** Single-user helper: get the first admin user's profile */
  getAdminProfile(): UserProfileRecord | undefined {
    return this.db
      .prepare(
        `SELECT p.* FROM user_profiles p
         JOIN users u ON u.id = p.user_id
         WHERE u.role = 'admin'
         LIMIT 1`,
      )
      .get() as UserProfileRecord | undefined;
  }

  upsertProfile(userId: number, data: UserProfileUpsertData): UserProfileRecord {
    const existing = this.getProfile(userId);

    if (existing) {
      // Build SET clause dynamically from provided fields
      const sets: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          sets.push(`${key} = ?`);
          values.push(value);
        }
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(userId);
        this.db
          .prepare(`UPDATE user_profiles SET ${sets.join(", ")} WHERE user_id = ?`)
          .run(...values);
      }
    } else {
      // Insert new profile
      const columns = ["user_id"];
      const placeholders = ["?"];
      const values: unknown[] = [userId];

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          columns.push(key);
          placeholders.push("?");
          values.push(value);
        }
      }

      this.db
        .prepare(
          `INSERT INTO user_profiles (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
        )
        .run(...values);
    }

    return this.getProfile(userId)!;
  }

  // --- Providers ---

  getProviders(userId: number): UserProviderRecord[] {
    return this.db
      .prepare("SELECT * FROM user_providers WHERE user_id = ? ORDER BY priority ASC")
      .all(userId) as UserProviderRecord[];
  }

  upsertProvider(userId: number, data: UserProviderUpsertData): void {
    this.db
      .prepare(
        `INSERT INTO user_providers (user_id, provider_id, api_key_env_var, base_url, priority, headers, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, provider_id) DO UPDATE SET
           api_key_env_var = excluded.api_key_env_var,
           base_url = excluded.base_url,
           priority = excluded.priority,
           headers = excluded.headers,
           updated_at = datetime('now')`,
      )
      .run(
        userId,
        data.provider_id,
        data.api_key_env_var,
        data.base_url ?? null,
        data.priority ?? 0,
        data.headers ?? null,
      );
  }

  removeProvider(userId: number, providerId: string): void {
    this.db
      .prepare("DELETE FROM user_providers WHERE user_id = ? AND provider_id = ?")
      .run(userId, providerId);
  }
}
