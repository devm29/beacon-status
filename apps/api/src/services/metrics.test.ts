import { CheckResultModel, RollupService, SloService, type MonitorDoc } from "@beacon/core";
import { connectTestDatabase } from "@beacon/core/testing";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.js";

const HOUR = 3_600_000;

describe("metrics and SLO burn on real rollups", () => {
  let drop: () => Promise<void>;
  const orgId = new Types.ObjectId();
  const monitorId = new Types.ObjectId();
  const now = new Date("2026-06-10T12:00:00Z");
  const from = new Date(now.getTime() - 2 * HOUR);

  beforeAll(async () => {
    ({ drop } = await connectTestDatabase());
    const docs = [];
    for (let t = from.getTime(); t < now.getTime(); t += 30_000) {
      // The last ten minutes fail completely; everything before is healthy.
      const failing = t >= now.getTime() - 10 * 60_000;
      docs.push({
        ts: new Date(t),
        meta: { monitorId, orgId, region: "us-east" },
        status: failing ? "down" : "up",
        latencyMs: failing ? 10_000 : 120,
        error: failing ? "Connection refused" : null,
        details: {},
      });
    }
    await CheckResultModel.insertMany(docs);
    const rollups = new RollupService();
    await rollups.buildMinuteRollups({ from, to: now });
    await rollups.buildFromChildren("1m", "1h", { from, to: now });
  });
  afterAll(async () => drop());

  it("charts uptime and latency percentiles from minute rollups", async () => {
    const series = await new MetricsService().series(monitorId, "1h", now);
    const points = series.points.filter((p) => p.total > 0);
    expect(points.length).toBeGreaterThanOrEqual(59);
    const healthy = points[0];
    const failing = points.at(-1);
    expect(healthy?.uptime).toBe(1);
    expect(healthy?.p50Ms).toBeGreaterThan(0);
    expect(failing?.uptime).toBe(0);
  });

  it("fires the fast-burn page and scales thresholds to the SLO window", async () => {
    const slos = new SloService();
    const thirty = await slos.burnWindows(monitorId, { target: 99.9, windowDays: 30 }, now);
    const fast = thirty.find((b) => b.policy.name === "fast-burn");
    expect(fast?.policy.threshold).toBe(14.4);
    expect(fast?.shortBurn).toBeCloseTo(1000, 0);
    expect(fast?.longBurn).toBeGreaterThan(100);
    expect(fast?.firing).toBe(true);

    const ninety = await slos.burnWindows(monitorId, { target: 99.9, windowDays: 90 }, now);
    expect(ninety.find((b) => b.policy.name === "fast-burn")?.policy.threshold).toBeCloseTo(43.2);
  });

  it("reports the remaining error budget", async () => {
    const monitor: Pick<MonitorDoc, "_id" | "key" | "name"> = { _id: monitorId, key: "api", name: "API" };
    const report = await new SloService().report({ target: 99, windowDays: 7 }, monitor, now);
    expect(report.totals.total).toBe(240);
    expect(report.totals.bad).toBe(20);
    expect(report.budgetRemaining).toBeLessThan(0);
  });
});
