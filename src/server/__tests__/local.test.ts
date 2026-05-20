import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as os from "node:os";
import * as path from "node:path";
import { LocalConnection } from "../local.js";

let tempDir: string;
let conn: LocalConnection;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "local-test-"));
  conn = new LocalConnection();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("LocalConnection", () => {
  describe("exec()", () => {
    it("runs a command and returns stdout", async () => {
      const result = await conn.exec("echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });

    it("returns exitCode 1 for failing commands", async () => {
      const result = await conn.exec("exit 1");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("execFile()", () => {
    // echo is a shell builtin on Windows, not a standalone executable
    it.skipIf(process.platform === "win32")("runs file with args", async () => {
      const result = await conn.execFile("echo", ["foo", "bar"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("foo bar");
    });
  });

  describe("readFile()", () => {
    it("reads file contents", async () => {
      const filePath = path.join(tempDir, "read-me.txt");
      await writeFile(filePath, "test content", "utf-8");

      const content = await conn.readFile(filePath);
      expect(content).toBe("test content");
    });
  });

  describe("writeFile()", () => {
    it("creates file with content", async () => {
      const filePath = path.join(tempDir, "write-me.txt");
      await conn.writeFile(filePath, "hello world");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });

    it("creates parent directories", async () => {
      const filePath = path.join(tempDir, "nested", "deep", "file.txt");
      await conn.writeFile(filePath, "nested content");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("nested content");
    });
  });

  describe("mkdir()", () => {
    it("creates directory recursively", async () => {
      const dirPath = path.join(tempDir, "a", "b", "c");
      await conn.mkdir(dirPath);

      const exists = await conn.exists(dirPath);
      expect(exists).toBe(true);
    });
  });

  describe("exists()", () => {
    it("returns true for existing path", async () => {
      const filePath = path.join(tempDir, "exists.txt");
      await writeFile(filePath, "yes");

      expect(await conn.exists(filePath)).toBe(true);
    });

    it("returns false for non-existing path", async () => {
      expect(await conn.exists(path.join(tempDir, "nope.txt"))).toBe(false);
    });
  });

  describe("remove()", () => {
    it("deletes a file", async () => {
      const filePath = path.join(tempDir, "delete-me.txt");
      await writeFile(filePath, "bye");

      await conn.remove(filePath);

      expect(await conn.exists(filePath)).toBe(false);
    });
  });

  describe("readdir()", () => {
    it("lists directory entries", async () => {
      await writeFile(path.join(tempDir, "a.txt"), "");
      await writeFile(path.join(tempDir, "b.txt"), "");

      const entries = await conn.readdir(tempDir);
      expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
    });
  });

  describe("copyFile()", () => {
    it("copies a file to destination", async () => {
      const src = path.join(tempDir, "src.txt");
      const dest = path.join(tempDir, "dest.txt");
      await writeFile(src, "copy me");

      await conn.copyFile(src, dest);

      const content = await readFile(dest, "utf-8");
      expect(content).toBe("copy me");
    });
  });

  describe("rename()", () => {
    it("renames a file", async () => {
      const src = path.join(tempDir, "old.txt");
      const dst = path.join(tempDir, "new.txt");
      await writeFile(src, "moved");

      await conn.rename(src, dst);

      expect(await conn.exists(src)).toBe(false);
      expect(await readFile(dst, "utf-8")).toBe("moved");
    });
  });

  describe("hostname()", () => {
    it("returns a string", async () => {
      const name = await conn.hostname();
      expect(typeof name).toBe("string");
      expect(name).toBe(os.hostname());
    });
  });

  describe("platform()", () => {
    it("returns os.platform()", async () => {
      const plat = await conn.platform();
      expect(plat).toBe(os.platform());
    });
  });
});
