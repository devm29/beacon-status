"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatBurn } from "@/lib/format";
import { tickFormatter, tooltipLabel } from "./time-format";

const CONFIG: ChartConfig = { burn: { label: "Burn rate", color: "var(--chart-4)" } };

export function BurnChart({
  points,
  thresholds,
}: {
  points: { t: string; burn: number }[];
  thresholds: { name: string; value: number }[];
}) {
  const peak = Math.max(1.5, ...points.map((p) => p.burn));
  const visible = thresholds.filter((t) => t.value <= peak * 1.2);
  return (
    <ChartContainer
      config={CONFIG}
      className="h-56"
      role="img"
      aria-label="Hourly error budget burn rate over the last seven days"
    >
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={40}
          tickFormatter={(v: string) => tickFormatter(v, "7d")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          domain={[0, Math.ceil(peak * 1.2)]}
          tickFormatter={(v: number) => formatBurn(v)}
        />
        {visible.map((t) => (
          <ReferenceLine
            key={t.name}
            y={t.value}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            label={{
              value: `${t.name} ${formatBurn(t.value)}`,
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
        ))}
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(l) => tooltipLabel(l, "7d")}
              valueFormatter={(v) => formatBurn(v)}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="burn"
          stroke="var(--color-burn)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
