"use client";

import { REGION_LABELS, type CheckResultEvent } from "@beacon/shared";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusDot } from "@/components/status-dot";
import { formatMs, formatTime } from "@/lib/format";
import { checkTone } from "@/lib/status";
import { useRealtimeEvent } from "./realtime-provider";

const MAX_ROWS = 14;

export function LiveCheckFeed({
  monitorNames,
  monitorId,
}: {
  monitorNames: Record<string, string>;
  monitorId?: string;
}) {
  const [rows, setRows] = useState<CheckResultEvent[]>([]);

  useRealtimeEvent((event) => {
    if (event.type !== "check.result") return;
    if (monitorId && event.monitorId !== monitorId) return;
    setRows((current) => [event, ...current].slice(0, MAX_ROWS));
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-muted-foreground">
        <Activity className="size-6 text-muted-foreground/60" strokeWidth={1.5} aria-hidden />
        Waiting for the next probe…
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border/60" aria-live="polite" aria-label="Live check results">
      {rows.map((row) => (
        <li
          key={`${row.monitorId}-${row.region}-${row.checkedAt}`}
          className="flex min-h-11 items-center gap-3 px-5 py-2 text-[13px] animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none"
        >
          <StatusDot tone={checkTone(row.status)} />
          <div className="min-w-0 flex-1">
            {monitorId ? (
              <span className="font-medium">{REGION_LABELS[row.region]}</span>
            ) : (
              <Link href={`/monitors/${row.monitorId}`} className="font-medium hover:underline">
                {monitorNames[row.monitorId] ?? "Monitor"}
              </Link>
            )}
            <div className="truncate text-[12px] text-muted-foreground">
              {row.error ?? (monitorId ? row.status : REGION_LABELS[row.region])}
            </div>
          </div>
          <div className="text-right tabular-nums">
            <div>{row.status === "down" ? "–" : formatMs(row.latencyMs)}</div>
            <div className="text-[12px] text-muted-foreground">{formatTime(row.checkedAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
