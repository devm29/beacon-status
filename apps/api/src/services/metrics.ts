import {
  floorTo,
  queryBuckets,
  type AggregatedBucket,
  type Granularity,
  type MonitorDoc,
} from "@beacon/core";
import {
  percentileFromHistogram,
  type MetricPoint,
  type MetricRange,
  type MetricsDto,
  type MonitorStatsDto,
} from "@beacon/shared";
import type { Types } from "mongoose";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const RANGES: Record<MetricRange, { granularity: Granularity; binSize: number; spanMs: number }> = {
  "1h": { granularity: "1m", binSize: 1, spanMs: HOUR },
  "24h": { granularity: "1m", binSize: 15, spanMs: DAY },
  "7d": { granularity: "1h", binSize: 2, spanMs: 7 * DAY },
  "30d": { granularity: "1h", binSize: 12, spanMs: 30 * DAY },
  "90d": { granularity: "1d", binSize: 1, spanMs: 90 * DAY },
};

const SPARKLINE_WINDOW_MS = 60 * 60_000;
const SPARKLINE_BIN_MINUTES = 2;

export function toPoint(bucket: AggregatedBucket): MetricPoint {
  const maxMs = bucket.latencyMax ?? 0;
  return {
    t: bucket.bucket.toISOString(),
    total: bucket.total,
    up: bucket.up,
    degraded: bucket.degraded,
    down: bucket.down,
    uptime: bucket.total > 0 ? (bucket.up + bucket.degraded) / bucket.total : null,
    avgMs: bucket.latencyCount > 0 ? Math.round(bucket.latencySum / bucket.latencyCount) : null,
    p50Ms: percentileFromHistogram(bucket.hist, 0.5, maxMs),
    p95Ms: percentileFromHistogram(bucket.hist, 0.95, maxMs),
    p99Ms: percentileFromHistogram(bucket.hist, 0.99, maxMs),
  };
}

function groupByMonitor(buckets: AggregatedBucket[]): Map<string, AggregatedBucket[]> {
  const grouped = new Map<string, AggregatedBucket[]>();
  for (const bucket of buckets) {
    const key = bucket.monitorId.toHexString();
    grouped.set(key, [...(grouped.get(key) ?? []), bucket]);
  }
  return grouped;
}

export class MetricsService {
  async series(monitorId: Types.ObjectId, range: MetricRange, now = new Date()): Promise<MetricsDto> {
    const config = RANGES[range];
    const from = floorTo(new Date(now.getTime() - config.spanMs), config.granularity);
    const buckets = await queryBuckets({
      monitorIds: [monitorId],
      granularity: config.granularity,
      from,
      to: now,
      binSize: config.binSize,
    });
    return { range, granularity: config.granularity, points: buckets.map(toPoint) };
  }

  /** Per-monitor headline numbers for list views, computed with three batched aggregations. */
  async stats(monitors: Pick<MonitorDoc, "_id">[], now = new Date()): Promise<Map<string, MonitorStatsDto>> {
    const ids = monitors.map((m) => m._id);
    const result = new Map<string, MonitorStatsDto>();
    if (ids.length === 0) return result;

    const [day, month, spark] = await Promise.all([
      queryBuckets({
        monitorIds: ids,
        granularity: "1h",
        from: floorTo(new Date(now.getTime() - DAY), "1h"),
        to: now,
        collapse: true,
      }),
      queryBuckets({
        monitorIds: ids,
        granularity: "1h",
        from: floorTo(new Date(now.getTime() - 30 * DAY), "1h"),
        to: now,
        collapse: true,
      }),
      queryBuckets({
        monitorIds: ids,
        granularity: "1m",
        from: floorTo(new Date(now.getTime() - SPARKLINE_WINDOW_MS), "1m"),
        to: now,
        binSize: SPARKLINE_BIN_MINUTES,
      }),
    ]);
    const dayBy = new Map(day.map((b) => [b.monitorId.toHexString(), b]));
    const monthBy = new Map(month.map((b) => [b.monitorId.toHexString(), b]));
    const sparkBy = groupByMonitor(spark);

    for (const id of ids) {
      const key = id.toHexString();
      const d = dayBy.get(key);
      const m = monthBy.get(key);
      const dayPoint = d ? toPoint(d) : null;
      result.set(key, {
        monitorId: key,
        uptime24h: dayPoint?.uptime ?? null,
        uptime30d: m && m.total > 0 ? (m.up + m.degraded) / m.total : null,
        p95Ms24h: dayPoint?.p95Ms ?? null,
        avgMs24h: dayPoint?.avgMs ?? null,
        sparkline: (sparkBy.get(key) ?? []).map((b) => ({
          t: b.bucket.toISOString(),
          avgMs: b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : null,
        })),
      });
    }
    return result;
  }

  async totals(
    monitorIds: Types.ObjectId[],
    now = new Date(),
  ): Promise<{ checks24h: number; uptime30d: number | null; avgLatency24h: number | null }> {
    if (monitorIds.length === 0) return { checks24h: 0, uptime30d: null, avgLatency24h: null };
    const [day, month] = await Promise.all([
      queryBuckets({
        monitorIds,
        granularity: "1h",
        from: floorTo(new Date(now.getTime() - DAY), "1h"),
        to: now,
        collapse: true,
      }),
      queryBuckets({
        monitorIds,
        granularity: "1h",
        from: floorTo(new Date(now.getTime() - 30 * DAY), "1h"),
        to: now,
        collapse: true,
      }),
    ]);
    const sum = (rows: AggregatedBucket[], pick: (b: AggregatedBucket) => number) =>
      rows.reduce((s, b) => s + pick(b), 0);
    const monthTotal = sum(month, (b) => b.total);
    const latencyCount = sum(day, (b) => b.latencyCount);
    return {
      checks24h: sum(day, (b) => b.total),
      uptime30d: monthTotal > 0 ? sum(month, (b) => b.up + b.degraded) / monthTotal : null,
      avgLatency24h: latencyCount > 0 ? Math.round(sum(day, (b) => b.latencySum) / latencyCount) : null,
    };
  }
}
