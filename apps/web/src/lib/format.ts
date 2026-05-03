const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatPercent(ratio: number | null, digits = 2): string {
  if (ratio === null || !Number.isFinite(ratio)) return "–";
  if (ratio >= 1) return "100%";
  // Truncate rather than round so 99.996% never reads as a perfect 100.00%.
  const factor = 10 ** digits;
  return `${(Math.floor(ratio * 100 * factor + 1e-9) / factor).toFixed(digits)}%`;
}

export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "–";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 100_000 ? "compact" : "standard" }).format(
    value,
  );
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms % HOUR) / MINUTE);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const diff = now.getTime() - new Date(iso).getTime();
  if (Math.abs(diff) < 45_000) return diff >= 0 ? "just now" : "in a moment";
  const text = formatDuration(Math.abs(diff));
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});
const dateOnly = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const timeOnly = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
export const formatTime = (iso: string) => timeOnly.format(new Date(iso));

export function formatBurn(rate: number): string {
  if (rate === 0) return "0×";
  if (rate < 0.1) return "<0.1×";
  if (rate >= 100) return `${Math.round(rate)}×`;
  return `${Number(rate.toFixed(1))}×`;
}

export function formatWindow(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
}
