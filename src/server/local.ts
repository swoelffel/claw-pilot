// src/server/local.ts
import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ServerConnection, ExecResult, ExecOptions } from "./connection.js";

const isLinux = os.platform() === "linux";

const execAsync = promisify(execCb);

export class LocalConnection implements ServerConnection {
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout ?? 30_000,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: err.code ?? 1,
      };
    }
  }

  async execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      execFileCb(
        file,
        args,
        {
          cwd: options?.cwd,
          env: { ...process.env, ...options?.env },
          timeout: options?.timeout ?? 30_000,
        },
        (err, stdout, stderr) => {
          if (err) {
            resolve({
              stdout: stdout ?? "",
              stderr: stderr ?? (err.message ?? ""),
              exitCode: (err as NodeJS.ErrnoException & { code?: number }).code ?? 1,
            });
          } else {
            resolve({ stdout, stderr, exitCode: 0 });
          }
        },
      );
    });
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (err) {
      // On Linux, fall back to `sudo cat` for files owned by another user
      // (e.g. openclaw instance configs in /opt/openclaw/.openclaw-*/openclaw.json).
      // Only retry on permission errors — propagate all other failures as-is.
      if (isLinux) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          const result = await this.exec(`sudo cat ${JSON.stringify(filePath)} 2>/dev/null`);
          if (result.exitCode === 0) return result.stdout;
        }
      }
      throw err;
    }
  }

  async writeFile(
    filePath: string,
    content: string,
    mode?: number,
  ): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, { mode: mode ?? 0o644 });
    } catch (err) {
      // On Linux, fall back to `sudo tee` for files owned by another user.
      // Content is base64-encoded to avoid shell escaping issues with JSON.
      if (isLinux) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          const encoded = Buffer.from(content).toString("base64");
          const result = await this.exec(
            `printf '%s' ${JSON.stringify(encoded)} | base64 -d | sudo tee ${JSON.stringify(filePath)} > /dev/null`,
          );
          if (result.exitCode === 0) return;
        }
      }
      throw err;
    }
  }

  async mkdir(dirPath: string, options?: { mode?: number }): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true, mode: options?.mode });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async remove(
    filePath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fs.rm(filePath, {
      recursive: options?.recursive ?? false,
      force: true,
    });
  }

  async chmod(filePath: string, mode: number): Promise<void> {
    await fs.chmod(filePath, mode);
  }

  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(src, dest);
  }

  async rename(src: string, dst: string): Promise<void> {
    await fs.rename(src, dst);
  }

  async hostname(): Promise<string> {
    return os.hostname();
  }

  async platform(): Promise<string> {
    return os.platform();
  }
}
