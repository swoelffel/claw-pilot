import { describe, it, expect, beforeEach, vi } from "vitest";
import { logger, configureLogger, getLoggerConfig } from "../logger.js";

describe("logger", () => {
  beforeEach(() => {
    // Reset to defaults before each test
    configureLogger({ level: "info", format: "text" });
  });

  describe("configureLogger / getLoggerConfig", () => {
    it("defaults to info level and text format", () => {
      expect(getLoggerConfig()).toEqual({ level: "info", format: "text" });
    });

    it("persists configured level and format", () => {
      configureLogger({ level: "warn", format: "json" });
      expect(getLoggerConfig()).toEqual({ level: "warn", format: "json" });
    });
  });

  describe("level filtering — text format", () => {
    it("suppresses debug messages when level=info", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.debug("should be hidden");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("emits info messages when level=info", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.info("visible");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("suppresses info and warn when level=error", () => {
      configureLogger({ level: "error", format: "text" });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.info("info hidden");
      logger.warn("warn hidden");
      logger.error("error visible");
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledOnce();
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("emits all levels when level=debug", () => {
      configureLogger({ level: "debug", format: "text" });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(errSpy).toHaveBeenCalledOnce();
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe("JSON format", () => {
    it("emits a valid JSON line with required fields", () => {
      configureLogger({ level: "info", format: "json" });
      const lines: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

      logger.info("test message");

      spy.mockRestore();
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.level).toBe("info");
      expect(parsed.msg).toBe("test message");
      expect(typeof parsed.ts).toBe("string");
    });

    it("includes ctx fields in the JSON output", () => {
      configureLogger({ level: "info", format: "json" });
      const lines: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

      logger.info("llm_call", { event: "llm_call", tokensIn: 100, slug: "cpteam" });

      spy.mockRestore();
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.event).toBe("llm_call");
      expect(parsed.tokensIn).toBe(100);
      expect(parsed.slug).toBe("cpteam");
    });

    it("suppresses debug messages when level=info in JSON mode", () => {
      configureLogger({ level: "info", format: "json" });
      const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      logger.debug("hidden");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("emits one JSON line per message ending with newline", () => {
      configureLogger({ level: "info", format: "json" });
      const lines: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

      logger.info("msg1");
      logger.warn("msg2");

      spy.mockRestore();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/\n$/);
      expect(lines[1]).toMatch(/\n$/);
    });
  });

  describe("visual helper methods", () => {
    it("step emits at info level", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.step("sub-step");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("dim is suppressed at info level", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.dim("context");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("dim emits at debug level", () => {
      configureLogger({ level: "debug", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.dim("context");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("success emits at info level", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.success("done");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("fail emits at error level", () => {
      configureLogger({ level: "info", format: "text" });
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.fail("oops");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });
  });
});
