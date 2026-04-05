/**
 * lib/__tests__/log-rotate.test.ts
 *
 * Unit tests for size-based log rotation.
 * Uses real filesystem via temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rotateLogs } from "../log-rotate.js";

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-pilot-log-rotate-test-"));
  logPath = path.join(tmpDir, "runtime.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a file of a given size in bytes. */
function writeSize(filePath: string, sizeBytes: number): void {
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, "x"));
}

describe("rotateLogs", () => {
  it("does nothing when log file does not exist", () => {
    rotateLogs(logPath, 1, 3);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("does nothing when log file is under maxSizeMb", () => {
    writeSize(logPath, 500); // 500 bytes, well under 1 MB
    rotateLogs(logPath, 1, 3);
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
  });

  it("rotates when log file exceeds maxSizeMb", () => {
    writeSize(logPath, 1.5 * 1024 * 1024); // 1.5 MB > 1 MB
    rotateLogs(logPath, 1, 3);
    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
  });

  it("shifts existing archives up by one index", () => {
    writeSize(`${logPath}.1`, 100);
    writeSize(logPath, 2 * 1024 * 1024);
    rotateLogs(logPath, 1, 3);
    // .1 shifted to .2, current moved to .1
    expect(fs.existsSync(`${logPath}.2`)).toBe(true);
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("cascades multiple archives correctly", () => {
    writeSize(`${logPath}.1`, 100);
    writeSize(`${logPath}.2`, 200);
    writeSize(logPath, 2 * 1024 * 1024);
    rotateLogs(logPath, 1, 3);
    // .2 → .3, .1 → .2, current → .1
    expect(fs.existsSync(`${logPath}.3`)).toBe(true);
    expect(fs.existsSync(`${logPath}.2`)).toBe(true);
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("drops oldest archive beyond maxFiles", () => {
    writeSize(`${logPath}.1`, 100);
    writeSize(`${logPath}.2`, 200);
    writeSize(logPath, 2 * 1024 * 1024);
    rotateLogs(logPath, 1, 2);
    // maxFiles=2: .1 → .2 (overwriting old .2), current → .1
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
    expect(fs.existsSync(`${logPath}.2`)).toBe(true);
    expect(fs.existsSync(logPath)).toBe(false);
  });
});
