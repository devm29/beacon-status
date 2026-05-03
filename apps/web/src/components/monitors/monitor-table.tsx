"use client";

import { describeTarget, type MonitorDto, type MonitorStatsDto, type RegionStatusDto } from "@beacon/shared";
import Link from "next/link";
import { useState } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMs, formatPercent } from "@/lib/format";
import { mergeRegions } from "@/lib/regions";
import { monitorTone } from "@/lib/status";
import { RegionDots } from "./region-dots";

export interface MonitorRow {
  monitor: MonitorDto;
  stats: MonitorStatsDto | null;
}

/** Region chips update from live probe results between server refreshes. */
export function MonitorTable({ rows, compact = false }: { rows: MonitorRow[]; compact?: boolean }) {
  const [live, setLive] = useState<Record<string, RegionStatusDto[]>>({});

  useRealtimeEvent((event) => {
    if (event.type !== "check.result") return;
    setLive((current) => {
      const row = rows.find((r) => r.monitor.id === event.monitorId);
      if (!row) return current;
      const base = mergeRegions(row.monitor.regionStatus, current[event.monitorId]);
      const next: RegionStatusDto = {
        region: event.region,
        status: event.status,
        latencyMs: Math.round(event.latencyMs),
        error: event.error,
        at: event.checkedAt,
        stale: false,
      };
      const merged = base.some((r) => r.region === event.region)
        ? base.map((r) => (r.region === event.region ? next : r))
        : [...base, next];
      return { ...current, [event.monitorId]: merged };
    });
  });

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Monitor</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Regions</TableHead>
          <TableHead className="hidden lg:table-cell">Last hour</TableHead>
          <TableHead className="text-right">Uptime 24h</TableHead>
          {compact ? null : <TableHead className="hidden text-right sm:table-cell">p95 24h</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ monitor, stats }) => {
          const { tone, label } = monitorTone(monitor);
          return (
            <TableRow key={monitor.id} className="relative">
              <TableCell className="max-w-64">
                <Link
                  href={`/monitors/${monitor.id}`}
                  className="font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline focus-visible:after:ring-4 focus-visible:after:ring-ring"
                >
                  {monitor.name}
                </Link>
                <div className="truncate text-[12px] text-muted-foreground">
                  {describeTarget(monitor.check)}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge
                  tone={tone}
                  label={monitor.flapping && !monitor.paused ? `${label} · flapping` : label}
                  pulse={monitor.status === "down"}
                />
              </TableCell>
              <TableCell className="relative z-10">
                <RegionDots regions={mergeRegions(monitor.regionStatus, live[monitor.id])} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Sparkline points={stats?.sparkline ?? []} label={`${monitor.name} latency`} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(stats?.uptime24h ?? null)}
              </TableCell>
              {compact ? null : (
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {formatMs(stats?.p95Ms24h ?? null)}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
