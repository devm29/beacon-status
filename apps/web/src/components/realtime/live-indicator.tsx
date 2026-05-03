"use client";

import { StatusDot } from "@/components/status-dot";
import { useRealtime } from "./realtime-provider";

export function LiveIndicator() {
  const { connected } = useRealtime();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"
      aria-live="polite"
    >
      <StatusDot tone={connected ? "success" : "neutral"} pulse={connected} />
      {connected ? "Live" : "Connecting"}
    </span>
  );
}
