import {
  budgetBurndown,
  burnPoliciesFor,
  burnRate,
  errorBudget,
  evaluateBurnPolicies,
  type BurnWindowResult,
  type Counts,
  type SloReportDto,
} from "@beacon/shared";
import type { Types } from "mongoose";
import { RollupModel, SloModel, type MonitorDoc, type SloDoc } from "../models/index.js";
import { floorTo, queryBuckets } from "./rollups.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE_RESOLUTION_LIMIT_MS = 6 * HOUR;

interface CountBucket extends Counts {
  start: number;
}

async function loadBuckets(
  monitorId: Types.ObjectId,
  granularity: "1m" | "1h",
  from: Date,
): Promise<CountBucket[]> {
  const rows = await RollupModel.find(
    { monitorId, granularity, bucket: { $gte: from } },
    { bucket: 1, total: 1, up: 1, degraded: 1 },
  )
    .lean<{ bucket: Date; total: number; up: number; degraded: number }[]>()
    .exec();
  return rows.map((r) => ({ start: r.bucket.getTime(), total: r.total, good: r.up + r.degraded }));
}

function sumSince(buckets: readonly CountBucket[], since: number): Counts {
  let good = 0;
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.start < since) continue;
    good += bucket.good;
    total += bucket.total;
  }
  return { good, total };
}

export interface SloEvaluationResult {
  slo: SloDoc;
  sli: number | null;
  budgetRemaining: number;
  burn: BurnWindowResult[];
}

/**
 * SLIs are probe-level availability: degraded probes count as good, failed probes as bad. Short
 * burn windows read minute rollups, long ones read hourly rollups, so evaluating every SLO costs
 * two small indexed reads instead of a scan over raw results.
 */
export class SloService {
  async burnWindows(
    monitorId: Types.ObjectId,
    slo: Pick<SloDoc, "target" | "windowDays">,
    now: Date,
  ): Promise<BurnWindowResult[]> {
    const policies = burnPoliciesFor(slo.windowDays);
    const longest = Math.max(...policies.map((p) => p.longWindowMs));
    const [minutes, hours] = await Promise.all([
      loadBuckets(monitorId, "1m", new Date(now.getTime() - MINUTE_RESOLUTION_LIMIT_MS)),
      loadBuckets(monitorId, "1h", floorTo(new Date(now.getTime() - longest), "1h")),
    ]);
    const countsFor = (windowMs: number): Counts =>
      windowMs <= MINUTE_RESOLUTION_LIMIT_MS
        ? sumSince(minutes, now.getTime() - windowMs)
        : sumSince(hours, floorTo(new Date(now.getTime() - windowMs), "1h").getTime());
    return evaluateBurnPolicies(countsFor, slo.target, policies);
  }

  async windowTotals(monitorId: Types.ObjectId, windowDays: number, now: Date): Promise<Counts> {
    const [bucket] = await queryBuckets({
      monitorIds: [monitorId],
      granularity: "1h",
      from: floorTo(new Date(now.getTime() - windowDays * DAY), "1h"),
      to: now,
      collapse: true,
    });
    return bucket ? { good: bucket.up + bucket.degraded, total: bucket.total } : { good: 0, total: 0 };
  }

  async evaluate(slo: SloDoc, now: Date): Promise<SloEvaluationResult> {
    const [totals, burn] = await Promise.all([
      this.windowTotals(slo.monitorId, slo.windowDays, now),
      this.burnWindows(slo.monitorId, slo, now),
    ]);
    const budget = errorBudget(totals, slo.target);
    await SloModel.updateOne(
      { _id: slo._id },
      {
        $set: {
          lastEvaluation: {
            at: now,
            sli: budget.sli,
            budgetRemaining: budget.remaining,
            firing: burn.filter((b) => b.firing).map((b) => b.policy.name),
          },
        },
      },
    ).exec();
    return { slo, sli: budget.sli, budgetRemaining: budget.remaining, burn };
  }

  async report(
    slo: Pick<SloDoc, "target" | "windowDays">,
    monitor: Pick<MonitorDoc, "_id" | "key" | "name">,
    now: Date,
  ): Promise<Omit<SloReportDto, "slo"> & { sli: number | null; budgetRemaining: number }> {
    const windowStart = new Date(floorTo(now, "1d").getTime() - (slo.windowDays - 1) * DAY);
    const [totals, burn, days, hours] = await Promise.all([
      this.windowTotals(monitor._id, slo.windowDays, now),
      this.burnWindows(monitor._id, slo, now),
      queryBuckets({ monitorIds: [monitor._id], granularity: "1d", from: windowStart, to: now }),
      queryBuckets({
        monitorIds: [monitor._id],
        granularity: "1h",
        from: floorTo(new Date(now.getTime() - 7 * DAY), "1h"),
        to: now,
      }),
    ]);
    const budget = errorBudget(totals, slo.target);
    return {
      sli: budget.sli,
      budgetRemaining: budget.remaining,
      totals: { good: totals.good, total: totals.total, bad: budget.bad, allowedBad: budget.allowedBad },
      burn: burn.map((b) => ({
        name: b.policy.name,
        severity: b.policy.severity,
        longWindowMinutes: b.policy.longWindowMs / 60_000,
        shortWindowMinutes: b.policy.shortWindowMs / 60_000,
        threshold: b.policy.threshold,
        longBurn: b.longBurn,
        shortBurn: b.shortBurn,
        firing: b.firing,
      })),
      burndown: budgetBurndown(
        days.map((d) => ({ start: d.bucket, good: d.up + d.degraded, total: d.total })),
        slo.target,
        slo.windowDays,
      ),
      burnSeries: hours.map((h) => ({
        t: h.bucket.toISOString(),
        burn: burnRate({ good: h.up + h.degraded, total: h.total }, slo.target),
      })),
    };
  }
}
