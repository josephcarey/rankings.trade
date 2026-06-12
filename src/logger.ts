/**
 * Lightweight structured logger for Cloudflare Workers and Node.js.
 * Emits JSON with explicit levels; compatible with both runtime environments.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Creates a structured logger that emits JSON to stdout/console.
 * No file I/O — compatible with Cloudflare Workers.
 */
export function createLogger(name: string): {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
} {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      name,
      ...meta,
    };

    // JSON logs are analyzed by structured log aggregators, not human readers.
    // console is used because it's available in both Node.js and Cloudflare Workers.
    // @ts-expect-error - console is used for structured logging in both runtimes
    console.log(JSON.stringify(entry));
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
  };
}

/**
 * Global logger instance for API handlers.
 */
export const logger = createLogger("api");
