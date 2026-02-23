// src/server/local.ts
import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ServerConnection, ExecResult, ExecOptions } from "./connection.js";

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
    return fs.readFile(filePath, "utf-8");
  }

  async writeFile(
    filePath: string,
    content: string,
    mode?: number,
  ): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, { mode: mode ?? 0o644 });
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

  async hostname(): Promise<string> {
    return os.hostname();
  }

  async platform(): Promise<string> {
    return os.platform();
  }
}
