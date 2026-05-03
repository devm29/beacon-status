import type { MonitorDto, PlanResponse } from "@beacon/shared";

type Plan = PlanResponse["plan"];
type Change = Plan["changes"][number];

export interface Palette {
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
}

const wrap = (open: number, close: number) => (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;

export const ANSI: Palette = {
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
};

const identity = (text: string) => text;
export const PLAIN: Palette = {
  green: identity,
  yellow: identity,
  red: identity,
  dim: identity,
  bold: identity,
};

export function paletteFor(
  stream: { isTTY?: boolean | undefined },
  env: NodeJS.ProcessEnv = process.env,
): Palette {
  if (env.NO_COLOR !== undefined || env.TERM === "dumb") return PLAIN;
  if (env.FORCE_COLOR !== undefined) return ANSI;
  return stream.isTTY ? ANSI : PLAIN;
}

const KIND_LABEL: Record<Change["kind"], string> = {
  monitor: "monitor",
  slo: "slo",
  channel: "channel",
  statusPage: "status page",
};

function formatValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  const json = JSON.stringify(value);
  return json.length > 72 ? `${json.slice(0, 69)}...` : json;
}

function renderChange(change: Change, c: Palette): string[] {
  const label = `${KIND_LABEL[change.kind]} ${c.bold(change.key)}`;
  switch (change.action) {
    case "create":
      return [c.green(`  + ${label}`)];
    case "delete":
      return [c.red(`  - ${label}`)];
    case "noop":
      return [];
    case "update":
      return [
        c.yellow(`  ~ ${label}`),
        ...change.changes.map(
          (f) =>
            `      ${c.dim(f.path)}: ${c.red(formatValue(f.before))} ${c.dim("->")} ${c.green(formatValue(f.after))}`,
        ),
      ];
  }
}

export function renderPlan(plan: Plan, c: Palette): string {
  const { create, update, delete: remove } = plan.summary;
  if (create + update + remove === 0) {
    return c.green("No changes. Your Beacon resources match the configuration.");
  }
  const lines = ["Beacon will perform the following actions:", ""];
  for (const change of plan.changes) lines.push(...renderChange(change, c));
  const unchanged = plan.changes.filter((ch) => ch.action === "noop").length;
  lines.push(
    "",
    `Plan: ${c.green(`${create} to create`)}, ${c.yellow(`${update} to update`)}, ${c.red(`${remove} to delete`)}` +
      (unchanged > 0 ? c.dim(` (${unchanged} unchanged)`) : ""),
  );
  return lines.join("\n");
}

const STATUS_STYLE: Record<MonitorDto["status"], keyof Palette> = {
  up: "green",
  degraded: "yellow",
  down: "red",
  pending: "dim",
};

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function renderMonitors(monitors: readonly MonitorDto[], c: Palette): string {
  if (monitors.length === 0) return "No monitors yet. Add some to beacon.yaml and run `beacon apply`.";
  const rows = monitors.map((m) => {
    const status = m.paused ? "paused" : m.status;
    const latencies = m.regionStatus.map((r) => r.latencyMs);
    const avg =
      latencies.length > 0 ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms` : "-";
    const style: keyof Palette = m.paused ? "dim" : STATUS_STYLE[m.status];
    return {
      key: m.key,
      status,
      style,
      avg,
      regions: m.regionStatus.map((r) => `${r.region}:${r.status}`).join(" "),
    };
  });
  const keyWidth = Math.max(3, ...rows.map((r) => r.key.length)) + 2;
  const statusWidth = 10;
  const header = c.dim(`${pad("KEY", keyWidth)}${pad("STATUS", statusWidth)}${pad("LATENCY", 10)}REGIONS`);
  const body = rows.map(
    (r) =>
      `${pad(r.key, keyWidth)}${c[r.style](pad(r.status, statusWidth))}${pad(r.avg, 10)}${c.dim(r.regions)}`,
  );
  return [header, ...body].join("\n");
}
