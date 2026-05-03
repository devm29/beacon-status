import { Redis } from "ioredis";

export { Redis };

/**
 * BullMQ workers block on Redis, so they need `maxRetriesPerRequest: null`. Plain command clients
 * keep the default so a Redis outage surfaces as an error instead of hanging requests forever.
 */
export function createRedis(url: string, options: { blocking?: boolean } = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: options.blocking ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}
