import { serverEnv } from "@/lib/env/server";

import { redactMetadata } from "./redact";

/**
 * Structured server-side logger.
 *
 * All metadata passes through redaction before it is emitted - see
 * ./redact.ts. Application code must use this rather than `console`, which is
 * blocked by ESLint (`no-console`).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogMetadata = Record<string, unknown>;

interface LogLine extends LogMetadata {
  level: LogLevel;
  time: string;
  message: string;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[serverEnv.LOG_LEVEL];
}

function emit(level: LogLevel, message: string, metadata?: LogMetadata): void {
  if (!shouldLog(level)) return;

  const line: LogLine = {
    level,
    time: new Date().toISOString(),
    message,
    ...(metadata ? redactMetadata(metadata) : {}),
  };

  // The single sanctioned console call in the application. In development a
  // readable line is more useful; elsewhere emit JSON for log aggregation.
  const serialized =
    serverEnv.APP_ENV === "development" ? formatForHumans(line) : JSON.stringify(line);

  // eslint-disable-next-line no-console
  if (level === "error") console.error(serialized);
  // eslint-disable-next-line no-console
  else if (level === "warn") console.warn(serialized);
  // eslint-disable-next-line no-console
  else console.log(serialized);
}

function formatForHumans({ level, time, message, ...rest }: LogLine): string {
  const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${time} ${level.toUpperCase().padEnd(5)} ${message}${extras}`;
}

export const logger = {
  debug: (message: string, metadata?: LogMetadata) => emit("debug", message, metadata),
  info: (message: string, metadata?: LogMetadata) => emit("info", message, metadata),
  warn: (message: string, metadata?: LogMetadata) => emit("warn", message, metadata),
  error: (message: string, metadata?: LogMetadata) => emit("error", message, metadata),
};

export type Logger = typeof logger;
