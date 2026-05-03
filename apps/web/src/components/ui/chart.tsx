"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = React.createContext<ChartConfig | null>(null);

function useChartConfig(): ChartConfig {
  const config = React.useContext(ChartContext);
  if (!config) throw new Error("Chart components must be rendered inside <ChartContainer>");
  return config;
}

/** Exposes each series color as `--color-<key>` so marks can use `var(--color-p95)`. */
function ChartContainer({
  config,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  config: ChartConfig;
  children: React.ReactElement;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]),
  );
  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        className={cn(
          "aspect-auto w-full text-[11px] [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-reference-line_line]:stroke-border [&_.recharts-surface]:outline-none",
          className,
        )}
        style={style}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = Tooltip;

type ValueFormatter = (value: number, key: string) => string;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: Partial<Pick<TooltipContentProps<number, string>, "active" | "payload" | "label">> & {
  labelFormatter?: (label: string) => string;
  valueFormatter?: ValueFormatter;
}) {
  const config = useChartConfig();
  if (!active || !payload || payload.length === 0) return null;
  const title = typeof label === "string" && labelFormatter ? labelFormatter(label) : String(label ?? "");
  return (
    <div className="material min-w-36 rounded-xl bg-popover/80 px-3 py-2 text-[12px] shadow-lg ring-1 ring-black/5 backdrop-blur-2xl backdrop-saturate-[1.8] dark:ring-white/10">
      {title ? <div className="mb-1.5 font-medium text-foreground">{title}</div> : null}
      <div className="grid gap-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const entry = config[key];
          const value = typeof item.value === "number" ? item.value : null;
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: entry?.color ?? item.color }}
              />
              <span className="text-muted-foreground">{entry?.label ?? key}</span>
              <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">
                {value === null ? "–" : valueFormatter ? valueFormatter(value, key) : value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartLegend({ config, className }: { config: ChartConfig; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground", className)}>
      {Object.entries(config).map(([key, value]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: value.color }} />
          {value.label}
        </span>
      ))}
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend };
