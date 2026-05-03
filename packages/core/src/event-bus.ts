import { EVENTS_CHANNEL, RealtimeEventSchema, type RealtimeEvent } from "@beacon/shared";
import type { Redis } from "ioredis";
import type { Logger } from "./logger.js";

export interface EventPublisher {
  publish(event: RealtimeEvent): Promise<void>;
}

export class RedisEventPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: RealtimeEvent): Promise<void> {
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  }
}

/** Subscribes on a dedicated connection; Redis forbids regular commands on a subscribed client. */
export async function subscribeToEvents(
  subscriber: Redis,
  logger: Logger,
  handler: (event: RealtimeEvent) => void,
): Promise<() => Promise<void>> {
  await subscriber.subscribe(EVENTS_CHANNEL);
  const listener = (channel: string, raw: string) => {
    if (channel !== EVENTS_CHANNEL) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      logger.warn({ raw: raw.slice(0, 200) }, "dropping malformed event");
      return;
    }
    const parsed = RealtimeEventSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "dropping invalid event");
      return;
    }
    handler(parsed.data);
  };
  subscriber.on("message", listener);
  return async () => {
    subscriber.off("message", listener);
    await subscriber.unsubscribe(EVENTS_CHANNEL);
  };
}

export class MemoryEventPublisher implements EventPublisher {
  readonly published: RealtimeEvent[] = [];
  publish(event: RealtimeEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
