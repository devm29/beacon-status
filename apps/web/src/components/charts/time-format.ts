import type { MetricRange } from "@beacon/shared";

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const full = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function tickFormatter(iso: string, range: MetricRange): string {
  const date = new Date(iso);
  return range === "1h" || range === "24h" ? time.format(date) : day.format(date);
}

export function tooltipLabel(iso: string, range: MetricRange): string {
  const date = new Date(iso);
  return range === "90d" ? day.format(date) : `${full.format(date)} UTC`;
}
