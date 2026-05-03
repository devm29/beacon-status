"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatDate, formatPercent } from "@/lib/format";

const CONFIG: ChartConfig = { remaining: { label: "Budget left", color: "var(--chart-1)" } };

export function BudgetChart({ points }: { points: { date: string; remaining: number }[] }) {
  const min = Math.min(0, ...points.map((p) => p.remaining));
  return (
    <ChartContainer
      config={CONFIG}
      className="h-56"
      role="img"
      aria-label="Error budget remaining at the end of each day"
    >
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fill-remaining" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-remaining)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--color-remaining)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={(d: string) => formatDate(d).replace(/, \d{4}$/, "")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          domain={[min, 1]}
          tickFormatter={(v: number) => formatPercent(v, 0)}
        />
        <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(d) => formatDate(d)}
              valueFormatter={(v) => formatPercent(v, 1)}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="remaining"
          stroke="var(--color-remaining)"
          strokeWidth={2}
          fill="url(#fill-remaining)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
