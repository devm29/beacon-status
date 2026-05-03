import { z } from "zod";
import { KeySchema } from "./monitor.js";

export const SLO_WINDOWS = [7, 28, 30, 90] as const;

export const SloSpecSchema = z.object({
  key: KeySchema,
  name: z.string().trim().min(1).max(80),
  monitor: KeySchema,
  target: z.number().min(90).max(99.999),
  windowDays: z.literal(SLO_WINDOWS).default(30),
});
export type SloSpec = z.infer<typeof SloSpecSchema>;
export type SloSpecInput = z.input<typeof SloSpecSchema>;

export interface Counts {
  good: number;
  total: number;
}

export function allowedErrorRatio(targetPercent: number): number {
  return 1 - targetPercent / 100;
}

export function sli(counts: Counts): number | null {
  return counts.total === 0 ? null : counts.good / counts.total;
}

/** Multiple of the sustainable error rate; 1.0 spends the budget exactly over the SLO window. */
export function burnRate(counts: Counts, targetPercent: number): number {
  if (counts.total === 0) return 0;
  const errorRatio = (counts.total - counts.good) / counts.total;
  return errorRatio / allowedErrorRatio(targetPercent);
}

export interface ErrorBudget {
  sli: number | null;
  allowedBad: number;
  bad: number;
  /** Fraction of budget left, 1 = untouched, 0 = exhausted, negative = SLO breached. */
  remaining: number;
}

export function errorBudget(counts: Counts, targetPercent: number): ErrorBudget {
  const bad = counts.total - counts.good;
  const allowedBad = counts.total * allowedErrorRatio(targetPercent);
  const remaining = allowedBad === 0 ? (bad === 0 ? 1 : -1) : 1 - bad / allowedBad;
  return { sli: sli(counts), allowedBad, bad, remaining };
}

export type BurnSeverity = "page" | "ticket";

export interface BurnPolicy {
  name: string;
  severity: BurnSeverity;
  longWindowMs: number;
  shortWindowMs: number;
  threshold: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Multi-window, multi-burn-rate alerting from the Google SRE workbook. Thresholds are the
 * workbook's values for a 30 day window; use `burnPoliciesFor` for any other window.
 */
export const BURN_POLICIES: readonly BurnPolicy[] = [
  { name: "fast-burn", severity: "page", longWindowMs: HOUR, shortWindowMs: 5 * MINUTE, threshold: 14.4 },
  {
    name: "sustained-burn",
    severity: "page",
    longWindowMs: 6 * HOUR,
    shortWindowMs: 30 * MINUTE,
    threshold: 6,
  },
  { name: "slow-burn", severity: "ticket", longWindowMs: 24 * HOUR, shortWindowMs: 2 * HOUR, threshold: 3 },
  {
    name: "creeping-burn",
    severity: "ticket",
    longWindowMs: 72 * HOUR,
    shortWindowMs: 6 * HOUR,
    threshold: 1,
  },
];

/**
 * Each policy encodes "this share of the budget was spent inside the long window". Keeping that
 * share constant means the threshold scales with the SLO window. A burn rate below 1 can never
 * exhaust the budget, so no policy is allowed to fire under it.
 */
export function burnPoliciesFor(windowDays: number): BurnPolicy[] {
  return BURN_POLICIES.map((policy) => ({
    ...policy,
    threshold: Math.max(1, Math.round(policy.threshold * (windowDays / 30) * 100) / 100),
  }));
}

export interface BurnWindowResult {
  policy: BurnPolicy;
  longBurn: number;
  shortBurn: number;
  firing: boolean;
}

export function evaluateBurnPolicies(
  countsFor: (windowMs: number) => Counts,
  targetPercent: number,
  policies: readonly BurnPolicy[] = BURN_POLICIES,
): BurnWindowResult[] {
  return policies.map((policy) => {
    const longBurn = burnRate(countsFor(policy.longWindowMs), targetPercent);
    const shortBurn = burnRate(countsFor(policy.shortWindowMs), targetPercent);
    return {
      policy,
      longBurn,
      shortBurn,
      firing: longBurn >= policy.threshold && shortBurn >= policy.threshold,
    };
  });
}

export interface TimedCounts extends Counts {
  start: Date;
}

export interface BudgetPoint {
  date: string;
  sli: number | null;
  remaining: number;
}

/**
 * Budget left at the end of each day, measured against the budget for the whole window (projected
 * from the average daily volume) so the line only ever goes down, like a sprint burn-down.
 */
export function budgetBurndown(
  days: readonly TimedCounts[],
  targetPercent: number,
  windowDays: number = days.length,
): BudgetPoint[] {
  const observed = days.filter((d) => d.total > 0);
  const averageDaily =
    observed.length === 0 ? 0 : observed.reduce((sum, d) => sum + d.total, 0) / observed.length;
  const allowedBad = averageDaily * windowDays * allowedErrorRatio(targetPercent);
  let good = 0;
  let total = 0;
  return days.map((day) => {
    good += day.good;
    total += day.total;
    const bad = total - good;
    const remaining = allowedBad === 0 ? (bad === 0 ? 1 : -1) : 1 - bad / allowedBad;
    return { date: day.start.toISOString().slice(0, 10), sli: sli({ good, total }), remaining };
  });
}
