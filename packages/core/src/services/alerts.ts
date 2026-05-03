import type { AlertEvent } from "@beacon/shared";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Types } from "mongoose";
import type { Logger } from "../logger.js";
import {
  ChannelModel,
  NotificationModel,
  type AlertField,
  type AlertSeverity,
  type ChannelDoc,
  type NotificationDoc,
  type NotificationStatus,
} from "../models/index.js";
import type { NotifyJobData } from "../queues.js";
import { coversMonitor, type MaintenanceRepository } from "../repositories/maintenance.js";

export interface AlertMonitor {
  id: Types.ObjectId;
  key: string;
  name: string;
}

export interface Alert {
  event: AlertEvent;
  orgId: Types.ObjectId;
  /** Every monitor the alert is about; the first is recorded on the notification. */
  monitors: AlertMonitor[];
  incidentId: Types.ObjectId | null;
  subject: string;
  body: string;
  severity: AlertSeverity;
  url: string | null;
  fields: AlertField[];
  /** Identical keys inside the dedup window are dropped per channel. */
  dedupKey: string;
  dedupWindowSeconds?: number;
  /** Set when the caller already knows the alert must not page anyone (e.g. flapping). */
  suppressReason?: string | null;
}

export interface DeliveryScheduler {
  schedule(notificationId: string, delayMs: number): Promise<void>;
}

export interface DedupStore {
  /** Returns true when the key was not seen inside the window and is now claimed. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export function queueDeliveryScheduler(queue: Queue<NotifyJobData>): DeliveryScheduler {
  return {
    async schedule(notificationId, delayMs) {
      await queue.add("deliver", { notificationId }, { jobId: notificationId, delay: delayMs });
    },
  };
}

export function redisDedupStore(redis: Redis): DedupStore {
  return {
    async claim(key, ttlSeconds) {
      return (await redis.set(`beacon:dedup:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK";
    },
    async release(key) {
      await redis.del(`beacon:dedup:${key}`);
    },
  };
}

export function memoryDedupStore(): DedupStore {
  const seen = new Map<string, number>();
  return {
    claim(key, ttlSeconds) {
      const now = Date.now();
      const expires = seen.get(key);
      if (expires !== undefined && expires > now) return Promise.resolve(false);
      seen.set(key, now + ttlSeconds * 1000);
      return Promise.resolve(true);
    },
    release(key) {
      seen.delete(key);
      return Promise.resolve();
    },
  };
}

const ESCALATING_EVENTS: ReadonlySet<AlertEvent> = new Set(["incident.opened", "monitor.degraded"]);
const DEFAULT_DEDUP_WINDOW_SECONDS = 15 * 60;

export function channelWantsAlert(
  channel: Pick<ChannelDoc, "events" | "monitors" | "enabled">,
  alert: Alert,
): boolean {
  if (!channel.enabled || !channel.events.includes(alert.event)) return false;
  if (channel.monitors.length === 0 || alert.monitors.length === 0) return true;
  return alert.monitors.some((monitor) => channel.monitors.includes(monitor.key));
}

const STALE_PENDING_MS = 5 * 60_000;

/**
 * Fans an alert out to channels. Every decision (sent later, suppressed by maintenance, dropped as
 * duplicate) is persisted so the dashboard can explain why someone was or was not paged.
 */
export class AlertDispatcher {
  constructor(
    private readonly deps: {
      dedup: DedupStore;
      delivery: DeliveryScheduler;
      maintenance: MaintenanceRepository;
      logger: Logger;
    },
  ) {}

  async dispatch(alert: Alert, now: Date = new Date()): Promise<NotificationDoc[]> {
    const channels = await ChannelModel.find({ orgId: alert.orgId, enabled: true, events: alert.event })
      .lean<ChannelDoc[]>()
      .exec();
    const targets = channels.filter((channel) => channelWantsAlert(channel, alert));
    if (targets.length === 0) return [];

    let suppressReason = alert.suppressReason ?? null;
    if (!suppressReason && alert.monitors.length > 0) {
      const windows = await this.deps.maintenance.active(alert.orgId, now);
      const covering = alert.monitors.map((m) => windows.find((w) => coversMonitor(w, m.key)));
      if (covering.every(Boolean)) suppressReason = `maintenance: ${covering[0]?.title ?? "scheduled"}`;
    }

    const created: NotificationDoc[] = [];
    for (const channel of targets) {
      const dedupKey = `${channel._id.toHexString()}:${alert.dedupKey}`;
      const fresh = await this.deps.dedup.claim(
        dedupKey,
        alert.dedupWindowSeconds ?? DEFAULT_DEDUP_WINDOW_SECONDS,
      );
      if (!fresh) {
        this.deps.logger.debug({ channel: channel.key, dedupKey: alert.dedupKey }, "duplicate alert dropped");
        continue;
      }
      const delayMs = ESCALATING_EVENTS.has(alert.event) ? channel.escalationDelaySeconds * 1000 : 0;
      const status: NotificationStatus = suppressReason ? "suppressed" : "pending";
      const notification = await this.persist(alert, channel, status, suppressReason, now, delayMs).catch(
        async (error: unknown) => {
          await this.deps.dedup.release(dedupKey);
          throw error;
        },
      );
      created.push(notification);
      if (status === "pending") {
        await this.deps.delivery.schedule(notification._id.toHexString(), delayMs);
      }
    }
    this.deps.logger.info(
      { event: alert.event, channels: created.length, suppressed: suppressReason },
      "alert dispatched",
    );
    return created;
  }

  /**
   * A notification still pending long after it was due lost its queue job (Redis flushed, say).
   * Re-adding is safe: the job id is the notification id, so a job that still exists is kept.
   */
  async requeueStalePending(now: Date, limit = 100): Promise<number> {
    const stale = await NotificationModel.find(
      { status: "pending", deliverAfter: { $lt: new Date(now.getTime() - STALE_PENDING_MS) } },
      { _id: 1 },
    )
      .limit(limit)
      .lean<Pick<NotificationDoc, "_id">[]>()
      .exec();
    for (const notification of stale) {
      await this.deps.delivery.schedule(notification._id.toHexString(), 0);
    }
    return stale.length;
  }

  private async persist(
    alert: Alert,
    channel: ChannelDoc,
    status: NotificationStatus,
    suppressReason: string | null,
    now: Date,
    delayMs: number,
  ): Promise<NotificationDoc> {
    const notification = await NotificationModel.create({
      orgId: alert.orgId,
      channelId: channel._id,
      incidentId: alert.incidentId,
      monitorId: alert.monitors[0]?.id ?? null,
      event: alert.event,
      dedupKey: alert.dedupKey,
      subject: alert.subject,
      body: alert.body,
      severity: alert.severity,
      url: alert.url,
      fields: alert.fields,
      status,
      reason: suppressReason,
      attempts: 0,
      deliverAfter: new Date(now.getTime() + delayMs),
      deliveredAt: null,
    });
    return notification.toObject<NotificationDoc>();
  }
}
