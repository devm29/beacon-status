import {
  METRIC_RANGES,
  MetricRangeSchema,
  REGION_LABELS,
  describeTarget,
  CHECK_TYPE_LABELS,
  type MetricRange,
  type MonitorDto,
} from "@beacon/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityChart } from "@/components/charts/availability-chart";
import { LatencyChart } from "@/components/charts/latency-chart";
import { KpiTile } from "@/components/kpi-tile";
import { MonitorActions } from "@/components/monitors/monitor-actions";
import { LiveCheckFeed } from "@/components/realtime/live-check-feed";
import { SegmentedLinks } from "@/components/segmented-links";
import { StatusBadge } from "@/components/status-badge";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { formatDateTime, formatMs, formatPercent, formatRelative } from "@/lib/format";
import { getMonitor, getMonitorMetrics, getMonitorResults, getMonitorStats } from "@/lib/queries";
import { checkTone, monitorTone } from "@/lib/status";

const RANGE_OPTIONS = METRIC_RANGES.map((value) => ({ value, label: value.toUpperCase() }));

function settings(monitor: MonitorDto): { label: string; value: string }[] {
  return [
    { label: "Check", value: CHECK_TYPE_LABELS[monitor.check.type] },
    { label: "Frequency", value: `Every ${monitor.intervalSeconds}s` },
    { label: "Timeout", value: formatMs(monitor.timeoutMs) },
    { label: "Quorum", value: `${monitor.quorum} of ${monitor.regions.length} regions` },
    { label: "Down after", value: `${monitor.failThreshold} failed evaluations` },
    { label: "Recovers after", value: `${monitor.recoverThreshold} healthy evaluations` },
    {
      label: "Slow after",
      value: monitor.degradedLatencyMs ? formatMs(monitor.degradedLatencyMs) : "Not set",
    },
    { label: "Status page", value: monitor.public ? "Visible" : "Hidden" },
  ];
}

export default async function MonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; cursor?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const range: MetricRange = MetricRangeSchema.catch("24h").parse(query.range);

  let monitor: MonitorDto;
  try {
    monitor = await getMonitor(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [stats, metrics, results] = await Promise.all([
    getMonitorStats(id),
    getMonitorMetrics(id, range),
    getMonitorResults(id, query.cursor),
  ]);
  const { tone, label } = monitorTone(monitor);
  const now = new Date();

  return (
    <>
      <div className="grid gap-4">
        <Button asChild variant="link" className="h-auto w-fit p-0 text-[13px]">
          <Link href="/monitors">
            <ChevronLeft className="size-4" /> Monitors
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">{monitor.name}</h1>
              <StatusBadge tone={tone} label={label} pulse={monitor.status === "down"} />
              {monitor.flapping ? <Badge variant="warning">Flapping</Badge> : null}
              <Badge variant="secondary">
                {monitor.managedBy === "config" ? "beacon.yaml" : "Dashboard"}
              </Badge>
            </div>
            <p className="mt-1 truncate font-mono text-[13px] text-muted-foreground">
              {describeTarget(monitor.check)}
            </p>
            {monitor.statusSince ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {label} since {formatDateTime(monitor.statusSince)} · last checked{" "}
                {formatRelative(monitor.lastCheckedAt, now)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <MonitorActions
              id={monitor.id}
              name={monitor.name}
              paused={monitor.paused}
              managedBy={monitor.managedBy}
            />
          </div>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Key metrics">
        <KpiTile label="Uptime, 24 hours" value={formatPercent(stats.uptime24h, 3)} />
        <KpiTile label="Uptime, 30 days" value={formatPercent(stats.uptime30d, 3)} />
        <KpiTile label="p95 response, 24h" value={formatMs(stats.p95Ms24h)} />
        <KpiTile label="Avg response, 24h" value={formatMs(stats.avgMs24h)} />
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Regions">
        {monitor.regions.map((region) => {
          const observation = monitor.regionStatus.find((r) => r.region === region);
          return (
            <Card key={region} className="gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted-foreground">{REGION_LABELS[region]}</span>
                {observation ? (
                  <StatusDot tone={observation.stale ? "neutral" : checkTone(observation.status)} />
                ) : null}
              </div>
              <div className="text-[22px] leading-7 font-semibold tabular-nums">
                {observation
                  ? observation.status === "down"
                    ? "Failing"
                    : formatMs(observation.latencyMs)
                  : "–"}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {observation
                  ? (observation.error ??
                    `Checked ${formatRelative(observation.at, now)}${observation.stale ? " · stale" : ""}`)
                  : "Waiting for the first probe"}
              </div>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Response time</CardTitle>
            <CardDescription>
              Percentiles from merged latency histograms, {metrics.granularity} rollups
            </CardDescription>
          </div>
          <SegmentedLinks
            label="Time range"
            options={RANGE_OPTIONS}
            value={range}
            href={(r) => `/monitors/${monitor.id}?range=${r}`}
          />
        </CardHeader>
        {metrics.points.length > 0 ? (
          <>
            <LatencyChart points={metrics.points} range={range} />
            <div className="grid gap-2">
              <div className="text-[13px] font-medium">Availability</div>
              <AvailabilityChart points={metrics.points} range={range} />
            </div>
          </>
        ) : (
          <p className="py-10 text-center text-[13px] text-muted-foreground">No data for this range yet.</p>
        )}
      </Card>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-0 overflow-hidden p-0 lg:col-span-2">
          <CardHeader className="p-5 pb-3">
            <CardTitle>Recent results</CardTitle>
            <CardDescription>Raw probe results, kept for 14 days in a time-series collection</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{formatDateTime(r.checkedAt)}</TableCell>
                  <TableCell>{REGION_LABELS[r.region]}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot tone={checkTone(r.status)} />
                      <span className="truncate">
                        {r.error ??
                          (r.statusCode
                            ? `HTTP ${r.statusCode}`
                            : r.status === "up"
                              ? "Reachable"
                              : r.status)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.status === "down" ? "–" : formatMs(r.latencyMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end gap-2 border-t border-border/60 p-3">
            {query.cursor ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/monitors/${monitor.id}?range=${range}`} scroll={false}>
                  Newest
                </Link>
              </Button>
            ) : null}
            {results.nextCursor ? (
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/monitors/${monitor.id}?range=${range}&cursor=${results.nextCursor}`}
                  scroll={false}
                >
                  Older results
                </Link>
              </Button>
            ) : null}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="gap-0 overflow-hidden p-0">
            <CardHeader className="p-5 pb-3">
              <CardTitle>Live</CardTitle>
            </CardHeader>
            <LiveCheckFeed monitorNames={{ [monitor.id]: monitor.name }} monitorId={monitor.id} />
          </Card>
          <Card className="gap-0 overflow-hidden p-0">
            <CardHeader className="p-5 pb-3">
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <dl className="divide-y divide-border/60">
              {settings(monitor).map((s) => (
                <div
                  key={s.label}
                  className="flex min-h-11 items-center justify-between gap-4 px-5 text-[13px]"
                >
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="text-right">{s.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </section>
    </>
  );
}
