import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BashTool } from "../built-in/bash.js";
import type { Tool } from "../tool.js";

const directories: string[] = [];
const childPids: number[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function context(abort: AbortSignal, workDir: string): Tool.Context {
  return {
    sessionId: "session",
    messageId: "message",
    agentId: "main",
    abort,
    workDir,
    metadata() {},
  };
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("command did not stop after cancellation")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

afterEach(async () => {
  for (const pid of childPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("bash process-tree cancellation", () => {
  it("does not start a command when the signal was already aborted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bash-cancel-"));
    directories.push(directory);
    const sideEffect = join(directory, "should-not-exist");
    const controller = new AbortController();
    controller.abort();
    const tool = await BashTool.init();
    const result = await tool.execute(
      { command: `touch ${quote(sideEffect)}`, description: "pre-aborted command" },
      context(controller.signal, directory),
    );
    expect(result.output).toContain("aborted");
    expect(await exists(sideEffect)).toBe(false);
  });

  it.each(["abort", "timeout"] as const)(
    "stops TERM-resistant descendants on %s before later side effects",
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "bash-cancel-"));
      directories.push(directory);
      const ready = join(directory, "ready");
      const sideEffect = join(directory, "should-not-exist");
      // The grandchild ignores TERM and closes inherited stdout/stderr. Waiting only
      // for the parent shell's exit/close must not leave this process running.
      const childScript = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sideEffect)}, 'leaked'), 1800); setInterval(() => {}, 1000);`;
      const parentScript = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(join(directory, "parent"))}, String(process.pid)); child.on('exit', () => process.exit());`;
      const controller = new AbortController();
      const tool = await BashTool.init();
      const resultPromise = tool.execute(
        {
          command: `${quote(process.execPath)} -e ${quote(parentScript)}`,
          description: "local cancellation fixture",
          timeout: mode === "timeout" ? 700 : 5000,
        },
        context(controller.signal, directory),
      );
      for (let attempt = 0; attempt < 100 && !(await exists(ready)); attempt++) await sleep(10);
      expect(await exists(ready)).toBe(true);
      childPids.push(
        Number(await readFile(ready, "utf8")),
        Number(await readFile(join(directory, "parent"), "utf8")),
      );
      if (mode === "abort") controller.abort();
      const output = await within(resultPromise, 1600);
      expect(output.output).toContain(mode === "abort" ? "aborted" : "timeout");
      await sleep(1900);
      expect(await exists(sideEffect)).toBe(false);
      expect(() => process.kill(childPids[0]!, 0)).toThrow();
      // Cancellation from the previous command must not affect the next one.
      const next = await tool.execute(
        { command: "echo next-command", description: "subsequent command" },
        context(new AbortController().signal, directory),
      );
      expect(next.output.trim()).toBe("next-command");
    },
    7000,
  );
});
