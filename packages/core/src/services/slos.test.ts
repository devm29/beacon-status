import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RollupModel } from "../models/index.js";
import { connectTestDatabase } from "../testing/index.js";
import { ROLLUP_RETENTION_MS, floorTo } from "./rollups.js";
import { SloService } from "./slos.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function rollup(monitorId: Types.ObjectId, granularity: "1h" | "1d", bucket: Date, down: number) {
  const total = granularity === "1h" ? 120 : 2_880;
  return {
    monitorId,
    orgId: new Types.ObjectId(),
    granularity,
    bucket,
    total,
    up: total - down,
    degraded: 0,
    down,
    latencySum: 0,
    latencyCount: 0,
    hist: [],
    expiresAt: new Date(bucket.getTime() + ROLLUP_RETENTION_MS[granularity]),
  };
}

describe("SloService.windowTotals", () => {
  let drop: () => Promise<void>;
  const service = new SloService();
  const monitorId = new Types.ObjectId();
  const now = new Date("2026-06-30T12:30:00Z");

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
    const docs = [];
    // What the TTL index leaves behind: 90 days of daily rollups, but hourly ones for 45 days only.
    for (let day = 0; day < 91; day++) {
      const bucket = floorTo(new Date(now.getTime() - day * DAY), "1d");
      docs.push(rollup(monitorId, "1d", bucket, day >= 60 ? 10 : 0));
    }
    const hourlyFrom = now.getTime() - ROLLUP_RETENTION_MS["1h"];
    for (let t = floorTo(now, "1h").getTime(); t >= hourlyFrom; t -= HOUR) {
      docs.push(rollup(monitorId, "1h", new Date(t), 0));
    }
    await RollupModel.insertMany(docs);
  });

  afterAll(async () => drop());

  it("reads short windows from hourly rollups only", async () => {
    const totals = await service.windowTotals(monitorId, 30, now);
    expect(totals.total).toBe(30 * 24 * 120 + 120);
    expect(totals.good).toBe(totals.total);
  });

  it("counts the part of a 90-day window that hourly rollups no longer cover", async () => {
    const totals = await service.windowTotals(monitorId, 90, now);
    expect(totals.total).toBeGreaterThan(89 * 2_880);
    expect(totals.total - totals.good).toBe(31 * 10);
  });
});
