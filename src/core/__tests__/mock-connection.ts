// src/core/__tests__/mock-connection.ts
import type {
  ServerConnection,
  ExecResult,
  ExecOptions,
} from "../../server/connection.js";

export class MockConnection implements ServerConnection {
  public commands: string[] = [];
  public files: Map<string, string> = new Map();
  public dirs: Set<string> = new Set();
  public execResponses: Map<string, ExecResult> = new Map();

  /** Set a custom response for a specific command pattern */
  mockExec(pattern: string, result: ExecResult): void {
    this.execResponses.set(pattern, result);
  }

  async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
    this.commands.push(command);
    // Check for pattern matches
    for (const [pattern, result] of this.execResponses) {
      if (command.includes(pattern)) return result;
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    // Reconstruct a command string for pattern matching (same as exec).
    // Prepend env vars so tests that check for XDG_RUNTIME_DIR= still pass.
    const envPrefix = options?.env
      ? Object.entries(options.env)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ") + " "
      : "";
    const command = envPrefix + [file, ...args].join(" ");
    this.commands.push(command);
    for (const [pattern, result] of this.execResponses) {
      if (command.includes(pattern)) return result;
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string, _mode?: number): Promise<void> {
    this.files.set(path, content);
  }

  async mkdir(path: string, _options?: { mode?: number }): Promise<void> {
    this.dirs.add(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async remove(path: string, _options?: { recursive?: boolean }): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
    // Also remove sub-paths for recursive
    for (const key of this.files.keys()) {
      if (key.startsWith(path + "/")) this.files.delete(key);
    }
  }

  async chmod(_path: string, _mode: number): Promise<void> {}

  async readdir(path: string): Promise<string[]> {
    const results: string[] = [];
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length);
        const segment = relative.split("/")[0];
        if (segment && !results.includes(segment)) {
          results.push(segment);
        }
      }
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const relative = dir.slice(prefix.length);
        const segment = relative.split("/")[0];
        if (segment && !results.includes(segment)) {
          results.push(segment);
        }
      }
    }
    return results;
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = this.files.get(src);
    if (content === undefined) throw new Error(`Source not found: ${src}`);
    this.files.set(dest, content);
  }

  async hostname(): Promise<string> {
    return "test-host";
  }

  async platform(): Promise<string> {
    return "linux";
  }
}
