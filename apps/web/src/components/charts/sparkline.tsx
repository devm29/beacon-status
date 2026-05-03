"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({
  points,
  label,
}: {
  points: { t: string; avgMs: number | null }[];
  label: string;
}) {
  const values = points.map((p) => p.avgMs).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return (
      <div className="h-8 w-28 rounded-md bg-muted" role="img" aria-label={`${label}: not enough data yet`} />
    );
  }
  const max = Math.max(...values);
  return (
    <div
      className="h-8 w-28"
      role="img"
      aria-label={`${label}: latency between ${Math.min(...values)} and ${max} ms over the last hour`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, Math.ceil(max * 1.15)]} />
          <Line
            type="monotone"
            dataKey="avgMs"
            stroke="var(--chart-1)"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
