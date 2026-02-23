// src/lib/__tests__/xdg.test.ts
import { describe, it, expect } from "vitest";
import { resolveXdgRuntimeDir } from "../xdg.js";
import type { ServerConnection } from "../../server/connection.js";

function makeConn(stdout: string): ServerConnection {
  return {
    exec: async () => ({ stdout, stderr: "", exitCode: 0 }),
    execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    readFile: async () => "",
    writeFile: async () => {},
    mkdir: async () => {},
    exists: async () => false,
    remove: async () => {},
    chmod: async () => {},
    readdir: async () => [],
    copyFile: async () => {},
    hostname: async () => "localhost",
    platform: async () => "linux",
  };
}

describe("resolveXdgRuntimeDir", () => {
  it("returns /run/user/<uid> for a normal UID", async () => {
    const result = await resolveXdgRuntimeDir(makeConn("1000\n"));
    expect(result).toBe("/run/user/1000");
  });

  it("handles UID 996 (openclaw user)", async () => {
    const result = await resolveXdgRuntimeDir(makeConn("996\n"));
    expect(result).toBe("/run/user/996");
  });

  it("falls back to /run/user/1000 when output is not a number", async () => {
    const result = await resolveXdgRuntimeDir(makeConn("not-a-number\n"));
    expect(result).toBe("/run/user/1000");
  });

  it("falls back to /run/user/1000 when exec throws", async () => {
    const conn: ServerConnection = {
      exec: async () => { throw new Error("exec failed"); },
      execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      readFile: async () => "",
      writeFile: async () => {},
      mkdir: async () => {},
      exists: async () => false,
      remove: async () => {},
      chmod: async () => {},
      readdir: async () => [],
      copyFile: async () => {},
      hostname: async () => "localhost",
      platform: async () => "linux",
    };
    const result = await resolveXdgRuntimeDir(conn);
    expect(result).toBe("/run/user/1000");
  });

  it("falls back to /run/user/1000 when UID is 0 (root)", async () => {
    const result = await resolveXdgRuntimeDir(makeConn("0\n"));
    expect(result).toBe("/run/user/1000");
  });
});
