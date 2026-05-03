import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckResultModel, RollupModel } from "../models/index.js";
import { connectTestDatabase } from "../testing/index.js";
import { RollupService, queryBuckets } from "./rollups.js";

describe("RollupService", () => {
  let drop: () => Promise<void>;
  const service = new RollupService();
  const orgId = new Types.ObjectId();
  const monitorId = new Types.ObjectId();
  const start = new Date("2026-04-01T10:00:00Z");
  const end = new Date(start.getTime() + 2 * 3_600_000);

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
    const docs = [];
    for (let t = start.getTime(); t < end.getTime(); t += 20_000) {
      const minute = Math.floor((t - start.getTime()) / 60_000);
      docs.push({
        ts: new Date(t),
        meta: { monitorId, orgId, region: "us-east" },
        status: minute === 30 ? "down" : minute === 31 ? "degraded" : "up",
        latencyMs: minute === 30 ? 10_000 : 40 + (minute % 10) * 30,
        error: minute === 30 ? "timeout" : null,
        details: {},
      });
    }
    await CheckResultModel.insertMany(docs);
  });

  afterAll(async () => drop());

  it("builds minute, hour and day rollups that agree with each other", async () => {
    await service.buildMinuteRollups({ from: start, to: end });
    await service.buildFromChildren("1m", "1h", { from: start, to: end });
    await service.buildFromChildren("1h", "1d", { from: start, to: end });

    const minutes = await RollupModel.find({ monitorId, granularity: "1m" }).lean().exec();
    expect(minutes).toHaveLength(120);
    const failed = minutes.find((m) => m.bucket.getTime() === start.getTime() + 30 * 60_000);
    expect(failed).toMatchObject({ total: 3, down: 3, up: 0, latencyCount: 0, latencyMin: null });

    const hours = await RollupModel.find({ monitorId, granularity: "1h" }).sort({ bucket: 1 }).lean().exec();
    expect(hours.map((h) => h.total)).toEqual([180, 180]);
    expect(hours[0]).toMatchObject({ down: 3, degraded: 3, up: 174, latencyCount: 177 });
    expect(hours[0]?.hist.reduce((a, b) => a + b, 0)).toBe(177);

    const [day] = await RollupModel.find({ monitorId, granularity: "1d" }).lean().exec();
    expect(day).toMatchObject({ total: 360, down: 3 });
    expect(day?.expiresAt.getTime()).toBeGreaterThan(day?.bucket.getTime() ?? 0);
  });

  it("is idempotent when windows are rebuilt", async () => {
    await service.buildMinuteRollups({ from: start, to: end });
    await service.buildFromChildren("1m", "1h", { from: start, to: end });
    expect(await RollupModel.countDocuments({ monitorId, granularity: "1m" })).toBe(120);
    expect(await RollupModel.countDocuments({ monitorId, granularity: "1h" })).toBe(2);
  });

  it("re-buckets and collapses on read", async () => {
    const quarters = await queryBuckets({
      monitorIds: [monitorId],
      granularity: "1m",
      from: start,
      to: end,
      binSize: 15,
    });
    expect(quarters).toHaveLength(8);
    expect(quarters.every((q) => q.total === 45)).toBe(true);
    const [all] = await queryBuckets({
      monitorIds: [monitorId],
      granularity: "1h",
      from: start,
      to: end,
      collapse: true,
    });
    expect(all?.total).toBe(360);
  });
});
