import { HISTOGRAM_SIZE, LATENCY_BOUNDS_MS } from "@beacon/shared";
import type { AccumulatorOperator, PipelineStage, Types } from "mongoose";
import { CheckResultModel, ROLLUPS_COLLECTION, RollupModel, type Granularity } from "../models/index.js";

const DAY_MS = 86_400_000;

export const ROLLUP_RETENTION_MS: Record<Granularity, number> = {
  "1m": 3 * DAY_MS,
  "1h": 45 * DAY_MS,
  "1d": 400 * DAY_MS,
};

const UNIT: Record<Granularity, "minute" | "hour" | "day"> = { "1m": "minute", "1h": "hour", "1d": "day" };
const UNIT_MS: Record<Granularity, number> = { "1m": 60_000, "1h": 3_600_000, "1d": DAY_MS };

export function floorTo(date: Date, granularity: Granularity): Date {
  const size = UNIT_MS[granularity];
  return new Date(Math.floor(date.getTime() / size) * size);
}

const notDown = { $ne: ["$status", "down"] };

function rawHistogramAccumulators(): Record<string, AccumulatorOperator> {
  const accumulators: Record<string, AccumulatorOperator> = {};
  for (let i = 0; i < HISTOGRAM_SIZE; i++) {
    const lower = i === 0 ? null : LATENCY_BOUNDS_MS[i - 1];
    const upper = LATENCY_BOUNDS_MS[i];
    const conditions: unknown[] = [notDown];
    if (lower !== null && lower !== undefined) conditions.push({ $gt: ["$latencyMs", lower] });
    if (upper !== undefined) conditions.push({ $lte: ["$latencyMs", upper] });
    accumulators[`h${i}`] = { $sum: { $cond: [{ $and: conditions }, 1, 0] } };
  }
  return accumulators;
}

const histogramFields = Array.from({ length: HISTOGRAM_SIZE }, (_, i) => `$h${i}`);

/** Element-wise sum of the `hists` array pushed by a $group stage. */
const sumHistograms = {
  $reduce: {
    input: "$hists",
    initialValue: Array.from({ length: HISTOGRAM_SIZE }, () => 0),
    in: {
      $map: {
        input: { $range: [0, HISTOGRAM_SIZE] },
        as: "i",
        in: {
          $add: [
            { $ifNull: [{ $arrayElemAt: ["$$value", "$$i"] }, 0] },
            { $ifNull: [{ $arrayElemAt: ["$$this", "$$i"] }, 0] },
          ],
        },
      },
    },
  },
};

function mergeStage(): PipelineStage.Merge {
  return {
    $merge: {
      into: ROLLUPS_COLLECTION,
      on: ["monitorId", "granularity", "bucket"],
      whenMatched: "replace",
      whenNotMatched: "insert",
    },
  };
}

export interface RollupWindow {
  from: Date;
  to: Date;
}

/**
 * Rollups are rebuilt idempotently for a trailing window: minute buckets come from raw check
 * results, hours from minutes and days from hours. Re-running a window simply replaces buckets via
 * $merge, so late-arriving results and overlapping schedules are harmless.
 */
export class RollupService {
  async buildMinuteRollups(window: RollupWindow): Promise<void> {
    const pipeline: PipelineStage[] = [
      { $match: { ts: { $gte: floorTo(window.from, "1m"), $lt: window.to } } },
      {
        $group: {
          _id: { monitorId: "$meta.monitorId", bucket: { $dateTrunc: { date: "$ts", unit: "minute" } } },
          orgId: { $first: "$meta.orgId" },
          total: { $sum: 1 },
          up: { $sum: { $cond: [{ $eq: ["$status", "up"] }, 1, 0] } },
          degraded: { $sum: { $cond: [{ $eq: ["$status", "degraded"] }, 1, 0] } },
          down: { $sum: { $cond: [{ $eq: ["$status", "down"] }, 1, 0] } },
          latencySum: { $sum: { $cond: [notDown, "$latencyMs", 0] } },
          latencyMin: { $min: { $cond: [notDown, "$latencyMs", null] } },
          latencyMax: { $max: { $cond: [notDown, "$latencyMs", null] } },
          ...rawHistogramAccumulators(),
        },
      },
      {
        $project: {
          _id: 0,
          monitorId: "$_id.monitorId",
          orgId: 1,
          granularity: { $literal: "1m" },
          bucket: "$_id.bucket",
          total: 1,
          up: 1,
          degraded: 1,
          down: 1,
          latencySum: 1,
          latencyCount: { $add: ["$up", "$degraded"] },
          latencyMin: { $ifNull: ["$latencyMin", null] },
          latencyMax: { $ifNull: ["$latencyMax", null] },
          hist: histogramFields,
          expiresAt: { $add: ["$_id.bucket", ROLLUP_RETENTION_MS["1m"]] },
        },
      },
      mergeStage(),
    ];
    await CheckResultModel.aggregate(pipeline).exec();
  }

