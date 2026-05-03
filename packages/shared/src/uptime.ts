import type { IncidentImpact } from "./incident.js";

export type DayLevel = "operational" | "degraded" | "partial" | "major" | "nodata";

export interface DailyCounts {
  start: Date;
  total: number;
  up: number;
  degraded: number;
  down: number;
}

export interface DayIncident {
  id: string;
  title: string;
  impact: IncidentImpact;
  startedAt: Date;
  resolvedAt: Date | null;
}

export interface UptimeDay {
  date: string;
  uptime: number | null;
  total: number;
  down: number;
  level: DayLevel;
  incidents: { id: string; title: string; impact: IncidentImpact }[];
}

const DAY_MS = 86_400_000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function levelForUptime(uptime: number): DayLevel {
  if (uptime >= 0.999) return "operational";
  if (uptime >= 0.99) return "degraded";
  if (uptime >= 0.95) return "partial";
  return "major";
}

const IMPACT_LEVEL: Record<IncidentImpact, DayLevel> = {
  none: "operational",
  minor: "degraded",
  major: "partial",
  critical: "major",
};

const LEVEL_RANK: Record<DayLevel, number> = {
  nodata: -1,
  operational: 0,
  degraded: 1,
  partial: 2,
  major: 3,
};

function worse(a: DayLevel, b: DayLevel): DayLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Builds the per-day bar shown on status pages. Degraded checks count as available. */
export function buildUptimeDays(
  daily: readonly DailyCounts[],
  incidents: readonly DayIncident[],
  days: number,
  now: Date,
): UptimeDay[] {
  const byDay = new Map(daily.map((d) => [startOfUtcDay(d.start).getTime(), d]));
  const today = startOfUtcDay(now).getTime();
  const result: UptimeDay[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const dayStart = today - offset * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const counts = byDay.get(dayStart);
    const touching = incidents.filter(
      (i) =>
        i.startedAt.getTime() < dayEnd && (i.resolvedAt?.getTime() ?? Number.POSITIVE_INFINITY) >= dayStart,
    );

    let uptime: number | null = null;
    let level: DayLevel = "nodata";
    if (counts && counts.total > 0) {
      uptime = (counts.up + counts.degraded) / counts.total;
      level = levelForUptime(uptime);
    }
    for (const incident of touching) {
      level = worse(level === "nodata" ? "operational" : level, IMPACT_LEVEL[incident.impact]);
    }

    result.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      uptime,
      total: counts?.total ?? 0,
      down: counts?.down ?? 0,
      level,
      incidents: touching.map((i) => ({ id: i.id, title: i.title, impact: i.impact })),
    });
  }
  return result;
}

export function overallUptime(days: readonly UptimeDay[]): number | null {
  let total = 0;
  let available = 0;
  for (const day of days) {
    if (day.uptime === null) continue;
    total += day.total;
    available += day.uptime * day.total;
  }
  return total === 0 ? null : available / total;
}
