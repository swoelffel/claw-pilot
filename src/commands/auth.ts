import { Command } from "commander";
import { withContext } from "./_context.js";
import { hashPassword, generatePassword } from "../core/auth.js";
import { SessionStore } from "../dashboard/session-store.js";
import { constants } from "../lib/constants.js";

export function authCommand(): Command {
  const cmd = new Command("auth").description("Manage dashboard authentication");

  cmd.addCommand(setupCommand());
  cmd.addCommand(resetCommand());
  cmd.addCommand(checkCommand());

  return cmd;
}

// Shared logic for setup and reset
async function runSetup(): Promise<void> {
  await withContext(async ({ db }) => {
    const password = generatePassword();
    const hash = await hashPassword(password);

    // UPSERT admin user
    db.prepare(`
      INSERT INTO users (username, password_hash, role)
      VALUES (?, ?, 'admin')
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        updated_at = datetime('now')
    `).run(constants.ADMIN_USERNAME, hash);

    // Get user ID for session cleanup
    const user = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(constants.ADMIN_USERNAME) as { id: number };

    // Invalidate all existing sessions
    const sessionStore = new SessionStore(db);
    sessionStore.deleteAllForUser(user.id);

    displayPasswordBox(password);
  });
}

function setupCommand(): Command {
  return new Command("setup")
    .description("Create or reset the admin account")
    .action(async () => {
      await runSetup();
    });
}

function resetCommand(): Command {
  return new Command("reset")
    .description("Reset the admin password (alias for setup)")
    .action(async () => {
      await runSetup();
    });
}

function checkCommand(): Command {
  return new Command("check")
    .description("Exit 0 if admin exists, 1 otherwise (silent)")
    .action(async () => {
      await withContext(async ({ db }) => {
        const exists = db
          .prepare("SELECT 1 FROM users WHERE username = ? LIMIT 1")
          .get(constants.ADMIN_USERNAME);

        if (!exists) {
          process.exit(1);
        }
        // exit 0 implicit
      });
    });
}

function displayPasswordBox(password: string): void {
  const border = "─".repeat(51);
  console.log(`┌${border}┐`);
  console.log(`│  Admin account ready                              │`);
  console.log(`│                                                   │`);
  console.log(`│  Username : admin                                 │`);
  console.log(`│  Password : ${password.padEnd(38)}│`);
  console.log(`│                                                   │`);
  console.log(`│  Save this password — it won't be shown again.   │`);
  console.log(`│  Reset anytime: claw-pilot auth reset             │`);
  console.log(`└${border}┘`);
}
