"use client";

import type { MetricPoint, MetricRange } from "@beacon/shared";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatPercent } from "@/lib/format";
import { tickFormatter, tooltipLabel } from "./time-format";

const CONFIG: ChartConfig = { uptime: { label: "Availability", color: "var(--chart-5)" } };

function barColor(uptime: number | null): string {
  if (uptime === null) return "var(--muted)";
  if (uptime >= 0.999) return "var(--success)";
  if (uptime >= 0.95) return "var(--warning)";
  return "var(--destructive)";
}

export function AvailabilityChart({ points, range }: { points: MetricPoint[]; range: MetricRange }) {
  const lowest = Math.min(...points.map((p) => p.uptime ?? 1));
  const floor = lowest >= 0.99 ? 0.99 : lowest >= 0.9 ? 0.9 : 0;
  return (
    <ChartContainer
      config={CONFIG}
      className="h-40"
      role="img"
      aria-label="Availability for each interval in the selected range"
    >
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={(v: string) => tickFormatter(v, range)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          domain={[floor, 1]}
          allowDataOverflow
          tickFormatter={(v: number) => formatPercent(v, floor >= 0.99 ? 1 : 0)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(l) => tooltipLabel(l, range)}
              valueFormatter={(v) => formatPercent(v, 3)}
            />
          }
        />
        <Bar dataKey="uptime" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {points.map((p) => (
            <Cell key={p.t} fill={barColor(p.uptime)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
