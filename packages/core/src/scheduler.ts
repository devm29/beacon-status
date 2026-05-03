import { REGIONS } from "@beacon/shared";
import type { Logger } from "./logger.js";
import type { MonitorDoc } from "./models/index.js";
import type { ProbeJobData, ProbeQueues } from "./queues.js";

export function schedulerId(monitorId: string): string {
  return `monitor:${monitorId}`;
}

type SchedulableMonitor = Pick<
  MonitorDoc,
  "_id" | "orgId" | "check" | "timeoutMs" | "degradedLatencyMs" | "intervalSeconds" | "regions" | "paused"
>;

/**
 * Keeps one BullMQ job scheduler per monitor in each region's queue. Each region's prober only
 * consumes its own queue, which is how probes are sharded across the region workers.
 */
export class MonitorScheduler {
  constructor(
    private readonly queues: ProbeQueues,
    private readonly logger: Logger,
  ) {}

  async sync(monitor: SchedulableMonitor): Promise<void> {
    const id = schedulerId(monitor._id.toHexString());
    const data: ProbeJobData = {
      monitorId: monitor._id.toHexString(),
      orgId: monitor.orgId.toHexString(),
      check: monitor.check,
      timeoutMs: monitor.timeoutMs,
      degradedLatencyMs: monitor.degradedLatencyMs,
    };
    await Promise.all(
      REGIONS.map(async (region) => {
        const queue = this.queues.get(region);
        if (monitor.paused || !monitor.regions.includes(region)) {
          await queue.removeJobScheduler(id);
          return;
        }
        await queue.upsertJobScheduler(
          id,
          { every: monitor.intervalSeconds * 1000 },
          { name: "probe", data, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } },
        );
      }),
    );
    this.logger.debug({ monitorId: data.monitorId, paused: monitor.paused }, "synced probe schedulers");
  }

  async remove(monitorId: string): Promise<void> {
    const id = schedulerId(monitorId);
    await Promise.all(this.queues.all().map((queue) => queue.removeJobScheduler(id)));
  }

  /** Converges Redis with MongoDB: upserts every monitor and drops schedulers for deleted ones. */
  async reconcile(monitors: SchedulableMonitor[]): Promise<{ synced: number; removed: number }> {
    const wanted = new Set(monitors.map((m) => schedulerId(m._id.toHexString())));
    let removed = 0;
    for (const queue of this.queues.all()) {
      const schedulers = await queue.getJobSchedulers(0, -1);
      for (const scheduler of schedulers) {
        if (scheduler.key.startsWith("monitor:") && !wanted.has(scheduler.key)) {
          await queue.removeJobScheduler(scheduler.key);
          removed += 1;
        }
      }
    }
    for (const monitor of monitors) await this.sync(monitor);
    this.logger.info({ synced: monitors.length, removed }, "reconciled probe schedulers");
    return { synced: monitors.length, removed };
  }
}