  async buildFromChildren(child: Granularity, parent: Granularity, window: RollupWindow): Promise<void> {
    const pipeline: PipelineStage[] = [
      { $match: { granularity: child, bucket: { $gte: floorTo(window.from, parent), $lt: window.to } } },
      {
        $group: {
          _id: { monitorId: "$monitorId", bucket: { $dateTrunc: { date: "$bucket", unit: UNIT[parent] } } },
          orgId: { $first: "$orgId" },
          total: { $sum: "$total" },
          up: { $sum: "$up" },
          degraded: { $sum: "$degraded" },
          down: { $sum: "$down" },
          latencySum: { $sum: "$latencySum" },
          latencyCount: { $sum: "$latencyCount" },
          latencyMin: { $min: "$latencyMin" },
          latencyMax: { $max: "$latencyMax" },
          hists: { $push: "$hist" },
        },
      },
      {
        $project: {
          _id: 0,
          monitorId: "$_id.monitorId",
          orgId: 1,
          granularity: { $literal: parent },
          bucket: "$_id.bucket",
          total: 1,
          up: 1,
          degraded: 1,
          down: 1,
          latencySum: 1,
          latencyCount: 1,
          latencyMin: { $ifNull: ["$latencyMin", null] },
          latencyMax: { $ifNull: ["$latencyMax", null] },
          hist: sumHistograms,
          expiresAt: { $add: ["$_id.bucket", ROLLUP_RETENTION_MS[parent]] },
        },
      },
      mergeStage(),
    ];
    await RollupModel.aggregate(pipeline).exec();
  }

  async rollupMinutes(now: Date, lookbackMs = 5 * 60_000): Promise<void> {
    await this.buildMinuteRollups({ from: new Date(now.getTime() - lookbackMs), to: now });
  }

  async rollupHours(now: Date, lookbackMs = 2 * 3_600_000): Promise<void> {
    await this.buildFromChildren("1m", "1h", { from: new Date(now.getTime() - lookbackMs), to: now });
  }

  async rollupDays(now: Date, lookbackMs = 2 * DAY_MS): Promise<void> {
    await this.buildFromChildren("1h", "1d", { from: new Date(now.getTime() - lookbackMs), to: now });
  }
}

export interface AggregatedBucket {
  monitorId: Types.ObjectId;
  bucket: Date;
  total: number;
  up: number;
  degraded: number;
  down: number;
  latencySum: number;
  latencyCount: number;
  latencyMax: number | null;
  hist: number[];
}

export interface BucketQuery {
  monitorIds: Types.ObjectId[];
  granularity: Granularity;
  from: Date;
  to: Date;
  /** Re-bucket stored rollups into bins of this many source units (e.g. 15 one-minute rollups). */
  binSize?: number;
  /** Collapse the whole window into a single bucket per monitor. */
  collapse?: boolean;
}

export async function queryBuckets(query: BucketQuery): Promise<AggregatedBucket[]> {
  const bucketExpr = query.collapse
    ? { $literal: query.from }
    : { $dateTrunc: { date: "$bucket", unit: UNIT[query.granularity], binSize: query.binSize ?? 1 } };
  const pipeline: PipelineStage[] = [
    {
      $match: {
        monitorId: { $in: query.monitorIds },
        granularity: query.granularity,
        bucket: { $gte: query.from, $lt: query.to },
      },
    },
    {
      $group: {
        _id: { monitorId: "$monitorId", bucket: bucketExpr },
        total: { $sum: "$total" },
        up: { $sum: "$up" },
        degraded: { $sum: "$degraded" },
        down: { $sum: "$down" },
        latencySum: { $sum: "$latencySum" },
        latencyCount: { $sum: "$latencyCount" },
        latencyMax: { $max: "$latencyMax" },
        hists: { $push: "$hist" },
      },
    },
    {
      $project: {
        _id: 0,
        monitorId: "$_id.monitorId",
        bucket: "$_id.bucket",
        total: 1,
        up: 1,
        degraded: 1,
        down: 1,
        latencySum: 1,
        latencyCount: 1,
        latencyMax: { $ifNull: ["$latencyMax", null] },
        hist: sumHistograms,
      },
    },
    { $sort: { bucket: 1 } },
  ];
  return RollupModel.aggregate<AggregatedBucket>(pipeline).exec();
}
