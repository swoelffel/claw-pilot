// src/core/repositories/user-profile-repository.ts
//
// CRUD operations for user_profiles and user_providers tables.

import type Database from "better-sqlite3";
import type { UserProfileRecord } from "../registry-types.js";

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
}
