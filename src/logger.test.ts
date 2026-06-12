import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogEntry } from "./logger";

describe("logger", () => {
  it("emits JSON with explicit log level", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");

    logger.info("test message");

    const logged = consoleSpy.mock.calls[0]?.[0];
    expect(logged).toBeDefined();

    const entry = JSON.parse(logged as string) as LogEntry;
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.name).toBe("test");
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    consoleSpy.mockRestore();
  });

  it("includes metadata in log entry", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");

    logger.warn("warning message", { userId: "123", action: "delete" });

    const logged = consoleSpy.mock.calls[0]?.[0];
    const entry = JSON.parse(logged as string) as LogEntry;

    expect(entry.userId).toBe("123");
    expect(entry.action).toBe("delete");

    consoleSpy.mockRestore();
  });

  it("supports all log levels", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");

    const levels: Array<[string, (message: string) => void]> = [
      ["debug", (msg) => logger.debug(msg)],
      ["info", (msg) => logger.info(msg)],
      ["warn", (msg) => logger.warn(msg)],
      ["error", (msg) => logger.error(msg)],
    ];

    for (const [level, log] of levels) {
      consoleSpy.mockClear();
      log(`${level} message`);

      const entry = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as LogEntry;
      expect(entry.level).toBe(level);
    }

    consoleSpy.mockRestore();
  });
});
