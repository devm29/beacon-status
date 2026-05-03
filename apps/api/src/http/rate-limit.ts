import { rateLimit, type Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
import { RedisStore } from "rate-limit-redis";

type Scalar = boolean | number | string;
type Reply = Scalar | Scalar[];

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

function toReply(value: unknown): Reply {
  if (isScalar(value)) return value;
  if (Array.isArray(value) && value.every(isScalar)) return value;
  throw new Error("Unexpected reply from Redis");
}

export type StoreFactory = (prefix: string) => Store | undefined;

/** Shares counters across API replicas; each limiter gets its own key prefix. */
export function redisStoreFactory(redis: Redis): StoreFactory {
  return (prefix) =>
    new RedisStore({
      prefix: `beacon:rl:${prefix}:`,
      sendCommand: async (command: string, ...args: string[]) => toReply(await redis.call(command, ...args)),
    });
}

export const memoryStores: StoreFactory = () => undefined;

const tooMany = (message: string) => ({ error: { code: "rate_limited", message } });

export interface RateLimits {
  publicPerMinute: number;
  authFailuresPer15Minutes: number;
}

export function publicLimiter(limits: RateLimits, stores: StoreFactory): RequestHandler {
  const store = stores("public");
  return rateLimit({
    windowMs: 60_000,
    limit: limits.publicPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Long-lived SSE connections are capped separately by the hub.
    skip: (req) => req.path.endsWith("/events"),
    message: tooMany("Too many requests. Slow down and try again in a minute."),
    ...(store ? { store } : {}),
  });
}

/** Only failed authentications count, so a busy CLI or dashboard is never throttled. */
export function authFailureLimiter(limits: RateLimits, stores: StoreFactory): RequestHandler {
  const store = stores("auth");
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: limits.authFailuresPer15Minutes,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    skipSuccessfulRequests: true,
    message: tooMany("Too many failed sign-in attempts. Try again later."),
    ...(store ? { store } : {}),
  });
}
