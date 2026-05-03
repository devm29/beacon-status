import { pino, type Logger, type LoggerOptions } from "pino";

export type { Logger };

export function createLogger(service: string, level: LoggerOptions["level"] = "info"): Logger {
  const pretty =
    process.env.NODE_ENV !== "production" && process.env.LOG_FORMAT !== "json" && process.stdout.isTTY;
  return pino({
    name: service,
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ["req.headers.authorization", "*.apiKey", "*.secret"], censor: "[redacted]" },
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } } }
      : {}),
  });
}
