"use client";

import type { MetricPoint, MetricRange } from "@beacon/shared";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMs } from "@/lib/format";
import { tickFormatter, tooltipLabel } from "./time-format";

const CONFIG: ChartConfig = {
  p50Ms: { label: "p50", color: "var(--chart-1)" },
  p95Ms: { label: "p95", color: "var(--chart-2)" },
};

export function LatencyChart({ points, range }: { points: MetricPoint[]; range: MetricRange }) {
  return (
    <div className="grid gap-3">
      <ChartContainer
        config={CONFIG}
        className="h-64"
        role="img"
        aria-label="Response time percentiles over the selected range"
      >
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {Object.keys(CONFIG).map((key) => (
              <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity={0.2} />
                <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tickFormatter={(value: string) => tickFormatter(value, range)}
          />
          <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatMs(v)} />
          <ChartTooltip
            cursor={{ stroke: "var(--border)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(l) => tooltipLabel(l, range)}
                valueFormatter={(v) => formatMs(v)}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="p95Ms"
            stroke="var(--color-p95Ms)"
            strokeWidth={2}
            fill="url(#fill-p95Ms)"
            connectNulls
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="p50Ms"
            stroke="var(--color-p50Ms)"
            strokeWidth={2}
            fill="url(#fill-p50Ms)"
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      <ChartLegend config={CONFIG} />
    </div>
  );
}
