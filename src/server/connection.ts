// src/server/connection.ts

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // ms, default 30_000
}

export interface ServerConnection {
  /** Execute a shell command */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** Execute a command with explicit args array (no shell interpolation) */
  execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult>;

  /** Read file contents as UTF-8 */
  readFile(path: string): Promise<string>;

  /** Write file contents (creates parent dirs if needed) */
  writeFile(path: string, content: string, mode?: number): Promise<void>;

  /** Create directory (recursive) */
  mkdir(path: string, options?: { mode?: number }): Promise<void>;

  /** Check if path exists */
  exists(path: string): Promise<boolean>;

  /** Remove file or directory */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Set permissions (chmod) */
  chmod(path: string, mode: number): Promise<void>;

  /** List directory contents */
  readdir(path: string): Promise<string[]>;

  /** Copy file */
  copyFile(src: string, dest: string): Promise<void>;

  /** Server info */
  hostname(): Promise<string>;
  platform(): Promise<string>;
}
